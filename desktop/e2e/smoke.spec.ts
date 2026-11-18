import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
test('demo operation and views fit the window', async () => {
 const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-smoke-'));
 const app=await electron.launch({args:[path.resolve('electron/main.cjs'),'--demo'], cwd: workspace, env: { ...process.env, HOME: workspace, DISPATCH_TEST_HOME: workspace, DISPATCH_HOME: workspace }});
 try { const page=await app.firstWindow(); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); }); await page.setViewportSize({width:1000,height:700});
 const fits=async()=>expect(await page.evaluate(()=>document.scrollingElement!.scrollHeight <= innerHeight)).toBe(true);
 await fits(); await page.getByRole('button',{name:'Start operation'}).click(); await expect(page.locator('button.agent').filter({ hasText: /scout/i })).toBeVisible(); await fits();
 await page.getByRole('tab',{name:'Terminal',exact:true}).click(); await fits();
 await expect.poll(() => page.evaluate(() => window.army.output('boss'))).toContain('DISPATCH / DEMO AGENT: boss');
 await expect.poll(() => page.evaluate(() => window.army.output('boss')), { timeout: 12000 }).toContain('Checking workspace status');
 for(const name of ['Overview','Tools','Brain','Settings']) {await page.getByRole('button',{name,exact:true}).click(); await fits();}
 await page.getByRole('button',{name:'Overview',exact:true}).click(); await page.getByRole('tab',{name:'Tasks',exact:true}).click(); await fits();
 await page.getByRole('tab',{name:'Messages',exact:true}).click(); await fits();
 await page.getByRole('button',{name:'Tools',exact:true}).click(); await page.getByRole('tab',{name:'Plugins',exact:true}).click(); await fits();
 await page.getByRole('button',{name:'Brain',exact:true}).click(); await page.getByRole('tab',{name:'Skills',exact:true}).click(); await fits();
 await page.getByRole('tab',{name:'Memory',exact:true}).click(); await fits();
 expect(errors).toEqual([]);
 } finally {await app.close(); fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });}
});
