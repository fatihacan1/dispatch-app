import { useEffect, useState } from "react";

type Choice = { id: string; label: string; path: string };

/** Settings > Terminal: which shell the Terminal tab in the side panel opens (PowerShell, Git Bash, a custom program) and where. */
export function TerminalSettings({ workspace }: { workspace: string }) {
  const [choices, setChoices] = useState<Choice[]>([]);
  const [ui, setUi] = useState<Record<string, any>>({});
  useEffect(() => {
    window.army.shells.choices().then(setChoices).catch(() => {});
    window.army.ui.get().then(setUi).catch(() => {});
  }, []);
  const set = (patch: Record<string, string>) => { setUi(v => ({ ...v, ...patch })); void window.army.ui.set(patch).then(setUi).catch(() => {}); };
  const shell = ui.terminalShell && choices.some(c => c.id === ui.terminalShell) ? ui.terminalShell : choices[0]?.id || "";
  const picked = choices.find(c => c.id === shell);

  return <section className="settings-group">
    <h2 className="label">Terminal</h2>
    <div className="setting-row"><div><b>Shell</b><p>{shell === "custom" ? "Any program, with its arguments." : picked?.path ? `New terminals run ${picked.path}. Open terminals keep their shell.` : "The shell new terminals in the side panel open with."}</p></div>
      <select aria-label="Shell" style={{ width: 200 }} value={shell} onChange={e => set({ terminalShell: e.target.value })}>
        {choices.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
      </select></div>
    {shell === "custom" && <div className="setting-row"><div><b>Program</b><p>Full path, for example C:\Program Files\Git\bin\bash.exe</p></div>
      <div className="terminal-custom">
        <input aria-label="Shell program" placeholder="Path to the program" defaultValue={ui.terminalPath || ""} key={"p" + (ui.terminalPath || "")} onBlur={e => set({ terminalPath: e.target.value })} />
        <input aria-label="Shell arguments" placeholder="Arguments, e.g. --login -i" defaultValue={ui.terminalArgs || ""} key={"a" + (ui.terminalArgs || "")} onBlur={e => set({ terminalArgs: e.target.value })} />
      </div></div>}
    <div className="setting-row"><div><b>Start in</b><p>Empty starts in the project folder{workspace ? ` (${workspace})` : ""}.</p></div>
      <input aria-label="Terminal start folder" style={{ width: 260 }} placeholder="Project folder" defaultValue={ui.terminalCwd || ""} key={"c" + (ui.terminalCwd || "")} onBlur={e => set({ terminalCwd: e.target.value })} /></div>
  </section>;
}
