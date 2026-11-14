import { useEffect, useState } from "react";
import { MagnifyingGlassIcon, XMarkIcon } from "@heroicons/react/16/solid";
import { Button } from "../components/common";
import { ask } from "../components/ask";
import { Dialog } from "../components/Dialog";
import { Markdown } from "../components/Markdown";

// Skill board: every skill (Dispatch's and the ones Claude Code / Codex load by themselves) as a chip in a group.
// Groups sit in a grid that fills the page; Ungrouped runs across the top. Chips drag onto any group, a group drags by
// its title onto another to change the order, and a click on a chip opens the skill.
export type BoardSkill = { key: string; name: string; description: string; enabled: boolean; where: string; read: () => Promise<string> };
type Group = { id: string; name: string; x?: number; y?: number };
type Board = { groups: Group[]; assign: Record<string, string> };

const army = () => (window as any).army;
const UNGROUPED = "ungrouped";
const newId = () => Math.random().toString(36).slice(2, 10);

// First sort: word lists over name + description. The first match wins, so the order matters: an "offensive
// design" skill is security, a UI skill that mentions motion is design.
const RULES: [string, RegExp][] = [
  ["Security", /secur|pentest|penetration|vulnerab|owasp|exploit|offensive|strix|red.?team|recon|xss|sqli|malware|attack|threat|ctf|forensic|appsec/i],
  ["Design & UI", /design|\bui\b|\bux\b|interface|frontend|css|tailwind|layout|typograph|colou?r|logo|figma|component|shadcn|taste|accessib|landing|visual|polish/i],
  ["3D & motion", /three\.?js|threejs|\b3d\b|gsap|animat|motion|shader|webgl|blender|unreal|video|genjutsu|r3f|scroll.?trigger/i],
  ["SEO & marketing", /\bseo\b|keyword|backlink|marketing|serp|competitor|visibility|outreach|link.?prospect|\bads\b|brand|geo\b|aeo\b/i],
  ["Docs & office", /\bpdf\b|docx|pptx|xlsx|spreadsheet|slide|presentation|document|notebook|\bword\b|excel|powerpoint|google.?workspace|drive/i],
  ["Writing", /writ|copy|prose|slop|tone|voice|caveman|edit(or|ing) draft/i],
  ["Code & tools", /code|review|test|git|deploy|api\b|debug|refactor|\bcli\b|config|script|agent|mcp|plugin|build|browser|scrap|research|data|chart/i],
];
const autoGroup = (s: BoardSkill) => RULES.find(([, re]) => re.test(`${s.name} ${s.description}`))?.[0] || null;
const body = (text: string) => text.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();

export function SkillBoard({ skills }: { skills: BoardSkill[] }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [over, setOver] = useState("");
  const [dragging, setDragging] = useState<"" | "skill" | "group">("");
  const [open, setOpen] = useState<BoardSkill | null>(null);
  const [text, setText] = useState<string | null>(null);
  useEffect(() => { army().skills.board().then((b: Board | null) => setBoard(b || { groups: [], assign: {} })).catch(() => setBoard({ groups: [], assign: {} })); }, []);
  useEffect(() => { setText(null); if (open) open.read().then(setText).catch(() => setText("")); }, [open?.key]);
  if (!board) return null;

  const save = (next: Board) => { setBoard(next); void army().skills.saveBoard(next).catch(() => {}); };
  const groups = board.groups;
  const known = new Set(groups.map(g => g.id));
  const groupOf = (s: BoardSkill) => { const g = board.assign[s.key]; return g && known.has(g) ? g : UNGROUPED; };
  const q = query.trim().toLowerCase();
  const members = (id: string) => skills.filter(s => groupOf(s) === id && (!q || `${s.name} ${s.description}`.toLowerCase().includes(q))).sort((a, b) => a.name.localeCompare(b.name));
  const count = (id: string) => skills.filter(s => groupOf(s) === id).length;
  const moveSkill = (key: string, id: string) => { const assign = { ...board.assign }; if (id === UNGROUPED) delete assign[key]; else assign[key] = id; save({ ...board, assign }); };

  const sortAll = () => {
    const next = [...groups], byName = new Map(groups.map(g => [g.name, g])), assign = { ...board.assign };
    // Only skills still loose are sorted; what the user placed stays where it is.
    for (const s of skills) {
      if (groupOf(s) !== UNGROUPED) continue;
      const name = autoGroup(s); if (!name) continue;
      if (!byName.has(name)) { const g = { id: newId(), name }; next.push(g); byName.set(name, g); }
      assign[s.key] = byName.get(name)!.id;
    }
    save({ groups: next, assign });
  };
  const addGroup = async () => {
    const name = (await ask.prompt("New group", "Group name", "", "Create"))?.trim(); if (!name) return;
    save({ ...board, groups: [...groups, { id: newId(), name }] });
  };
  const rename = async (g: Group) => {
    const name = (await ask.prompt("Rename group", "Group name", g.name))?.trim(); if (!name) return;
    save({ ...board, groups: groups.map(x => x.id === g.id ? { ...x, name } : x) });
  };
  const remove = async (g: Group) => {
    if (count(g.id) && !await ask.confirm(`Delete the group ${g.name}?`, { description: "Its skills go back to Ungrouped. The skills themselves stay installed.", action: "Delete group" })) return;
    save({ groups: groups.filter(x => x.id !== g.id), assign: Object.fromEntries(Object.entries(board.assign).filter(([, v]) => v !== g.id)) });
    if (filter === g.id) setFilter("all");
  };
  const drop = (e: React.DragEvent, id: string) => {
    e.preventDefault(); setOver(""); setDragging("");
    const key = e.dataTransfer.getData("text/x-skill"); if (key) { moveSkill(key, id); return; }
    // A group dropped on another group takes its place in the order.
    const from = e.dataTransfer.getData("text/x-group"); if (!from || from === id || id === UNGROUPED) return;
    const rest = groups.filter(g => g.id !== from), at = rest.findIndex(g => g.id === id);
    rest.splice(at, 0, groups.find(g => g.id === from)!); save({ ...board, groups: rest });
  };
  const accepts = (e: React.DragEvent) => e.dataTransfer.types.includes("text/x-skill") || e.dataTransfer.types.includes("text/x-group");

  const panel = (id: string, name: string, g?: Group, wide = false) => {
    const list = members(id);
    return (
      <section key={id} className={"sb-group" + (wide ? " wide" : "") + (over === id ? " over" : "") + (dragging ? " target" : "")}
        onDragOver={e => { if (accepts(e)) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (over !== id) setOver(id); } }}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(""); }} onDrop={e => drop(e, id)}>
        <header draggable={!!g} onDragStart={g ? e => { e.dataTransfer.setData("text/x-group", g.id); e.dataTransfer.effectAllowed = "move"; setDragging("group"); } : undefined} onDragEnd={() => { setDragging(""); setOver(""); }}
          onDoubleClick={g ? () => void rename(g) : undefined} title={g ? "Drag onto another group to reorder. Double-click to rename." : undefined}>
          <b>{name}</b><small>{count(id)}</small>
          {g && <button type="button" className="icon-button" aria-label={`Delete group ${name}`} title="Delete group" onClick={() => void remove(g)}><XMarkIcon /></button>}
        </header>
        <div className="sb-chips">
          {list.map(s => <button type="button" key={s.key} className={"sb-chip" + (s.enabled ? "" : " off")} draggable title={s.description || s.name}
            onClick={() => setOpen(s)} onDragStart={e => { e.dataTransfer.setData("text/x-skill", s.key); e.dataTransfer.effectAllowed = "move"; setDragging("skill"); }} onDragEnd={() => { setDragging(""); setOver(""); }}>{s.name}</button>)}
          {!list.length && <span className="sb-empty">{q ? "No match" : id === UNGROUPED ? "Every skill is in a group." : "Drag skills here"}</span>}
        </div>
      </section>
    );
  };
  const shownGroups = filter === "all" ? groups : groups.filter(g => g.id === filter);

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
      {(filter === "all" || filter === UNGROUPED) && (count(UNGROUPED) > 0 || filter === UNGROUPED) && panel(UNGROUPED, "Ungrouped", undefined, true)}
      {filter !== UNGROUPED && <div className="sb-grid">{shownGroups.map(g => panel(g.id, g.name, g))}</div>}
      <p className="skill-hint sb-tip">{groups.length ? "" : "No groups yet. "}Sort into groups makes groups from what each skill does; you can also ask the boss, for example "sort my skills into groups", and it arranges this board for you. Click a skill to read it.</p>

      {open && <Dialog title={open.name} size="lg" onClose={() => setOpen(null)} description={open.where}
        footer={<>
          <label className="field sb-move">Group<select value={groupOf(open)} onChange={e => moveSkill(open.key, e.target.value)}>
            <option value={UNGROUPED}>Ungrouped</option>{groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select></label>
          <span className="mem-spacer" />
          <Button className="primary" onClick={() => setOpen(null)}>Done</Button>
        </>}>
        <div className="sb-detail">
          {!open.enabled && <p className="skill-warn">This skill is turned off.</p>}
          {open.description && <p className="sb-desc">{open.description}</p>}
          <div className="sb-md">{text === null ? <p className="skill-hint">Loading…</p> : text ? <Markdown text={body(text)} /> : <p className="skill-hint">Could not read this skill.</p>}</div>
        </div>
      </Dialog>}
    </div>
  );
}
