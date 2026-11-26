import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

// Real language servers in the editor. DISPATCH_TEST_LSP = a .dispatch folder that has (or may download) them.
const lsp = process.env.DISPATCH_TEST_LSP || '';
test('Rust, TypeScript, C# and C++ suggestions, and the C++ settings picker', async () => {
  test.skip(!lsp, 'set DISPATCH_TEST_LSP'); test.setTimeout(300000);
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-langs-')), put = (f: string, t: string) => { const p = path.join(ws, f); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, t); };
  put('rs/Cargo.toml', '[package]\nname = "a"\nversion = "0.1.0"\nedition = "2021"\n'); put('rs/src/main.rs', 'fn main() {\n    let word = String::new();\n\n}\n');
  put('ts/node_modules/tiny/package.json', '{"name":"tiny","types":"i.d.ts"}'); put('ts/node_modules/tiny/i.d.ts', 'export declare function squeeze(): string;'); put('ts/app.ts', 'import * as tiny from "tiny";\n\n\n');
  put('cs/a.csproj', '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net9.0</TargetFramework></PropertyGroup></Project>'); put('cs/Prog.cs', 'using System;\nclass P { static void Main() {\n\n} }\n');
  put('cc/lib/motor.h', '#pragma once\nstruct Motor { int speed; void spin(); };\n'); put('cc/plain.cpp', '#include <motor.h>\nint main() { Motor m; m.spin();\n\n}\n');
  const app = await electron.launch({ args: [path.resolve('electron/main.cjs'), '--demo'], cwd: ws, env: { ...process.env, HOME: ws, DISPATCH_TEST_HOME: ws, DISPATCH_HOME: ws, DISPATCH_TEST_HIDDEN: '1', RUSTUP_HOME: process.env.RUSTUP_HOME || path.join(os.homedir(), '.rustup'), CARGO_HOME: process.env.CARGO_HOME || path.join(os.homedir(), '.cargo'), VITE_DEV_SERVER_URL: '' } });
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Start operation' }).click();
    await page.getByRole('button', { name: 'Show files' }).click();
    const row = (n: string) => page.locator('.ide-row').filter({ has: page.locator('.ide-name', { hasText: new RegExp('^' + n.replace('.', '\\.') + '$') }) });
    const list = page.locator('.suggest-widget.visible .monaco-list-row');
    const check = async (dirs: string[], file: string, line: number, text: string, want: string) => {
      for (const d of dirs) await row(d).first().click();
      await row(file).click();
      await expect(page.locator('.ide-path')).toContainText(file);
      await page.locator('.ide-edit .view-lines').click(); await page.keyboard.press('Control+Home'); for (let i = 0; i < line; i++) await page.keyboard.press('ArrowDown');
      const dot = text.lastIndexOf('.'); await page.keyboard.type(text.slice(0, dot), { delay: 40 }); await page.keyboard.press('Escape');
      // A server that is still starting answers a moment later: ask again.
      await expect(async () => { await page.keyboard.type('.', { delay: 40 }); try { await expect(list.filter({ hasText: want }).first()).toBeVisible({ timeout: 6000 }); } catch (e) { await page.keyboard.press('Escape'); await page.keyboard.press('Backspace'); throw e; } }).toPass({ timeout: 100000 });
      console.log('ok', file, (await list.allInnerTexts()).slice(0, 6).join(' | ').replace(/s+/g, ' ')); await page.keyboard.press('Escape');
    };
    await check(['rs', 'src'], 'main.rs', 2, '    word.', '');
    await check(['ts'], 'app.ts', 1, 'tiny.', 'squeeze');
    await check(['cs'], 'Prog.cs', 2, '    Console.', 'BackgroundColor');
    await row('cc').click(); await row('plain.cpp').click();
    const source = page.locator('.ide-source'); await expect(source).toHaveValue('auto');
    // The library is not known: one warning, no wall of errors.
    await expect(page.locator('.squiggly-warning').first()).toBeVisible({ timeout: 60000 }); await expect(page.locator('.squiggly-error')).toHaveCount(0);
    await page.screenshot({ path: path.join('test-results', 'ide-cpp-missing.png') });
    // The project's own settings appear: pick them, the library is known.
    put('cc/compile_commands.json', JSON.stringify([{ directory: path.join(ws, 'cc'), file: path.join(ws, 'cc', 'plain.cpp'), arguments: ['clang++', '-I', path.join(ws, 'cc', 'lib'), '-c', 'plain.cpp'] }]));
    await row('app.ts').click(); await row('plain.cpp').click();
    await expect(source.locator('option[value="db:."]')).toHaveCount(1); await source.selectOption('off'); await expect(page.locator('.squiggly-warning')).toHaveCount(0);
    await source.selectOption('db:.');
    await check([], 'plain.cpp', 2, 'm.', 'speed');
    await page.screenshot({ path: path.join('test-results', 'ide-cpp.png') });
  } finally { await app.close(); }
});
