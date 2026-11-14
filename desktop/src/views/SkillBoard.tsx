import { useEffect, useMemo, useRef, useState } from "react";
import { MagnifyingGlassIcon, XMarkIcon } from "@heroicons/react/16/solid";
import { Button } from "../components/common";
import { ask } from "../components/ask";

// Skill board: every skill (Dispatch's and the ones Claude Code / Codex load by themselves) as a chip in a group,
// like groups drawn on a blackboard. Chips drag between groups, groups drag by their title, filters above.
export type BoardSkill = { key: string; name: string; description: string; enabled: boolean; where: string };
type Group = { id: string; name: string; x: number; y: number };
type Board = { groups: Group[]; assign: Record<string, string> };

const army = () => (window as any).army;
const UNGROUPED = "ungrouped";
const COL_W = 300, GAP = 16;

// First sort: a few word lists over name + description. Order matters (an "offensive design" skill is security).
const RULES: [string, RegExp][] = [
  ["Security", /secur|pentest|penetration|vulnerab|owasp|exploit|offensive|strix|red.?team|recon|xss|sqli|malware|attack|threat|ctf|forensic/i],
  ["3D & motion", /three\.?js|threejs|\b3d\b|gsap|animat|motion|shader|webgl|blender|unreal|video|genjutsu|r3f/i],
  ["SEO & marketing", /\bseo\b|keyword|backlink|marketing|serp|competitor|visibility|outreach|link.?prospect|ads\b|brand/i],
  ["Docs & office", /\bpdf\b|docx|pptx|xlsx|spreadsheet|slide|presentation|document|notebook|word\b|excel|powerpoint/i],
  ["Design & UI", /design|\bui\b|\bux\b|interface|frontend|css|tailwind|layout|typograph|colou?r|logo|figma|component|shadcn|taste|accessib|landing|visual/i],
  ["Code & tools", /code|review|test|git|deploy|api|debug|refactor|cli|config|script|agent|mcp|plugin|build/i],
];
const autoGroup = (s: BoardSkill) => RULES.find(([, re]) => re.test(`${s.name} ${s.description}`))?.[0] || null;

// Groups without a place yet go to the shortest column (as many as fit), so none lands on another. size(id) = chip count.
function layout(groups: Group[], size: (id: string) => number = () => 6, n = 3): Group[] {
  const cols = Array(Math.max(1, n)).fill(GAP);
  for (const g of groups) if (g.x || g.y) { const c = Math.min(cols.length - 1, Math.round((g.x - GAP) / (COL_W + GAP))); if (c >= 0) cols[c] = Math.max(cols[c], g.y + height(size(g.id)) + GAP); }
  return groups.map(g => {
    if (g.x || g.y) return g;
    const c = cols.indexOf(Math.min(...cols)); const placed = { ...g, x: GAP + c * (COL_W + GAP), y: cols[c] }; cols[c] += height(size(g.id)) + GAP; return placed;
  });
}
const height = (chips: number) => 56 + Math.ceil(chips / 3) * 32;

export function SkillBoard({ skills }: { skills: BoardSkill[] }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [over, setOver] = useState("");
  const [moving, setMoving] = useState("");
  const canvas = useRef<HTMLDivElement>(null);
  useEffect(() => { army().skills.board().then((b: Board | null) => setBoard(b || { groups: [], assign: {} })).catch(() => setBoard({ groups: [], assign: {} })); }, []);
  const save = (next: Board) => { setBoard(next); void army().skills.saveBoard(next).catch(() => {}); };

  const known = new Set((board?.groups || []).map(g => g.id));
  const groupOf = (s: BoardSkill) => { const g = board?.assign[s.key]; return g && known.has(g) ? g : UNGROUPED; };
  const sizeOf = (id: string, assign = board?.assign || {}) => skills.filter(s => (assign[s.key] || UNGROUPED) === id).length;
  // Columns that fit the board's width, measured as it resizes.
  const [ncols, setNcols] = useState(3);
  useEffect(() => { const el = canvas.current; if (!el) return; const ro = new ResizeObserver(() => setNcols(Math.max(1, Math.floor((el.clientWidth - GAP) / (COL_W + GAP))))); ro.observe(el); return () => ro.disconnect(); }, [board === null, filter]);
  const groups = useMemo(() => layout(board?.groups || [], id => sizeOf(id), ncols), [board, skills, ncols]);
  const q = query.trim().toLowerCase();
  const shown = skills.filter(s => !q || `${s.name} ${s.description}`.toLowerCase().includes(q));
  const members = (id: string) => shown.filter(s => groupOf(s) === id).sort((a, b) => a.name.localeCompare(b.name));
  const count = (id: string) => skills.filter(s => groupOf(s) === id).length;
  if (!board) return null;

  const sortAll = () => {
    const names = [...new Set(skills.map(autoGroup).filter(Boolean) as string[])];
    const existing = new Map(groups.map(g => [g.name, g]));
    const next: Group[] = [...groups];
    for (const name of names) if (!existing.has(name)) { const g = { id: Math.random().toString(36).slice(2, 10), name, x: 0, y: 0 }; next.push(g); existing.set(name, g); }
    const assign = { ...board.assign };
    // Only skills still loose are sorted; what the user placed stays where it is.
    for (const s of skills) if (groupOf(s) === UNGROUPED) { const name = autoGroup(s); if (name) assign[s.key] = existing.get(name)!.id; }
    save({ groups: layout(next, id => sizeOf(id, assign), ncols), assign });
  };
  const addGroup = async () => {
    const name = (await ask.prompt("New group", "Group name", "", "Create"))?.trim(); if (!name) return;
    save({ ...board, groups: layout([...groups, { id: Math.random().toString(36).slice(2, 10), name, x: 0, y: 0 }], id => sizeOf(id), ncols) });
  };
  const rename = async (g: Group) => {
    const name = (await ask.prompt("Rename group", "Group name", g.name))?.trim(); if (!name) return;
    save({ ...board, groups: groups.map(x => x.id === g.id ? { ...x, name } : x) });
  };
  const remove = (g: Group) => {
    const assign = Object.fromEntries(Object.entries(board.assign).filter(([, v]) => v !== g.id));
    save({ groups: groups.filter(x => x.id !== g.id), assign }); if (filter === g.id) setFilter("all");
  };
  const drop = (e: React.DragEvent, id: string) => {
    e.preventDefault(); setOver(""); const key = e.dataTransfer.getData("text/x-skill"); if (!key) return;
    const assign = { ...board.assign }; if (id === UNGROUPED) delete assign[key]; else assign[key] = id;
    save({ ...board, groups, assign });
  };
  // Move a group by its title: follows the pointer, saved on release.
  const grab = (e: React.PointerEvent, g: Group) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    e.preventDefault(); const x0 = e.clientX - g.x, y0 = e.clientY - g.y; let cur = groups; setMoving(g.id);
    const move = (ev: PointerEvent) => { cur = groups.map(x => x.id === g.id ? { ...x, x: Math.max(0, ev.clientX - x0), y: Math.max(0, ev.clientY - y0) } : x); setBoard(b => b && { ...b, groups: cur }); };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); setMoving(""); save({ ...board, groups: cur }); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };

  const panel = (id: string, name: string, g?: Group) => (
    <section key={id} className={"sb-group" + (over === id ? " over" : "") + (moving === id ? " moving" : "")} style={g ? { left: g.x, top: g.y } : undefined}
      onDragOver={e => { if (e.dataTransfer.types.includes("text/x-skill")) { e.preventDefault(); setOver(id); } }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(""); }} onDrop={e => drop(e, id)}>
      <header onPointerDown={g ? e => grab(e, g) : undefined} onDoubleClick={g ? () => void rename(g) : undefined} title={g ? "Drag to move, double-click to rename" : undefined}>
        <b>{name}</b><small>{count(id)}</small>
        {g && <button type="button" className="icon-button" aria-label={`Delete group ${name}`} title="Delete group (its skills go to Ungrouped)" onClick={() => remove(g)}><XMarkIcon /></button>}
      </header>
      <div className="sb-chips">
        {members(id).map(s => <span key={s.key} className={"sb-chip" + (s.enabled ? "" : " off")} draggable title={`${s.description || "No description"}\n${s.where}`}
          onDragStart={e => { e.dataTransfer.setData("text/x-skill", s.key); e.dataTransfer.effectAllowed = "move"; }}>{s.name}</span>)}
        {!members(id).length && <span className="sb-empty">{q ? "No match" : "Drop skills here"}</span>}
      </div>
    </section>
  );
  const visible = filter === "all" ? groups : groups.filter(g => g.id === filter);
  const boardHeight = Math.max(520, ...visible.map(g => g.y + height(count(g.id)) + 60));

  return (
    <div className="sb">
      <div className="sb-bar">
        <div className="field-search"><MagnifyingGlassIcon aria-hidden="true" /><input aria-label="Search skills" placeholder="Search skills" value={query} onChange={e => setQuery(e.target.value)} /></div>
        <span className="mem-spacer" />
        <Button className="ghost" onClick={sortAll} title="Put every skill that is not in a group yet into a group by what it does">Sort into groups</Button>
        <Button className="ghost" onClick={() => void addGroup()}>New group</Button>
      </div>
      <div className="sb-filters" role="tablist" aria-label="Skill groups">
        <button type="button" role="tab" aria-selected={filter === "all"} onClick={() => setFilter("all")}>All<small>{skills.length}</small></button>
        {groups.map(g => <button key={g.id} type="button" role="tab" aria-selected={filter === g.id} onClick={() => setFilter(g.id)}>{g.name}<small>{count(g.id)}</small></button>)}
        <button type="button" role="tab" aria-selected={filter === UNGROUPED} onClick={() => setFilter(UNGROUPED)}>Ungrouped<small>{count(UNGROUPED)}</small></button>
      </div>
      {filter === UNGROUPED ? <div className="sb-single">{panel(UNGROUPED, "Ungrouped")}</div>
        : filter !== "all" ? <div className="sb-single">{visible.map(g => panel(g.id, g.name))}</div>
        : <div className="sb-board">
          <div className="sb-canvas" ref={canvas} style={{ height: boardHeight }}>{groups.map(g => panel(g.id, g.name, g))}</div>
          <aside className="sb-loose">{panel(UNGROUPED, "Ungrouped")}</aside>
        </div>}
      {!groups.length && <p className="skill-hint">No groups yet. Sort into groups makes them from what each skill does, or make your own with New group and drag skills in.</p>}
    </div>
  );
}
