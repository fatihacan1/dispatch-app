import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

test('share: export a trained workspace and import it into another', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-share-'));
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-share-to-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-sharehome-'));
  const w = (f: string, d: string) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, d); };
  w(path.join(workspace, '.dispatch', 'agents', 'video-editor.md'), '---\nname: video-editor\ndescription: Cuts the daily video in my format.\nprovider: claude\n---\nCut it.\n');
  w(path.join(workspace, '.dispatch', 'memory', 'project.jsonl'), JSON.stringify({ type: 'entity', name: 'Video format', entityType: 'convention', observations: ['Vertical 9:16, 60 seconds'] }) + '\n');
  const packFile = path.join(home, 'studio.dispatch');
  const app = await electron.launch({ args: [path.resolve('electron/main.cjs'), '--demo'], cwd: workspace, env: { ...process.env, HOME: home, DISPATCH_TEST_HOME: home, DISPATCH_HOME: home } });
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Export and import' }).click();
    await expect(page.getByLabel('Export video-editor')).toBeChecked();
    await expect(page.getByLabel('Export Workspace memory')).toBeChecked();
    await page.getByLabel('Pack name').fill('Video studio');
    await page.getByLabel('Pack description').fill('Makes one short video a day.');
    await page.screenshot({ path: 'e2e/screens/share-export.png', fullPage: true });
    const result = await page.evaluate(async file => {
      const inv = await (window as any).army.packs.inventory();
      return (window as any).army.packs.export({ agents: inv.agents.filter((a: any) => a.name === 'video-editor').map((a: any) => a.id), memory: ['project'] }, { name: 'Video studio', description: 'Makes one short video a day.' }, file);
    }, packFile);
    expect(result.manifest.contents.agents).toHaveLength(1);
    expect(fs.existsSync(packFile)).toBe(true);

    // Open it in another workspace, like a double-click would.
    await page.evaluate(t => (window as any).army.workspace(t), other);
    await app.evaluate(({ webContents }, file) => webContents.getAllWebContents().find(w => /index\.html|localhost/.test(w.getURL()) && !w.getURL().includes('overlay'))!.send('pack-open', file), packFile);
    await expect(page.getByText('Video studio', { exact: true })).toBeVisible();
    await expect(page.getByText('Makes one short video a day.')).toBeVisible();
    await page.screenshot({ path: 'e2e/screens/share-import.png', fullPage: true });
    await page.getByRole('button', { name: 'Import', exact: true }).last().click();
    await expect(page.getByText('Imported')).toBeVisible();
    expect(fs.existsSync(path.join(other, '.dispatch', 'agents', 'video-editor.md'))).toBe(true);
    expect(fs.readFileSync(path.join(other, '.dispatch', 'memory', 'project.jsonl'), 'utf8')).toContain('9:16');
  } finally {
    await app.close();
    for (const d of [workspace, other, home]) fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
});
