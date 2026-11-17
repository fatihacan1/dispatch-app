import React, { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState } from "react";
const Office = lazy(() => import("../office/Office").then(m => ({ default: m.Office })));
const IdePanel = lazy(() => import("../ide/IdePanel"));
import type { OpenRequest } from "../ide/IdePanel";
import { Terminals, type Shell } from "../ide/Terminals";
import { afterFirstPaint, hideBoot, setBootStatus, waitForResponsive } from "../theme/boot";
import { ThemeSettings } from "../theme/ThemeSettings";
import { Dictation, joinSpoken } from "../voice/dictation";
import { Visualizer } from "../voice/Visualizer";
import { VoiceSettings } from "../voice/VoiceSettings";
import { TerminalSettings } from "../components/TerminalSettings";
import { ProjectTabs } from "./Tabs";
import { getLang, setLang, type Lang } from "../lib/i18n";
import { CopyButton } from "../components/CopyButton";
import { MentionMenu, mentionItems, rankMentions, type MentionItem } from "../components/MentionMenu";
import { Avatar } from "../components/Avatar";
import {
  ChatBubbleLeftRightIcon, ChevronDownIcon, Cog6ToothIcon, CpuChipIcon, ServerStackIcon, DocumentIcon, DocumentTextIcon, EnvelopeIcon,
  CheckIcon, CodeBracketIcon, FolderIcon, LinkIcon, MicrophoneIcon, HomeIcon, MagnifyingGlassIcon, PaperAirplaneIcon, PaperClipIcon, PlusIcon, Squares2X2Icon, StopIcon, CubeIcon, WrenchScrewdriverIcon, PuzzlePieceIcon, TrashIcon, XMarkIcon, BookOpenIcon, ArrowsRightLeftIcon, CircleStackIcon, BeakerIcon, ViewColumnsIcon,
} from "@heroicons/react/16/solid";
import { ArrowDownIcon } from "@heroicons/react/20/solid";
import { Skills } from "./Skills";
import { Share } from "./Share";
import { Connectors } from "./Connectors";
import { Schedules } from "../components/Schedules";
import { UsageSwitch } from "../components/Usage";
import type { Account } from "../lib/types";
import { Button, Console, ProviderIcon, StatusDot, models, type Tone } from "../components/common";
import { EnlistDialog } from "../components/EnlistDialog";
import { Dialog } from "../components/Dialog";
import { PanelIcon } from "../components/PanelIcon";
import { ask, AskHost } from "../components/ask";
import { Templates } from "./Templates";
import { Providers } from "./Providers";
import { Tools } from "./Tools";
import { Memory, MemorySettings } from "./Memory";
import { Tasks, needsLook } from "./Tasks";
import type { TaskCard } from "../lib/types";
import { RemoteRailButton, RemoteSettings } from "./Remote";
import { Servers, RailServers, ServerApprovals } from "./Servers";import { Markdown, firstSentence } from "../components/Markdown";
import { Sidebar, type AgentInfo } from "./Sidebar";
import { providers, labels } from "../lib/data";
import type { AgentQuestion, Message } from "../lib/types";
import { QuestionCard } from "../components/QuestionCard";

type Timed = Message & { time?: number };
function AttachmentPreview({ file }: { file: File }) {
  const [url, setUrl] = useState("");
  useEffect(() => { if (!file.type.startsWith("image/")) return; const next = URL.createObjectURL(file); setUrl(next); return () => URL.revokeObjectURL(next); }, [file]);
  return url ? <img src={url} alt="" /> : <DocumentIcon aria-hidden="true" />;
}
function SentAttachment({ path }: { path: string }) {
  const [file, setFile] = useState<{ name: string; image?: string } | null>(null);
  useEffect(() => { let active = true; if (window.army.attachmentPreview) window.army.attachmentPreview(path).then(value => { if (active) setFile(value); }).catch(() => {}); return () => { active = false; }; }, [path]);
  if (!file) return <div className="sent-attachment sent-file">Attachment unavailable</div>;
  return <div className={"sent-attachment " + (file.image ? "sent-image" : "sent-file")}>{file.image ? <img src={file.image} alt={file.name} /> : <DocumentIcon aria-hidden="true" />}<span>{file.name}</span></div>;
}
function MessageBody({ message }: { message: Message }) {
  const marker = "Attachments (open these files):\n";
  const index = message.from === "you" ? message.text.lastIndexOf(marker) : -1;
  const before = index >= 0 ? message.text.slice(0, index).trimEnd() : message.text;
  const lines = index >= 0 ? message.text.slice(index + marker.length).split("\n") : [];
  const valid = lines.length > 0 && lines.every(line => /^- (?:[A-Za-z]:[\\/]|\/)/.test(line));
  if (!valid) return <Markdown text={message.text} />;
  return <>{before && <Markdown text={before} />}<div className="sent-attachments">{lines.map((line, index) => <SentAttachment path={line.slice(2)} key={`${line}-${index}`} />)}</div></>;
}
// Traffic between agents (orders, reports) stays out of the way: one sentence until clicked. Talk with you is always open.
const collapsible = (m: Message) => m.from !== "you" && m.to !== "you" && m.to !== "user" && m.text.length > 220;
function ChatMessage({ message, children }: { message: Message; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  if (!collapsible(message)) return <>{children}<MessageBody message={message} /></>;
  return <>
    {children}
    <button type="button" className="msg-fold" aria-expanded={open} onClick={() => setOpen(!open)}>
      <span className="msg-fold-text">{firstSentence(message.text)}</span>
      <ChevronDownIcon aria-hidden="true" />
    </button>
    <div className={"msg-fold-body" + (open ? " open" : "")}><div><MessageBody message={message} /></div></div>
  </>;
}
type Step = { kind: "thinking" | "tool" | "text"; text: string };
type Trail = { steps: Step[]; live: boolean; since: number; took?: number };
const duration = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`; };
// The same small star the CLIs spin while they think.
const SPARK = ["·", "✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳", "✢"];
function Spark() {
  const [i, setI] = useState(4);
  useEffect(() => { if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return; const id = window.setInterval(() => setI(v => (v + 1) % SPARK.length), 130); return () => window.clearInterval(id); }, []);
  return <span className="trail-spark" aria-hidden="true">{SPARK[i]}</span>;
}
function Elapsed({ since }: { since: number }) {
  const [, tick] = useState(0);
  useEffect(() => { const id = window.setInterval(() => tick(v => v + 1), 1000); return () => window.clearInterval(id); }, []);
  return <span className="trail-time">{duration(Date.now() - since)}</span>;
}
/** What the agent is doing right now (thinking, tool calls, what it says between them); folds to one line when the turn ends. */
function ActivityTrail({ steps, live, since, took, provider }: { steps: Step[]; live: boolean; since: number; took?: number; provider: string }) {
  const [open, setOpen] = useState(false);
  if (!steps.length && !live) return null;
  const tools = steps.filter(s => s.kind === "tool").length;
  const last = steps.at(-1);
  const verb = !last || last.kind === "thinking" ? "Thinking" : last.kind === "tool" ? "Working" : "Writing";
  const shown = open ? steps : live ? steps.slice(-4) : [];
  const offset = steps.length - shown.length;
  return <div className={"trail" + (live ? " is-live" : "")}>
    <button type="button" className="trail-head" aria-expanded={open} disabled={!steps.length} onClick={() => setOpen(!open)}>
      {live ? (provider === "claude" ? <Spark /> : <ProviderIcon className="trail-icon" provider={provider} alt="" aria-hidden="true" />) : <CheckIcon className="trail-done" aria-hidden="true" />}
      <span className="trail-title">{live ? `${verb}…` : took ? `Worked for ${duration(took)}` : "Done"}</span>
      {live && <Elapsed since={since} />}
      {tools > 0 && <span className="trail-count">{tools} {tools === 1 ? "step" : "steps"}</span>}
      {steps.length > 0 && <ChevronDownIcon className="trail-chev" aria-hidden="true" />}
    </button>
    {shown.length > 0 && <ol className="trail-steps">{shown.map((s, i) => {
      const cut = s.text.indexOf(" · ");
      return <li key={offset + i} className={"trail-" + s.kind}>
        {s.kind === "text" ? <Markdown text={s.text} /> : s.kind === "thinking" ? (s.text || "Thinking") : cut > 0 ? <><b>{s.text.slice(0, cut)}</b><span>{s.text.slice(cut + 3)}</span></> : <b>{s.text}</b>}
      </li>;
    })}</ol>}
  </div>;
}
/** Hover card: which agent this is, what it is for, what it runs on and who it reports to. */
function AgentId({ agent, template }: { agent: AgentInfo; template?: any }) {
  const kind = agent.name === "boss" ? "Boss" : template?.temporary ? "Temporary agent" : template?.name && template.name !== agent.name ? `${template.name} template` : "Agent";
  return <span className="agent-id" tabIndex={0}>
    <ProviderIcon className="row-icon" provider={agent.provider} alt="" />
    <b>{agent.name}</b>
    <span className="tip" role="tooltip">
      <span className="tip-head"><ProviderIcon className="row-icon lg" provider={agent.provider} alt="" /><span className="row-text"><b>{agent.name}</b><small>{kind}</small></span></span>
      {template?.description && <span className="tip-desc">{template.description}</span>}
      <span className="tip-rows">
        <span>Provider</span><b>{labels[agent.provider] || agent.provider.replace(/^local:/, "Local · ")}</b>
        <span>Model</span><b>{agent.model}</b>
        {template?.effort && <><span>Effort</span><b>{template.effort}</b></>}
        {template?.permission && <><span>Permission</span><b>{PERMISSION_LABEL[template.permission] || template.permission}</b></>}
        <span>Reports to</span><b>{agent.name === "boss" ? "you" : agent.enlistedBy && agent.enlistedBy !== "user" ? agent.enlistedBy : "boss"}</b>
        <span>Status</span><b><StatusDot tone={agent.tone} label={agent.status} /></b>
      </span>
    </span>
  </span>;
}
const clean = (e: unknown) => String(e).replace(/^Error: Error invoking remote method '[^']+': (Error: )?/, "");
const PERMISSION_LABEL: Record<string, string> = {
  acceptEdits: "Accept edits", bypassPermissions: "Bypass permissions", plan: "Plan only",
  "read-only": "Sandbox: read-only", "workspace-write": "Sandbox: workspace write", "danger-full-access": "Sandbox: full access", never: "Never ask for approval", bypass: "Bypass approvals and sandbox",
  "accept-edits": "Accept edits", auto: "Auto",
};
const ago = (date: string) => { const s = (Date.now() - new Date(date).getTime()) / 1000; return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : new Date(date).toLocaleDateString(); };
// Links typed or pasted into the message box: shown blue in the text (a mirror layer under the textarea) and as chips.
const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+[^\s<>"'`.,;:!?)\]}]/gi;
const findLinks = (text: string) => [...new Set(text.match(URL_RE) || [])].slice(0, 6);
const linkLabel = (u: string) => { try { const x = new URL(u); return x.hostname.replace(/^www\./, "") + (x.pathname.length > 1 ? x.pathname : ""); } catch { return u; } };
function splitLinks(text: string) {
  const out: { text: string; link: boolean }[] = []; let at = 0;
  for (const m of text.matchAll(URL_RE)) { if (m.index! > at) out.push({ text: text.slice(at, m.index), link: false }); out.push({ text: m[0], link: true }); at = m.index! + m[0].length; }
  if (at < text.length) out.push({ text: text.slice(at), link: false });
  return out;
}
const DEMO_FILES = [{ path: "src/auth/session.ts", add: 42, del: 8 }, { path: "src/auth/refresh.ts", add: 18, del: 3 }, { path: "test/refresh.test.ts", add: 64, del: 0 }];
const NAV: [string, string, string, React.ComponentType<React.SVGProps<SVGSVGElement>>][] = [
  ["home", "Home", "Home", HomeIcon],
  ["agent", "Chat", "Operation", ChatBubbleLeftRightIcon],
  ["overview", "Overview", "Overview", Squares2X2Icon],
  ["comms", "Messages", "Messages", EnvelopeIcon],
  ["tasks", "Tasks", "Task board", ViewColumnsIcon],
  ["templates", "Templates", "Agent templates", DocumentTextIcon],
  ["providers", "Providers", "Providers", CpuChipIcon],
  ["tools", "Tools", "Tools", WrenchScrewdriverIcon],
  ["mcp", "MCP", "MCP apps", PuzzlePieceIcon],
  ["skills", "Skills", "Skills", BookOpenIcon],
  ["memory", "Memory", "Boss memory", CircleStackIcon],
  ["share", "Share", "Export and import", ArrowsRightLeftIcon],
  ["servers", "Servers", "Servers", ServerStackIcon],
  ["settings", "Settings", "Settings", Cog6ToothIcon],
];

export function App() {
  const [operations, setOperations] = useState<any[]>([]);
  const [workspaces, setWorkspaces] = useState<string[]>([]);
  const [workspaceMenu, setWorkspaceMenu] = useState(false);
  const [serverFocus, setServerFocus] = useState<{ id: string; n: number } | null>(null);
  const [enlisting, setEnlisting] = useState(false);
  const [enlistedBy, setEnlistedBy] = useState<Record<string, string>>({});
  const [chatList, setChatList] = useState<any[]>([]);
  const [activeChat, setActiveChat] = useState<string | null>(null);
  const [archive, setArchive] = useState<any>(null);
  const [thread, setThread] = useState("all");
  const [agentTemplates, setAgentTemplates] = useState<Record<string, any>>({});
  const [workspace, setWorkspace] = useState("");
  const [needsFolder, setNeedsFolder] = useState(false);
  const [tabEnter, setTabEnter] = useState(0);
  useEffect(() => (window as any).army.on("tab-shown", () => setTabEnter(n => n + 1)), []);
  const [macFs, setMacFs] = useState(false);
  useEffect(() => (window as any).army.on("window-fullscreen", (v: boolean) => setMacFs(!!v)), []);
  const [demo, setDemo] = useState(false);
  const [mock, setMock] = useState(false);
  const [agents, setAgents] = useState<string[]>([]);
  const [attention, setAttention] = useState<Record<string, string>>({});
  // Trust prompt: a modal over the whole app instead of a button in the attention bar.
  const [trustLater, setTrustLater] = useState(false);
  const [trusting, setTrusting] = useState(false);
  const [trustManual, setTrustManual] = useState<string[]>([]);
  const [stopped, setStopped] = useState<Record<string, boolean>>({});
  const [agentMenu, setAgentMenu] = useState<string | null>(null);
  const [dismissAgent, setDismissAgent] = useState<{ name: string; working: boolean } | null>(null);
  const [selected, setSelected] = useState("boss");
  const [view, setView] = useState("agent");
  const [providerFocus, setProviderFocus] = useState("");
  const [packFile, setPackFile] = useState<string | null>(null);
  // A .dispatch file opened from the OS (double-click, or dropped onto the app icon) goes to Share > Import.
  useEffect(() => {
    const show = (file: string | null) => { if (file) { setPackFile(file); setView("share"); } };
    void window.army.packs?.pending().then(show);
    return window.army.on("pack-open", (file: string) => { void window.army.packs.pending(); show(file); });
  }, []);
  const [mode, setMode] = useState<"chat" | "terminal">("chat");
  const [messages, setMessages] = useState<Timed[]>([]);
  const [text, setText] = useState("");
  const links = findLinks(text);
  const mirror = useRef<HTMLDivElement>(null);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [sending, setSending] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // Voice typing: dictated words go in at the caret; the open segment (partial) is replaced on every decode.
  const [voice, setVoice] = useState<"off" | "starting" | "on">("off");
  const [voiceAnalyser, setVoiceAnalyser] = useState<AnalyserNode | null>(null);
  const dict = useRef<Dictation | null>(null);
  const textArea = useRef<HTMLTextAreaElement>(null);
  // "@" in the message box: a list of workspace files and folders opens above it; dragging a row from the file tree
  // drops the same @path. The list is read when the menu first opens and kept for 30 s.
  const [mention, setMention] = useState<{ start: number; query: string; index: number } | null>(null);
  const [mentionAll, setMentionAll] = useState<{ items: MentionItem[]; at: number; loading: boolean }>({ items: [], at: 0, loading: false });
  const mentionList = mention ? rankMentions(mentionAll.items, mention.query) : [];
  const findMention = (value: string, caret: number) => {
    const m = /(?:^|\s)@([^\s@]*)$/.exec(value.slice(0, caret));
    if (!m) { setMention(null); return; }
    setMention(v => ({ start: caret - m[1].length - 1, query: m[1], index: v && v.query === m[1] ? v.index : 0 }));
    if (!mentionAll.loading && Date.now() - mentionAll.at > 30000) {
      setMentionAll(v => ({ ...v, loading: true }));
      window.army.files.all().then((files: string[]) => setMentionAll({ items: mentionItems(files || []), at: Date.now(), loading: false })).catch(() => setMentionAll(v => ({ ...v, loading: false, at: Date.now() })));
    }
  };
  const insertPath = (path: string, from?: number, to?: number) => {
    const el = textArea.current; const start = from ?? el?.selectionStart ?? text.length, end = to ?? el?.selectionEnd ?? start;
    const before = text.slice(0, start), lead = from === undefined && before && !/\s$/.test(before) ? " " : "";
    const insert = `${lead}@${path} `, next = before + insert + text.slice(end);
    setText(next); setMention(null);
    requestAnimationFrame(() => { const t = textArea.current; if (!t) return; t.focus(); const at = start + insert.length; t.setSelectionRange(at, at); });
  };
  const pickMention = (item: MentionItem) => { if (!mention) return; insertPath(item.path, mention.start, textArea.current?.selectionStart ?? mention.start + mention.query.length + 1); };
  const vBase = useRef(""), vPos = useRef(0), vPartial = useRef("");
  const showSpoken = () => { const b = vBase.current, p = vPos.current; setText(b.slice(0, p) + joinSpoken(b.slice(0, p), vPartial.current) + b.slice(p)); };
  const startVoice = async () => {
    if (dict.current) return;
    const st = await window.army.voice.status().catch(() => null);
    if (!st?.installed) { setError("Voice typing is not installed yet. Install it under Tools, Voice typing."); return; }
    vBase.current = text; vPos.current = textArea.current?.selectionStart ?? text.length; vPartial.current = "";
    const d = new Dictation({
      partial: t => { vPartial.current = t; showSpoken(); },
      commit: t => { const b = vBase.current, p = vPos.current, add = joinSpoken(b.slice(0, p), t); vBase.current = b.slice(0, p) + add + b.slice(p); vPos.current = p + add.length; vPartial.current = ""; showSpoken(); },
      error: m => setError(m),
    }, st.mic);
    dict.current = d; setVoice("starting");
    try { await d.start(); setVoiceAnalyser(d.analyser); setVoice("on"); textArea.current?.focus(); }
    catch (e) { d.cancel(); dict.current = null; setVoice("off"); setError("Microphone: " + clean(e)); }
  };
  const stopVoice = async () => {
    const d = dict.current; if (!d) return text;
    // "starting" doubles as "finishing": the last words are still being decoded.
    setVoice("starting"); setVoiceAnalyser(null);
    await d.stop();
    if (dict.current === d) { dict.current = null; vPartial.current = ""; setText(vBase.current); setVoice("off"); }
    return vBase.current;
  };
  useEffect(() => () => dict.current?.cancel(), []);
  // Global shortcut: Dispatch focused = toggle the chat mic; otherwise the overlay types into the chat box live (never sends).
  const ovBase = useRef<string | null>(null);
  const voiceEvents = useRef({ toggle: () => {}, result: (_t: string) => {}, live: (_t: string) => {} });
  voiceEvents.current = {
    toggle: () => { if (dict.current) void stopVoice(); else { setView("agent"); setMode("chat"); void startVoice(); } },
    live: (t: string) => setText(v => { if (ovBase.current === null) ovBase.current = v; const b = ovBase.current; return t ? b + joinSpoken(b, t) : b; }),
    result: (t: string) => { setText(v => { const b = ovBase.current ?? v; ovBase.current = null; return b + joinSpoken(b, t); }); setView("agent"); setMode("chat"); },
  };
  useEffect(() => {
    const a = window.army.on("voice-toggle", () => voiceEvents.current.toggle());
    const b = window.army.on("voice-result", (t: string) => voiceEvents.current.result(t));
    const c = window.army.on("voice-live", (t: string) => voiceEvents.current.live(t));
    return () => { a(); b(); c(); };
  }, []);
  const listEnd = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const addFiles = (files: FileList | File[]) => {
    const incoming = Array.from(files);
    if (incoming.some(f => !window.army.pathFor(f) && f.size > 200 * 1024 * 1024)) { setError("Pasted or remote attachments must be 200 MB or smaller. Drop big files from a folder instead."); return; }
    setAttachments(previous => {
      if (previous.length + incoming.length > 10) { setError("Attach up to 10 files at a time."); return previous; }
      return [...previous, ...incoming];
    });
  };
  useEffect(() => {
    const preventFileDrop = (event: DragEvent) => { if (event.dataTransfer?.types.includes("Files")) event.preventDefault(); };
    window.addEventListener("dragover", preventFileDrop); window.addEventListener("drop", preventFileDrop);
    return () => { window.removeEventListener("dragover", preventFileDrop); window.removeEventListener("drop", preventFileDrop); };
  }, []);
  const [provider, setProvider] = useState("claude");
  const [bossTemplates, setBossTemplates] = useState<any[]>([]);
  const [localProviders, setLocalProviders] = useState<{ id: string; name: string; model: string }[]>([]);
  const [modelLists, setModelLists] = useState<Record<string, string[]>>({});
  const [effortLists, setEffortLists] = useState<Record<string, string[]>>({});
  const [permissionLists, setPermissionLists] = useState<Record<string, string[]>>({});
  const [bossFile, setBossFile] = useState("");
  const [bossModel, setBossModel] = useState("");
  const [changingBoss, setChangingBoss] = useState(false);
  const [bossSource, setBossSource] = useState("template");
  const [switchingBoss, setSwitchingBoss] = useState(false);
  const [switchMode, setSwitchMode] = useState<"account" | "provider">("account");
  const [bossAccounts, setBossAccounts] = useState<Account[]>([]);
  const [switchAccountId, setSwitchAccountId] = useState("");
  const [switchProvider, setSwitchProvider] = useState("");
  const [switchBusy, setSwitchBusy] = useState(false);

  const openSwitchBoss = async () => {
    const curProv = agentTemplates.boss?.provider || "claude";
    const supportsAccounts = ["claude", "codex"].includes(curProv);
    const otherProviders = ["claude", "codex", "antigravity", "opencode", "qoder", "gemini"].filter(p => p !== curProv);
    setSwitchProvider(otherProviders[0] || "claude");
    setSwitchMode(supportsAccounts ? "account" : "provider");
    setSwitchingBoss(true);
    if (supportsAccounts && window.army.accounts) {
      try {
        const list = await window.army.accounts.list(curProv);
        setBossAccounts(list);
        const curAcc = list.find(a => a.active) || list[0];
        setSwitchAccountId(curAcc?.id || "default");
      } catch { setBossAccounts([]); }
    } else {
      setBossAccounts([]);
    }
  };
  const bossWorkspace = useRef<string | null>(null);
  useEffect(() => {
    const load = async () => {
      // A first IPC call made while the window is still booting can stay pending; time out and retry.
      const result = await Promise.race([window.army.templates.list(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 2000))]);
      const bosses = result.items.filter((t: any) => t.extra?.role === "boss");
      // A project copy shadows the built-in template of the same name.
      const unique = bosses.filter((t: any, i: number) => bosses.findIndex((x: any) => x.name.toLowerCase() === t.name.toLowerCase()) === i);
      setBossTemplates(unique); setModelLists(result.models); setEffortLists(result.efforts || {}); setPermissionLists((result as any).permissions || {}); setLocalProviders((result as any).localProviders || []);
      const workspaceChanged = bossWorkspace.current !== workspace;
      bossWorkspace.current = workspace;
      const preferred = unique.find((t: any) => t.scope === "project") || unique[0];
      setBossFile(current => {
        if (!workspaceChanged && unique.some((t: any) => t.file === current)) return current;
        if (preferred) { setProvider(preferred.provider); setBossModel(preferred.model || "default"); }
        return preferred?.file || "";
      });
    };
    // The main process may still be registering IPC handlers on first paint: retry until it answers.
    let tries = 0;
    const first = () => load().then(() => setBootReady(b => b.templates ? b : { ...b, templates: true })).catch(e => {
      if (++tries < 20) setTimeout(first, 300);
      else { console.error("templates load failed", e); setBootReady(b => b.templates ? b : { ...b, templates: true }); }
    });
    void first();
    return window.army.on("templates-changed", () => void load().catch(e => console.error("templates load failed", e)));
  }, [workspace]);
  useEffect(() => {
    if (!bossFile && bossTemplates.length) {
      const chosen = bossTemplates[0]; setBossFile(chosen.file); setProvider(chosen.provider); setBossModel(chosen.model || "default");
    }
  }, [bossFile, bossTemplates]);
  const chooseBoss = (file: string) => { const t = bossTemplates.find(x => x.file === file); setBossFile(file); if (t) { setProvider(t.provider); setBossModel(t.model || "default"); } };
  const bossPicker = <div className="boss-picker">
    <label className="field">Boss template<select aria-label="Boss template" value={bossFile} onChange={e => chooseBoss(e.target.value)}>{bossTemplates.map(t => <option key={t.file} value={t.file}>{t.name} · {t.scope === "built-in" ? "Default" : t.scope === "project" ? "Project" : t.scope === "global" ? "Global" : "Claude Code"}</option>)}</select></label>
    <label className="field">Provider<select aria-label="Provider" value={provider} onChange={e => { setProvider(e.target.value); setBossModel(modelLists[e.target.value]?.[0] || "default"); }}>{providers.filter(p => p !== "local").map(p => <option key={p} value={p}>{labels[p]}</option>)}{localProviders.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}{provider === "local" && <option value="local">Local AI (legacy)</option>}</select></label>
    <label className="field">Model<select aria-label="Model" value={bossModel} onChange={async e => { if (e.target.value !== "__custom") { setBossModel(e.target.value); return; } const id = await ask.prompt("Custom model", "Model id", bossModel); if (id) setBossModel(id); }}>{Array.from(new Set([...(modelLists[provider] || []), bossModel].filter(Boolean))).map(m => <option key={m} value={m}>{m}</option>)}<option value="__custom">Custom…</option></select></label>
  </div>;
  const selectedBoss = () => ({ ...bossTemplates.find(t => t.file === bossFile), provider, model: bossModel });
  const [toast, setToast] = useState<{ text: string; tone: Tone } | null>(null);
  const error = toast?.text || "";
  // Good news leaves by itself; an error stays until it is dismissed.
  useEffect(() => { if (!toast || toast.tone === "error") return; const id = window.setTimeout(() => setToast(null), 6000); return () => window.clearTimeout(id); }, [toast]);
  const setError = (text: string) => setToast(text ? { text, tone: "error" } : null);
  const [sidebar, setSidebar] = useState(true);
  const [stageH, setStageH] = useState(380);
  const startResize = (e: React.PointerEvent<HTMLDivElement>) => { const startY = e.clientY, start = stageH, box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect(); const move = (ev: PointerEvent) => setStageH(Math.min(box.height - 220, Math.max(160, start + ev.clientY - startY))); const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); document.body.classList.remove("resizing"); }; document.body.classList.add("resizing"); window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); };
  const [office, setOffice] = useState(true);
  const [bootReady, setBootReady] = useState({ main: false, info: false, ui: false, templates: false, office: false, files: false });
  const [bootResuming, setBootResuming] = useState(false);
  const [wsLoading, setWsLoading] = useState<string | null>(null);
  const bootSettling = useRef(false);
  // The 3D/2D office scene is heavy: it mounts after the first paint behind the boot loader.
  const [heavyOk, setHeavyOk] = useState(false);
  useEffect(() => afterFirstPaint(() => setHeavyOk(true), 100), []);
  // IDE panel left of the chat. Mounted on first open and kept, so tabs survive closing it.
  const [ide, setIde] = useState(false);
  const [ideMounted, setIdeMounted] = useState(false);
  const [ideW, setIdeW] = useState(640);
  // Width of the panel while it is only the file tree (no file open): its own size, so the tree resizes too.
  const [treeW, setTreeW] = useState(260);
  const [ideReq, setIdeReq] = useState<OpenRequest | null>(null);
  // The chat keeps at least 400px: the panel width is clamped to the room there is.
  const workbench = useRef<HTMLDivElement>(null);
  const [wbWidth, setWbWidth] = useState(10000);
  useEffect(() => {
    const el = workbench.current; if (!el) return;
    const ro = new ResizeObserver(() => setWbWidth(el.clientWidth)); ro.observe(el);
    return () => ro.disconnect();
  }, [view, agents.length]);
  // Settings > Appearance (stored in ~/.dispatch/ui.json): menu icons and Files panel behaviour.
  const [prefs, setPrefs] = useState<{ navIcons?: "mono" | "color"; ideEditorOnFile?: boolean; ideTreeToggle?: boolean }>({});
  const setPref = (patch: Partial<typeof prefs>) => { setPrefs(p => ({ ...p, ...patch })); void window.army.ui?.set(patch).catch(() => {}); };
  const [ideCompact, setIdeCompact] = useState(false);
  useEffect(() => {
    const uiApi = window.army.ui;
    if (!uiApi) { setBootReady(b => ({ ...b, ui: true })); return; }
    void uiApi.get().then((u: any) => {
      setPrefs({ navIcons: u?.navIcons, ideEditorOnFile: !!u?.ideEditorOnFile, ideTreeToggle: !!u?.ideTreeToggle });
      if (u?.ideWidth) setIdeW(u.ideWidth);
      if (u?.ideTreeWidth) setTreeW(u.ideTreeWidth);
      if (u?.ideOpen) { setIdeMounted(true); setIde(true); }
    }).catch(() => {}).finally(() => setBootReady(b => b.ui ? b : { ...b, ui: true }));
  }, []);
  const toggleIde = (next?: boolean) => setIde(v => { const on = next ?? !v; if (on) setIdeMounted(true); void window.army.ui?.set({ ideOpen: on }); return on; });
  // User terminals (PowerShell in the workspace), shown under the editor.
  const [shells, setShells] = useState<Shell[]>([]);
  const [shellActive, setShellActive] = useState<string | null>(null);
  const [termOpen, setTermOpen] = useState(false);
  const [termH, setTermH] = useState(260);
  useEffect(() => { const load = () => window.army.shells.list().then(setShells).catch(() => {}); void load(); return window.army.on("shells-changed", load); }, []);
  const openShell = async (name?: string) => {
    const target = name || (await window.army.shells.open());
    setShellActive(target); setTermOpen(true); setView("agent"); toggleIde(true);
  };
  const toggleTerminal = () => { if (termOpen) { setTermOpen(false); return; } setView("agent"); if (shells.length) { setTermOpen(true); toggleIde(true); } else void openShell(); };
  const toggleTerminalRef = useRef(toggleTerminal); toggleTerminalRef.current = toggleTerminal;
  const openInIde = (path: string) => { toggleIde(true); setIdeReq({ path, diff: true, nonce: Date.now() }); };
  const startIdeResize = (e: React.PointerEvent<HTMLDivElement>) => {
    const tree = ideCompact, startX = e.clientX, start = tree ? treeW : ideW, box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    let last = start;
    // The width goes straight onto the CSS variable while dragging; re-rendering the whole app (chat, office scene) on
    // every mouse move made the handle lag, worst right after the panel opened. React gets the final width on release.
    let frame = 0;
    const move = (ev: PointerEvent) => {
      last = Math.round(tree ? Math.min(520, Math.max(240, start + ev.clientX - startX)) : Math.min(box.width * 0.7, Math.max(420, start + ev.clientX - startX)));
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; workbench.current?.style.setProperty("--ide-w", (tree ? last : Math.max(320, Math.min(last, box.width - 407))) + "px"); });
    };
    const up = () => { cancelAnimationFrame(frame); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); document.body.classList.remove("resizing", "resizing-x"); if (tree) { setTreeW(last); void window.army.ui?.set({ ideTreeWidth: last }); } else { setIdeW(last); void window.army.ui?.set({ ideWidth: last }); } };
    document.body.classList.add("resizing", "resizing-x"); window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  const [working, setWorking] = useState<Record<string, boolean>>({});
  // Changed files come from git; refreshed while the side panel is open. null = no repo here, so the tab hides.
  const [gitFiles, setGitFiles] = useState<{ path: string; add: number; del: number }[] | null>(null);
  useEffect(() => {
    if (demo || !sidebar) return;
    let alive = true;
    const load = () => window.army.gitChanges().then(f => { if (alive) setGitFiles(f); }).catch(() => alive && setGitFiles(null));
    void load(); const id = window.setInterval(load, 5000);
    return () => { alive = false; window.clearInterval(id); };
  }, [demo, sidebar, workspace]);
  const [trail, setTrail] = useState<Record<string, Trail>>({});
  const [questions, setQuestions] = useState<Record<string, AgentQuestion>>({});
  useEffect(() => window.army.on("activity", (e: { name: string; steps: Step[]; turn?: boolean; dropLastText?: boolean }) => setTrail(t => {
    const now = Date.now(), old = t[e.name];
    // A turn Dispatch already showed as started (the message was just sent) keeps its clock.
    const prev: Trail = e.turn === true ? { steps: [], live: true, since: old?.live && !old.steps.length ? old.since : now } : old || { steps: [], live: true, since: now };
    const steps = [...prev.steps, ...e.steps];
    // The closing text of a turn is the chat message itself, so it leaves the step list.
    if (e.dropLastText) { const i = steps.map(s => s.kind).lastIndexOf("text"); if (i >= 0) steps.splice(i, 1); }
    return { ...t, [e.name]: { steps: steps.slice(-80), live: e.turn === undefined ? prev.live : e.turn, since: prev.since, took: e.turn === false ? now - prev.since : e.turn === true ? undefined : prev.took } };
  })), []);
  // When each agent started working, for agents whose CLI has no transcript to follow.
  const [workSince, setWorkSince] = useState<Record<string, number>>({});
  // Bumped when every agent restarts (new chat), so terminals drop the old screen.
  const [epoch, setEpoch] = useState(0);
  const [savingTeam, setSavingTeam] = useState<{ name: string; scope: string } | null>(null);
  const [outputEvents, setOutputEvents] = useState<any[]>([]);
  useEffect(() => {
    const api = (window as any).army.outputs; if (!api) return;
    api.list().then(setOutputEvents).catch(() => {});
    return window.army.on("outputs", (items: any[]) => setOutputEvents(v => [...v, ...items].slice(-600)));
  }, [workspace]);
  const outputs = React.useMemo(() => {
    const norm = (f = "") => f.replace(/\\/g, "/").toLowerCase();
    const owner = new Map<string, string>();
    for (const e of outputEvents) if (e.kind === "job" && e.files) for (const f of e.files) owner.set(norm(f), e.agent);
    const map = new Map<string, any>();
    // A finished job also lists its files, so they show even if the folder watcher misses them.
    const events = outputEvents.flatMap(e => e.kind === "job" && e.files ? [e, ...e.files.map((file: string) => ({ time: e.time, tool: e.tool, agent: e.agent, kind: "file", file }))] : [e]);
    for (const e of events) {
      const key = e.kind === "download" || e.kind === "job" ? e.kind + ":" + e.id : "file:" + norm(e.file);
      const prev = map.get(key); map.delete(key);
      map.set(key, { ...prev, ...e, key, agent: e.agent || owner.get(norm(e.file)) || prev?.agent });
    }
    return [...map.values()].reverse().slice(0, 120);
  }, [outputEvents]);
  useEffect(() => {
    if (!agents.length) return;
    let alive = true;
    const poll = async () => {
      const entries = await Promise.all(agents.map(async a => [a, await window.army.isWorking(a).catch(() => false)] as const));
      if (!alive) return;
      // Same state again must not re-render the whole app (chat, office, sidebar) every 1.2 s: keep the old objects.
      setWorking(prev => { const next = Object.fromEntries(entries); return Object.keys(next).length === Object.keys(prev).length && entries.every(([a, on]) => prev[a] === on) ? prev : next; });
      setWorkSince(prev => { const next = Object.fromEntries(entries.filter(([, on]) => on).map(([a]) => [a, prev[a] || Date.now()])); const keys = Object.keys(next); return keys.length === Object.keys(prev).length && keys.every(k => prev[k] === next[k]) ? prev : next; });
    };
    void poll(); const id = window.setInterval(poll, 1200);
    return () => { alive = false; window.clearInterval(id); };
  }, [agents]);
  const [search, setSearch] = useState(false);
  const [query, setQuery] = useState("");
  useEffect(() => {
    const readyApi = (window as any).army.ready;
    if (readyApi) void readyApi().catch(() => {}).finally(() => setBootReady(b => b.main ? b : { ...b, main: true }));
    else setBootReady(b => b.main ? b : { ...b, main: true });
    window.army.info().then(async x => {
      setNeedsFolder(!!(x as any).needsFolder); setWorkspace(x.workspace); setDemo(x.demo); setMock(!!(x as any).mock); setOperations(x.operations); setWorkspaces(x.workspaces);
      if (x.operations[0]) { setBootResuming(true); await resume(x.operations[0].id, true); }
    }).catch(() => {}).finally(() => setBootReady(b => b.info ? b : { ...b, info: true }));
    const off = window.army.on("message", (incoming: Message) => setMessages(v => {
      const m: Timed = { ...incoming, time: Date.now() };
      if (v.some(x => x.id === m.id)) return v;
      // A message from the phone starts a turn just like one typed here: show the agent working right away.
      if (m.from === "you" && m.text.startsWith("[via Telegram")) setTrail(t => t[m.to]?.live ? t : { ...t, [m.to]: { steps: [], live: true, since: Date.now() } });
      const pending = v.findIndex(x => x.id.startsWith("pending-") && x.from === m.from && x.to === m.to && x.text === m.text);
      if (pending < 0) return [...v, m];
      return v.map((x, i) => i === pending ? m : x);
    }));
    window.army.attention.list().then(setAttention);
    window.army.questions?.list().then(setQuestions).catch(() => {});
    const offQuestion = window.army.on("question", ({ name, question }) => setQuestions(v => { const next = { ...v }; if (question) next[name] = question; else delete next[name]; return next; }));
    const offAttention = window.army.on("attention", ({ name, reason }) => setAttention(v => { const next = { ...v }; if (reason) next[name] = reason; else delete next[name]; return next; }));
    const offSendError = window.army.on("send-error", message => setError(String(message)));
    // "Needs you" can miss a clearing event (agent removed, tab switched): check it against the engine now and then.
    const attentionSync = window.setInterval(() => { window.army.attention.list().then(list => setAttention(v => JSON.stringify(v) === JSON.stringify(list) ? v : list)).catch(() => {}); }, 5000);
    const offEnlist = window.army.on("enlisted", a => { setAgents(v => v.includes(a.name) ? v : [...v, a.name]); setAgentTemplates(v => ({ ...v, [a.name]: a.template })); setEnlistedBy(v => ({ ...v, [a.name]: a.enlistedBy })); });
    const offAction = window.army.on("agent-action", ({ name, action }) => { if (action === "dismiss") setAgents(v => v.filter(a => a !== name)); else setStopped(v => ({ ...v, [name]: action === "stop" })); });
    return () => { off(); offEnlist(); offAction(); offSendError(); offAttention(); offQuestion(); window.clearInterval(attentionSync); };
  }, []);
  useEffect(() => { if (agents.includes(selected)) window.army.chats.list(selected).then(list => { setChatList(list); setArchive(null); setActiveChat(list.find(c => c.active)?.id || null); }); }, [selected, agents]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!e.ctrlKey) return;
      if (e.key >= "1" && e.key <= "9") { const a = agents[Number(e.key) - 1]; if (a) { e.preventDefault(); setSelected(a); setView("agent"); } }
      const k = e.key.toLowerCase();
      if (k === "t") { e.preventDefault(); setView("agent"); setMode(v => (v === "chat" ? "terminal" : "chat")); }
      if (k === "o") { e.preventDefault(); setView("overview"); }
      if (k === "k") { e.preventDefault(); setSearch(true); }
      if (k === "b") { e.preventDefault(); setSidebar(v => !v); }
      if (k === "j") { e.preventDefault(); setOffice(v => !v); }
      if (k === "e") { e.preventDefault(); setView("agent"); toggleIde(); }
      if (e.key === "`") { e.preventDefault(); toggleTerminalRef.current(); }
      if (k === "n" && !e.shiftKey && !e.altKey && agents.length) { e.preventDefault(); void newChatRef.current(); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [agents]);
  useEffect(() => {
    if (!agentMenu && !workspaceMenu) return;
    const away = (e: MouseEvent) => { const t = e.target as HTMLElement; if (!t.closest(".team-row, .workspace-wrap")) { setAgentMenu(null); setWorkspaceMenu(false); } };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setAgentMenu(null); setWorkspaceMenu(false); } };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [agentMenu, workspaceMenu]);
  const [teams, setTeams] = useState<{ file: string; name: string; members: any[]; boss?: any }[]>([]);
  const [homeTeam, setHomeTeam] = useState("");
  useEffect(() => { const load = () => window.army.teams.list().then(setTeams).catch(() => {}); void load(); return window.army.on("teams-changed", load); }, [workspace]);
  const [tasks, setTasks] = useState<TaskCard[]>([]);
  useEffect(() => { void window.army.tasks.list().then(setTasks).catch(() => {}); return window.army.on("tasks", (list: TaskCard[]) => setTasks(list)); }, [workspace, view === "tasks"]);
  const tasksNeedLook = needsLook(tasks);
  async function start(teamFile?: string) {
    try {
      const chosen = selectedBoss();
      const names = await window.army.start(chosen, teamFile);
      setAgentTemplates({ boss: chosen });
      setAgents(demo ? ["boss", "coder", "scout"] : names);
      setSelected(names[0] || "boss");
      setMessages([]); setStopped({}); setView("agent");
      setOperations(await window.army.operations.list());
    } catch (e) { setError(String(e)); }
  }
  /** spoken: text from the voice overlay, sent on its own without touching the draft or attachments. */
  async function send(spoken?: string) {
    let body = spoken ?? text;
    // Sending ends dictation; the last words are committed first.
    if (spoken === undefined && dict.current) body = await stopVoice();
    const files = spoken === undefined ? attachments : [];
    if ((!body.trim() && !files.length) || sending || archive) return;
    setSending(true);
    try {
      // The agent waits on a one-question menu: what is typed here answers it ("2" picks the second option).
      const asking = questions[selected];
      if (asking && asking.questions.length === 1 && !files.length && !body.trim().includes("\n")) {
        const q = asking.questions[0], t = body.trim();
        const nums = /^\d+(\s*[,\s]\s*\d+)*$/.test(t) ? t.split(/[,\s]+/).map(n => Number(n) - 1).filter(p => p >= 0 && p < q.options.length) : [];
        await window.army.questions.answer(selected, [nums.length ? { picks: q.multiSelect ? nums : nums.slice(0, 1) } : { picks: [], other: t }]);
        if (spoken === undefined) setText("");
        return;
      }
      // Files that live on this computer are sent as their path; only pasted (or remote) files are copied.
      const upload = files.filter(f => !window.army.pathFor(f));
      const saved = upload.length ? await window.army.saveAttachments(await Promise.all(upload.map(async file => ({ name: file.name, data: await file.arrayBuffer() })))) : [];
      const paths = files.map(f => window.army.pathFor(f) || saved[upload.indexOf(f)]);
      const content = [body.trim(), paths.length ? `Attachments (open these files):\n${paths.map(path => `- ${path}`).join("\n")}` : ""].filter(Boolean).join("\n\n");
      const outgoing: Timed = { id: `pending-${crypto.randomUUID()}`, from: "you", to: selected, text: content, time: Date.now() };
      setMessages(v => [...v, outgoing]);
      try {
        await window.army.send(outgoing.to, outgoing.text);
        if (spoken === undefined) { setText(""); setAttachments([]); }
        // Show the agent as thinking straight away; its transcript takes over within a second or two.
        if (!demo && !stopped[outgoing.to] && ["claude", "codex", "antigravity"].includes(agentProvider(outgoing.to))) setTrail(t => t[outgoing.to]?.live ? t : { ...t, [outgoing.to]: { steps: [], live: true, since: Date.now() } });
      }
      catch (e) { setMessages(v => v.filter(m => m.id !== outgoing.id)); throw e; }
    } catch (e) { setError(String(e)); }
    finally { setSending(false); }
  }
  const openWorkspace = async (target?: string) => {
    if (agents.length && !(await ask.confirm("Switch workspace?", { description: "Current agents will stop.", action: "Switch", danger: true }))) return;
    const next = await window.army.workspace(target);
    setWorkspaceMenu(false);
    const first = needsFolder; if (first && next !== workspace) setNeedsFolder(false);
    if (first || next !== workspace) {
      setWsLoading("Opening workspace");
      try {
        setWorkspace(next); setAgents([]); setAttention({}); setQuestions({}); setMessages([]);
        setView("agent"); setAgentTemplates({}); setEnlistedBy({});
        const info = await window.army.info(); setOperations(info.operations); setWorkspaces(info.workspaces);
        if (info.operations[0]) { setWsLoading("Resuming operation"); await resume(info.operations[0].id, true); }
        await waitForResponsive({ ready: (window as any).army.ready, onStatus: setWsLoading, timeoutMs: 20000 }).promise;
      } finally { setWsLoading(null); }
    }
  };
  // Opening a workspace continues its latest operation; Home is only for starting a new one.
  const resume = async (id: string, force = false) => {
    if (!force && agents.length && !(await ask.confirm("Resume this operation?", { description: "Current agents will stop.", action: "Resume", danger: true }))) return;
    try { const result = await window.army.operations.resume(id); const saved = result.operation.agents; setAgents(saved.map((a: any) => a.name)); setStopped(Object.fromEntries(saved.map((a: any) => [a.name, !!a.stopped]))); setAgentTemplates(Object.fromEntries(saved.map((a: any) => [a.name, a.template]))); setEnlistedBy(Object.fromEntries(saved.filter((a: any) => a.enlistedBy).map((a: any) => [a.name, a.enlistedBy]))); setMessages([...result.messages, ...result.notes.map((note: any, i: number) => ({ id: `resume-note-${i}`, from: "dispatch", to: note.name, text: note.text }))]); setSelected(saved[0]?.name || "boss"); setView("agent"); } catch (e) { setError(String(e)); }
  };
  const act = async (name: string, action: string) => {
    if (action === "dismiss") { try { setDismissAgent({ name, working: await window.army.isWorking(name) }); setAgentMenu(null); } catch (e) { setError(String(e)); } return; }
    if (action === "template") {
      setAgentMenu(null);
      const tplName = await ask.prompt("Save as template", "Template name", agentTemplates[name]?.name || name);
      if (!tplName?.trim()) return;
      try { await window.army.templates.saveAgent(name, tplName.trim(), "project"); setToast({ text: `Saved ${name} as the template "${tplName.trim()}". Find it under Agent templates.`, tone: "working" }); } catch (e) { setError(clean(e)); }
      return;
    }
    if (action === "model") { setAgentMenu(null); setSelected(name); setView("agent"); setMode("chat"); setTimeout(() => document.querySelector<HTMLSelectElement>(".model-switch")?.focus(), 80); return; }
    try { await window.army.agentAction(name, action); setAgentMenu(null); } catch (e) { setError(String(e)); }
  };
  const tplOf = (name: string) => agentTemplates[name] || { provider: agentProvider(name), model: models[agentProvider(name)] || "default" };
  const switchModel = async (name: string, model: string) => {
    const tpl = tplOf(name);
    if (model === "__custom") { const id = await ask.prompt("Custom model", "Model id", tpl.model || ""); if (!id) return; model = id; }
    if (model === tpl.model) return;
    const restarts = tpl.provider !== "claude" && !stopped[name];
    try {
      if (restarts) {
        const resumes = tpl.provider === "codex";
        const busy = await window.army.isWorking(name);
        const description = (busy ? "Agent is working; switching now interrupts the current task. " : "") + (resumes ? "The agent restarts and continues the conversation." : "This provider cannot resume, so the conversation starts fresh.");
        if (!(await ask.confirm(busy ? "Agent is working; switch now?" : "Switch model?", { description, action: "Switch" }))) return;
      }
      const r = await window.army.setModel(name, model);
      setAgentTemplates(t => ({ ...t, [name]: { ...tplOf(name), ...t[name], model } }));
      if (r.mode === "queued") setError(`Model switch queued for ${name}; it applies when the agent is idle.`);
    } catch (e) { setError(String(e)); }
  };
  const switchEffort = async (name: string, effort: string) => {
    const tpl = tplOf(name);
    if (effort === (tpl.effort || "")) return;
    try {
      if (tpl.provider !== "claude" && !stopped[name]) {
        const busy = await window.army.isWorking(name);
        const description = (busy ? "Agent is working; switching now interrupts the current task. " : "") + (tpl.provider === "codex" ? "The agent restarts and continues the conversation." : "This provider cannot resume, so the conversation starts fresh.");
        if (!(await ask.confirm(busy ? "Agent is working; switch now?" : "Change effort?", { description, action: "Change" }))) return;
      }
      const r = await window.army.setEffort(name, effort);
      setAgentTemplates(t => ({ ...t, [name]: { ...tplOf(name), ...t[name], effort } }));
      if (r.mode === "queued") setError(`Effort change queued for ${name}; it applies when the agent is idle.`);
    } catch (e) { setError(String(e)); }
  };
  const switchPermission = async (name: string, permission: string) => {
    const tpl = tplOf(name);
    if (permission === (tpl.permission || "")) return;
    try {
      if (!stopped[name]) {
        const busy = await window.army.isWorking(name);
        const resumes = ["claude", "codex"].includes(tpl.provider);
        const description = (busy ? "Agent is working; switching now interrupts the current task. " : "") + (resumes ? "The agent restarts and continues the conversation." : "This provider cannot resume, so the conversation starts fresh.");
        if (!(await ask.confirm(busy ? "Agent is working; switch now?" : "Change permission mode?", { description, action: "Change" }))) return;
      }
      const r = await window.army.setPermission(name, permission);
      setAgentTemplates(t => ({ ...t, [name]: { ...tplOf(name), ...t[name], permission } }));
      if (r.mode === "fresh") setError(`Permission mode changed for ${name}; it restarts with a fresh conversation.`);
    } catch (e) { setError(String(e)); }
  };
  const openTerminal = (name: string) => { setSelected(name); setView("agent"); setMode("terminal"); setAgentMenu(null); };
  const agentProvider = (a: string) => agentTemplates[a]?.provider || (demo && a === "coder" ? "codex" : demo && a === "scout" ? "antigravity" : provider);
  const agentColor = (name: string) => name === "you" ? "you" : String((agents.indexOf(name) >= 0 ? agents.indexOf(name) : Array.from(name.toLowerCase()).reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0)) % 6);
  const agentState = (a: string): [Tone, string] => attention[a] ? ["needs", attention[a]] : stopped[a] ? ["idle", "Stopped"] : working[a] ? ["working", "Working"] : ["idle", "Idle"];
  const interrupt = () => { window.army.input(selected, "\x1b"); setWorking(v => ({ ...v, [selected]: false })); };
  const team: AgentInfo[] = agents.map(a => { const [tone, status] = agentState(a); return { name: a, provider: agentProvider(a), model: agentTemplates[a]?.model || models[agentProvider(a)] || "default", enlistedBy: enlistedBy[a], tone, status }; });
  const go = (id: string) => {
    if (id === "home") { setView("home"); window.army.operations.list().then(setOperations); }
    else setView(id);
  };
  useEffect(() => window.army.on("tray-nav", ({ view: v, workspace: w }: { view?: string; workspace?: string }) => { if (v) go(v); else if (w) void openWorkspace(w); }));
  const current: Timed[] = archive ? archive.messages : messages.filter(m => (m.to === selected || m.from === selected) && (!activeChat || !m.chats?.[selected] || m.chats[selected] === activeChat));
  // Live steps sit under the conversation; once the turn is over they fold into one line above the agent's reply.
  const tr = archive ? undefined : trail[selected];
  // A message being delivered (submitting / in flight) counts as working too, also when an old finished trail is shown:
  // a message from Telegram or another agent starts a turn the chat never saw being sent.
  const live = !stopped[selected] && !attention[selected] && (tr ? tr.live || (agentProvider(selected) === "claude" && !!working[selected]) : !!working[selected]);
  const trailNode = !archive && (tr || live) ? <ActivityTrail steps={tr?.steps || []} live={live} since={tr?.since || workSince[selected] || Date.now()} took={tr?.took} provider={agentProvider(selected)} /> : null;
  const trailAboveLast = !!trailNode && !live && current.at(-1)?.from === selected;
  // Chat scroll: stays pinned to the bottom unless the user scrolled up. Only the last `shown` messages are rendered;
  // scrolling near the top loads the previous page and keeps the view where it was.
  const PAGE = 60;
  const [shown, setShown] = useState(PAGE);
  const [atBottom, setAtBottom] = useState(true);
  const pinned = useRef(true);
  const prevHeight = useRef(0);
  // The jump button glides with its own easing (the browser's smooth scroll snapped on long chats), following the
  // bottom if content grows meanwhile. Any later instant scroll, or the user's wheel, ends the glide.
  const glide = useRef(0);
  const toBottom = (smooth = false) => {
    const el = listRef.current; pinned.current = true; setAtBottom(true); cancelAnimationFrame(glide.current); glide.current = 0;
    if (!el) return;
    if (!smooth || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { el.scrollTop = el.scrollHeight; return; }
    const from = el.scrollTop, t0 = performance.now(), ms = Math.min(700, 300 + (el.scrollHeight - from) / 20);
    const step = (now: number) => { const t = Math.min(1, (now - t0) / ms), k = 1 - Math.pow(1 - t, 3); el.scrollTop = from + (el.scrollHeight - el.clientHeight - from) * k; if (t < 1) glide.current = requestAnimationFrame(step); else glide.current = 0; };
    glide.current = requestAnimationFrame(step);
  };
  useEffect(() => { setShown(PAGE); pinned.current = true; setAtBottom(true); requestAnimationFrame(() => toBottom()); }, [selected, archive, mode]);
  useEffect(() => { if (pinned.current) toBottom(); }, [current.length, tr?.steps.length, live]);
  // Content that grows after render (images, code blocks, the live trail) must not pull the view away from the bottom.
  useEffect(() => {
    const el = listRef.current; if (!el) return;
    const ro = new ResizeObserver(() => { if (pinned.current) el.scrollTop = el.scrollHeight; });
    for (const c of Array.from(el.children)) ro.observe(c);
    ro.observe(el);
    return () => ro.disconnect();
  });
  const onListScroll = () => {
    const el = listRef.current; if (!el || glide.current) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    pinned.current = bottom; if (bottom !== atBottom) setAtBottom(bottom);
    if (el.scrollTop < 120 && shown < current.length) { prevHeight.current = el.scrollHeight; setShown(s => s + PAGE); }
  };
  // After an older page is added above, keep the same messages on screen.
  useLayoutEffect(() => { const el = listRef.current; if (el && prevHeight.current) { el.scrollTop += el.scrollHeight - prevHeight.current; prevHeight.current = 0; } }, [shown]);
  const visible = current.slice(Math.max(0, current.length - shown));
  const offset = current.length - visible.length;
  // New chat clears the whole team's conversation: every agent stays, with an empty chat and no task.
  const newChat = async () => {
    const n = agents.length;
    const description = (n > 1 ? `All ${n} agents stay on the team, with empty chats and no tasks. Whatever they are working on stops.` : "The boss starts over with an empty chat. Whatever it is working on stops.") + " This conversation is kept under Home, Recent operations.";
    if (!(await ask.confirm("Start a new chat?", { description, action: "New chat" }))) return;
    try {
      const roster = await window.army.resetOperation();
      setAgents(roster.map(a => a.name)); setAgentTemplates(Object.fromEntries(roster.map(a => [a.name, a.template])));
      setEnlistedBy(Object.fromEntries(roster.filter(a => a.enlistedBy).map(a => [a.name, a.enlistedBy as string])));
      // Stopped agents stay stopped in the new chat; one whose CLI could not start is stopped too, and said so.
      setMessages([]); setStopped(Object.fromEntries(roster.filter(a => a.stopped).map(a => [a.name, true]))); setTrail({}); setWorking({}); setArchive(null); setText(""); setEpoch(v => v + 1);
      if (!roster.some(a => a.name === selected && !a.stopped)) setSelected("boss");
      setMode("chat"); setView("agent");
      const failed = roster.filter(a => a.error).map(a => a.error);
      if (failed.length) setError(failed.join(" "));
      setOperations(await window.army.operations.list());
    } catch (e) { setError(clean(e)); }
  };
  const newChatRef = useRef(newChat); newChatRef.current = newChat;
  const saveTeam = async () => {
    if (!savingTeam?.name.trim()) return;
    try {
      await window.army.teams.saveCurrent(savingTeam.name.trim(), savingTeam.scope);
      setToast({ text: `Saved the team "${savingTeam.name.trim()}". Start it from Home, or edit it under Agent templates, Teams.`, tone: "working" });
      setSavingTeam(null);
    } catch (e) { setError(clean(e)); }
  };
  const needs = Object.keys(attention).length;
  const trustWaiting = Object.entries(attention).filter(([, reason]) => reason === "Trust folder").map(([name]) => name);
  const trustKey = trustWaiting.join(",");
  useEffect(() => { if (!trustKey) { setTrustManual([]); setTrustLater(false); } else setTrustManual(v => v.filter(n => trustWaiting.includes(n))); }, [trustKey]);
  const trustAll = async () => {
    setTrusting(true);
    try { const manual = await window.army.attention.trust(); setTrustManual(manual); }
    catch (e) { setError(clean(e)); }
    finally { setTrusting(false); }
  };
  const showHome = view === "home" || (agents.length === 0 && view === "agent");
  const [agentSeen, setAgentSeen] = useState(false);
  const onAgentPage = !showHome && view === "agent";
  useEffect(() => { if (onAgentPage) setAgentSeen(true); }, [onAgentPage]);
  useEffect(() => {
    const needFiles = onAgentPage && ide && !needsFolder;
    const needOffice = onAgentPage && office && !needsFolder;
    if (bootReady.ui && !needFiles && !bootReady.files) { setBootReady(b => ({ ...b, files: true })); return; }
    if (bootReady.info && !needOffice && !bootReady.office) { setBootReady(b => ({ ...b, office: true })); return; }
    if (!bootReady.main || !bootReady.info) { setBootStatus(bootResuming ? "Resuming operation" : "Opening workspace"); return; }
    if (!bootReady.files || !bootReady.office || !bootReady.templates) { setBootStatus("Preparing workspace"); return; }
    if (bootSettling.current) return;
    bootSettling.current = true;
    const wait = waitForResponsive({ ready: (window as any).army.ready, onStatus: setBootStatus, timeoutMs: 20000 });
    void wait.promise.then(() => hideBoot());
  }, [bootReady, bootResuming, onAgentPage, ide, office, needsFolder]);
  const showSidebar = agents.length > 0 && !showHome && ["agent", "overview", "comms"].includes(view);
  const agentFeed = messages.filter(m => m.from !== "you" && m.to !== "you");
  const pairs = [...new Set(agentFeed.map(m => [m.from, m.to].sort().join(" ↔ ")))];
  const searchItems = [...agents.map(a => ({ id: a, label: a, hint: "Agent" })), ...NAV.map(([id, , label]) => ({ id: "view:" + id, label, hint: "View" }))].filter(x => x.label.toLowerCase().includes(query.toLowerCase()));
  const pickSearch = (id: string) => { if (id.startsWith("view:")) go(id.slice(5)); else { setSelected(id); setView("agent"); } setSearch(false); setQuery(""); };
  const viewTitle = showHome ? "New operation" : NAV.find(n => n[0] === view)?.[2];

  if (needsFolder) return (
    <div className="folder-gate">
      <img src="./logo-dispatch.png" alt="" />
      <h1>Open a folder</h1>
      <p>Choose the project folder your agents will work in. You can switch folders later from the top bar.</p>
      <Button className="primary" onClick={async () => { try { const next = await window.army.workspace(); const info = await window.army.info(); if (!(info as any).needsFolder) { setWsLoading("Opening workspace"); try { setNeedsFolder(false); setWorkspace(next); setOperations(info.operations); setWorkspaces(info.workspaces); if (info.operations[0]) { setWsLoading("Resuming operation"); await resume(info.operations[0].id, true); } await waitForResponsive({ ready: (window as any).army.ready, onStatus: setWsLoading, timeoutMs: 20000 }).promise; } finally { setWsLoading(null); } } } catch (e) { setError(String(e)); } }}>Open folder</Button>
    </div>
  );
  return (
    <div className={"app " + (navigator.userAgent.includes("Mac") ? "os-mac" : "os-win") + (macFs ? " mac-fs" : "") + (showSidebar && sidebar ? " with-sidebar" : "")}>
      {wsLoading && <div className="boot-overlay" role="status" aria-live="polite" aria-label="Opening workspace"><div className="boot-box"><div className="boot-mark"><img src="./icon-256.png" alt="" width="72" height="72" /><svg className="boot-ring" viewBox="0 0 92 92" aria-hidden="true"><rect className="boot-track" x="1" y="1" width="90" height="90" rx="24" pathLength="100" /><rect className="boot-trace" x="1" y="1" width="90" height="90" rx="24" pathLength="100" /></svg></div><div className="boot-name">Dispatch</div><div className="boot-sub">{wsLoading}</div></div></div>}
      {tabEnter > 0 && <span key={tabEnter} className="tab-flash" aria-hidden="true" />}
      <header className="topbar">
        <div className="brand"><img src="./logo-dispatch.png" alt="" /><strong>Dispatch</strong></div>
        <ProjectTabs recent={workspaces} onError={setError} />
        <span className="grow" />
        {agents.length > 0 && <div className="live" role="status">
          <StatusDot tone={needs ? "needs" : "working"} />
          <span>{agents.length} {agents.length === 1 ? "agent" : "agents"}</span>
          {needs > 0 && <span className="live-needs">· {needs} {needs === 1 ? "needs" : "need"} you</span>}
          {demo && <span className="live-tokens">· 12.4k tokens</span>}
        </div>}
        <Schedules key={workspace} />
        <Button className="search-trigger" onClick={() => setSearch(true)}><MagnifyingGlassIcon aria-hidden="true" /><span>Search</span><kbd>Ctrl K</kbd></Button>
      </header>
      <nav className="rail" aria-label="Views">
        {NAV.map(([id, short, label, Icon]) => {
          const active = id === "home" ? showHome : !showHome && view === id;
          return <button type="button" key={id} className={"rail-item" + (active ? " active" : "")} aria-current={active ? "page" : undefined} aria-label={label} title={label} disabled={id === "agent" && agents.length === 0} onClick={() => go(id)}>{prefs.navIcons === "color" ? <img className="rail-color" src={`./nav-color/${id}.svg`} alt="" aria-hidden="true" /> : <Icon aria-hidden="true" />}<span>{short}</span>{id === "tasks" && tasksNeedLook > 0 && <span className="rail-count" aria-label={`${tasksNeedLook} waiting or stalled`}>{tasksNeedLook}</span>}</button>;
        })}
        <RemoteRailButton />
        {(import.meta as any).env?.DEV &&<button type="button" className={"rail-item rail-dev" + (mock ? " active" : "")} aria-label={mock ? "Mock data is loaded (dev only)" : "Fill with mock data (dev only)"} title="Dev only: a mock workspace with agents, messages, memory, skills, schedules and outputs" onClick={async () => {
          const choice = mock
            ? await ask.choose("Mock data is loaded", { description: "Unload goes back to the workspace you had open and deletes the mock folder. Reload starts the mock over with fresh data.", options: [{ id: "reload", label: "Reload mock" }, { id: "unload", label: "Unload mock", primary: true }] })
            : (await ask.confirm("Load mock data?", { description: "Running agents stop and Dispatch switches to a mock workspace in your temp folder. Your own workspaces are not touched. Click Mock again to unload it.", action: "Load mock" })) ? "load" : null;
          if (!choice) return;
          try { await (choice === "unload" ? (window as any).army.devUnmock() : (window as any).army.devMock()); window.location.reload(); } catch (e) { setError(String(e)); }
        }}><BeakerIcon aria-hidden="true" /><span>{mock ? "Mock on" : "Mock"}</span></button>}
      </nav>
      <ServerApprovals />
      <RailServers open={id => { setServerFocus({ id, n: Date.now() }); setView("servers"); }} />
      <main className="main">
        {!onAgentPage && <div className="view" key={showHome ? "home" : view}>
          {showHome ? (
            <div className="page home">
              <section className="home-start">
                <h1>New operation</h1>
                <p className="lead">{homeTeam ? "The team starts together: its boss plans the work and hands it to the members." : "Pick a boss. It plans the work and enlists the agents it needs."}</p>
                <div className="start-row">
                  {teams.length > 0 && <label className="field team-field">Team<select aria-label="Team" value={homeTeam} onChange={e => setHomeTeam(e.target.value)}><option value="">Boss only</option>{teams.map(t => <option key={t.file} value={t.file}>{t.name} · boss + {t.members.length}</option>)}</select></label>}
                  {homeTeam ? <p className="team-summary">{(() => { const t: any = teams.find(x => x.file === homeTeam); return t ? `Boss (${t.boss?.template}) with ${t.members.map((m: any) => m.name).join(", ") || "no members"}. Edit it in Agent templates > Teams.` : ""; })()}</p> : bossPicker}
                  <Button className="primary" disabled={!homeTeam && (!bossFile || !bossModel)} onClick={() => start(homeTeam || undefined)}>{homeTeam ? "Start team" : "Start operation"}</Button>
                </div>
                <UsageSwitch />
              </section>
              <div className="home-lists">
                <section>
                  <h2 className="label">Recent operations</h2>
                  {operations.length === 0 ? <p className="empty-line">No operations yet.</p> : <div className="rows">{operations.map(op => (
                    <div className="op-row list-row" key={op.id} role="button" tabIndex={0} onClick={() => resume(op.id)} onKeyDown={e => { if (e.key === "Enter") resume(op.id); }} title="Resume this operation">
                      <span className="op-avatars">{op.agents.slice(0, 4).map((a: any) => <ProviderIcon key={a.name} provider={a.provider} alt="" title={`${a.name} · ${a.provider}`} />)}</span>
                      <span className="row-text"><b>{op.agents.map((a: any) => a.name).join(", ") || op.name}</b><small>{op.agents.length} agent{op.agents.length === 1 ? "" : "s"} · {ago(op.created)}</small></span>
                      <span className="row-hint">Resume</span>
                      <button type="button" className="icon-button" title="Delete operation" aria-label="Delete operation" onClick={async e => { e.stopPropagation(); if (await ask.confirm("Delete this operation?", { description: "Its saved chats are removed.", action: "Delete", danger: true })) { try { setOperations(await window.army.operations.remove(op.id)); } catch (err) { setError(String(err)); } } }}><TrashIcon /></button>
                    </div>))}</div>}
                </section>
                <section>
                  <h2 className="label">Recent workspaces</h2>
                  <div className="rows">
                    {workspaces.filter(w => !/[\\/](Temp|tmp)[\\/]/i.test(w)).map(w => { const parts = w.split(/[\\/]/); const nm = parts.pop() || w; return <button type="button" key={w} className="list-row" onClick={() => (window as any).army.tabs.open(w).catch((e: unknown) => setError(String(e)))} title={`${w} · opens in a new tab`}><FolderIcon className="row-glyph" aria-hidden="true" /><span className="row-text"><b>{nm}</b><small>{parts.join("\\")}</small></span></button>; })}
                    <button type="button" className="list-row add-row" onClick={() => (window as any).army.tabs.open().catch((e: unknown) => setError(String(e)))}><PlusIcon className="row-glyph" aria-hidden="true" /><span className="row-text"><b>Open folder…</b></span></button>
                  </div>
                </section>
              </div>
            </div>
          ) : view === "agent" ? null : view === "overview" ? (
            <div className="page overview">
              {agents.length === 0 ? <div className="empty"><h2>No active agents</h2><p>Start an operation to see your team here.</p><Button className="secondary" onClick={() => go("home")}>New operation</Button></div> : (
                <div className="tile-grid">
                  {team.map(a => (
                    <div className="tile" key={a.name}>
                      <div className="tile-head">
                        <AgentId agent={a} template={agentTemplates[a.name]} />
                        <small>{a.model}</small>
                        <StatusDot tone={a.tone} label={a.status} />
                        <span className="grow" />
                        <Button className="ghost" onClick={() => { setSelected(a.name); setView("agent"); setMode("chat"); }}>Message</Button>
                        <Button className="ghost" onClick={() => openTerminal(a.name)}>Open</Button>
                      </div>
                      <Console key={`${a.name}:${epoch}`} name={a.name} mini />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : view === "comms" ? (
            <div className="page comms">
              <div className="threads" role="list">
                <h2 className="label">Threads</h2>
                <Button className={"list-row" + (thread === "all" ? " selected" : "")} onClick={() => setThread("all")}><span className="row-text"><b>All messages</b></span><span className="row-hint">{agentFeed.length}</span></Button>
                {pairs.map(pair => { const last = [...agentFeed].reverse().find(m => [m.from, m.to].sort().join(" ↔ ") === pair); return <Button key={pair} aria-label={pair.toUpperCase()} className={"list-row" + (thread === pair ? " selected" : "")} onClick={() => setThread(pair)}><span className="row-text"><b>{pair}</b><small>{last?.text.slice(0, 60)}</small></span></Button>; })}
              </div>
              <div className="conversation">
                {agentFeed.length ? agentFeed.filter(m => thread === "all" || [m.from, m.to].sort().join(" ↔ ") === thread).map((m, i) => (
                  <div className="memo" key={m.id + i}>
                    <div className="message-meta"><b className={`who c-${agentColor(m.from)}`}>{m.from}</b><span className="message-recipient">to {m.to}</span>{m.time && <time>{new Date(m.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>}</div>
                    <p>{m.text}</p>
                  </div>
                )) : <div className="empty"><h2>No messages yet</h2><p>When agents talk to each other, their threads show up here.</p></div>}
              </div>
            </div>
          ) : view === "providers" ? <Providers focus={providerFocus} />
          : view === "tools" ? <Tools openMemory={() => setView("memory")} />
          : view === "memory" ? <Memory />
          : view === "tasks" ? <Tasks tasks={tasks} openAgent={name => { setSelected(name); setView("agent"); setMode("chat"); }} />
          : view === "servers" ? <Servers focus={serverFocus} />
          : view === "skills" ? <Skills />
          : view === "mcp" ? <Connectors />
          : view === "share" ? <Share workspace={workspace} openFile={packFile} clearFile={() => setPackFile(null)} openWorkspace={target => openWorkspace(target)} />
          : view === "templates" ? (
            <Templates activeBossFile={agentTemplates.boss?.file} hasBoss={agents.includes("boss")} onReloadBoss={async template => {
              const chosen = await window.army.changeBoss(template);
              setAgentTemplates(v => ({ ...v, boss: chosen })); setStopped(v => ({ ...v, boss: false }));
              const list = await window.army.chats.list("boss"); setChatList(list); setActiveChat(list.find(c => c.active)?.id || null); setArchive(null); setSelected("boss"); setView("agent");
            }} />
          ) : (
            <div className="page settings">
              <h1>Settings</h1>
              <section className="settings-group">
                <h2 className="label">General</h2>
                <div className="setting-row"><div><b>Workspace</b><p>{workspace}</p></div><Button className="secondary" onClick={() => openWorkspace()}>Change</Button></div>
                <div className="setting-row"><div><b>Language</b><p>Interface language. Chats and agent replies are not translated.</p></div><select aria-label="Language" value={getLang()} onChange={e => setLang(e.target.value as Lang)}><option value="en">English</option><option value="tr">Türkçe</option></select></div>
              </section>
              <section className="settings-group">
                <h2 className="label">Appearance</h2>
                <ThemeSettings />
                <div className="setting-row"><div><b>Menu icons</b><p>{prefs.navIcons === "color" ? <>Colored icons from Fluent UI System Icons by Microsoft (MIT license, <a href="https://github.com/microsoft/fluentui-system-icons" target="_blank" rel="noreferrer">github.com/microsoft/fluentui-system-icons</a>).</> : "Icons in the left menu. Colored icons are an open-source set by Microsoft, credited here once you pick them."}</p></div>
                  <select aria-label="Menu icons" value={prefs.navIcons || "mono"} onChange={e => setPref({ navIcons: e.target.value as "mono" | "color" })}><option value="mono">Monochrome</option><option value="color">Colored (Fluent)</option></select></div>
                <label className="setting-row"><div><b>Open the editor with the first file</b><p>With no file open, Files shows only the tree in a narrow panel. Off: the editor area is always there.</p></div>
                  <input type="checkbox" aria-label="Open the editor with the first file" checked={!!prefs.ideEditorOnFile} onChange={e => setPref({ ideEditorOnFile: e.target.checked })} /></label>
                <label className="setting-row"><div><b>Button to hide the file tree</b><p>Adds a button in Files that folds the tree away, so an open file gets the whole panel.</p></div>
                  <input type="checkbox" aria-label="Button to hide the file tree" checked={!!prefs.ideTreeToggle} onChange={e => setPref({ ideTreeToggle: e.target.checked })} /></label>
              </section>
              <RemoteSettings />
              <VoiceSettings openTools={() => setView("tools")} />
              <MemorySettings open={() => setView("memory")} />
              <TerminalSettings workspace={workspace} />
              <section className="settings-group">
                <h2 className="label">Keyboard shortcuts</h2>
                {[["Search agents and views", "Ctrl K"], ["Switch chat and terminal", "Ctrl T"], ["Overview", "Ctrl O"], ["Toggle side panel", "Ctrl B"], ["Files and editor", "Ctrl E"], ["Quick open file (editor open)", "Ctrl P"], ["Search in files (editor open)", "Ctrl Shift F"], ["Terminal in this folder", "Ctrl `"], ["Voice typing (works from any app)", "Ctrl Alt Space"], ["Jump to agent 1-9", "Ctrl 1-9"], ["Save template", "Ctrl S"]].map(([label, keys]) => <div className="setting-row compact" key={label}><span>{label}</span><kbd>{keys}</kbd></div>)}
              </section>
            </div>
          )}
        </div>}
        {/* The agent page stays mounted while another page is open: coming back does not rebuild the office scene, the terminal or the chat. */}
        {(agentSeen || onAgentPage) && <div className="view" hidden={!onAgentPage}>
            <div ref={workbench} className={"workbench" + (ide ? " ide-open" : "")} style={{ "--ide-w": (ideCompact ? treeW : Math.max(320, Math.min(ideW, wbWidth - 407))) + "px" } as React.CSSProperties}>
            <div className="ide-slot" aria-hidden={!ide} inert={!ide ? true : undefined}>{ideMounted && <Suspense fallback={<div className="ide-loading">Loading editor…</div>}><IdePanel workspace={workspace} open={ide} request={ideReq} gitFiles={demo ? DEMO_FILES : gitFiles} terminalOpen={termOpen} toggleTerminal={toggleTerminal} close={() => toggleIde()} editorOnFile={prefs.ideEditorOnFile} treeToggle={prefs.ideTreeToggle} onCompact={setIdeCompact} onReady={() => setBootReady(b => b.files ? b : { ...b, files: true })}
              terminal={<Terminals shells={shells} active={shellActive} setActive={setShellActive} onClose={() => setTermOpen(false)} height={termH} setHeight={setTermH} />} /></Suspense>}</div>
            <div className="ide-resizer" role="separator" aria-orientation="vertical" aria-label="Resize files panel" tabIndex={ide ? 0 : -1} onPointerDown={startIdeResize} onKeyDown={e => { const d = e.key === "ArrowLeft" ? -32 : e.key === "ArrowRight" ? 32 : 0; if (!d) return; if (ideCompact) setTreeW(w => Math.min(520, Math.max(240, w + d))); else setIdeW(w => Math.max(420, w + d)); }} />
            <div className="chat">
              {office && <><div className="stage" style={{ height: stageH }}><Suspense fallback={null}>{heavyOk && <Office agents={team.filter(a => a.name !== "boss").map(a => ({ name: a.name, role: a.model }))} messages={messages} working={working} onReady={() => setBootReady(b => b.office ? b : { ...b, office: true })} />}</Suspense></div>
              <div className="splitter" role="separator" aria-orientation="horizontal" aria-label="Resize office" tabIndex={0} onPointerDown={startResize} onKeyDown={e => { if (e.key === "ArrowUp") setStageH(h => Math.max(160, h - 24)); if (e.key === "ArrowDown") setStageH(h => h + 24); }} /></>}
              <div className="chat-pane">
              <div className="chat-head">
                {!ide && <button type="button" className={"button ghost ide-toggle" + (ide ? " on" : "")} onClick={() => toggleIde()} aria-pressed={ide} aria-label={ide ? "Hide files" : "Show files"} title="Files, editor and terminal (Ctrl E)"><CodeBracketIcon aria-hidden="true" />Files</button>}
                <div className="chat-title">
                  <AgentId agent={team.find(a => a.name === selected) || { name: selected, provider: agentProvider(selected), model: tplOf(selected).model || "default", tone: "idle", status: "Idle" }} template={agentTemplates[selected]} />
                  {!String(tplOf(selected).provider).startsWith("local") ? <select className="model-switch" aria-label="Agent model" title="Switch this agent's model" value={tplOf(selected).model || "default"} onChange={e => void switchModel(selected, e.target.value)}>{Array.from(new Set([...(modelLists[tplOf(selected).provider] || []), tplOf(selected).model || "default"])).map(m => <option key={m} value={m}>{m}</option>)}<option value="__custom">Custom…</option></select> : <small>{tplOf(selected).model}</small>}
                  {(effortLists[tplOf(selected).provider] || []).length > 0 && <select className="model-switch effort-switch" aria-label="Agent effort" title="Reasoning effort for this agent" value={tplOf(selected).effort || ""} onChange={e => void switchEffort(selected, e.target.value)}><option value="">Effort: default</option>{effortLists[tplOf(selected).provider].map(x => <option key={x} value={x}>Effort: {x}</option>)}</select>}
                  {(permissionLists[tplOf(selected).provider] || []).length > 0 && <select className="model-switch permission-switch" aria-label="Agent permission mode" title="Permission and approval mode for this agent" value={tplOf(selected).permission || ""} onChange={e => void switchPermission(selected, e.target.value)}><option value="">Permission: default</option>{permissionLists[tplOf(selected).provider].map(x => <option key={x} value={x}>Permission: {PERMISSION_LABEL[x] || x}</option>)}</select>}
                </div>
                <div className="tabs" role="tablist" aria-label="Agent view" data-active={mode}>
                  <button type="button" role="tab" aria-selected={mode === "chat"} className="tab" onClick={() => setMode("chat")}>Chat</button>
                  <button type="button" role="tab" aria-selected={mode === "terminal"} className="tab" onClick={() => setMode("terminal")}>Terminal</button>
                  <span className="tab-indicator" aria-hidden="true" />
                </div>
                <span className="grow" />
                <Button className="ghost new-chat" aria-label="New chat" onClick={() => void newChat()} title="Clear the whole team's conversation and start over with the same agents (Ctrl N)"><PlusIcon aria-hidden="true" />New chat</Button>
                <button type="button" className={"icon-button" + (office ? " on" : "")} onClick={() => setOffice(!office)} aria-pressed={office} aria-label={office ? "Hide office" : "Show office"} title="Office view (Ctrl J)"><CubeIcon /></button>
                <button type="button" className="icon-button" onClick={() => setSidebar(!sidebar)} aria-expanded={sidebar} aria-controls="agent-activity" aria-label={sidebar ? "Hide side panel" : "Show side panel"} title="Side panel (Ctrl B)"><PanelIcon open={sidebar} /></button>
              </div>

              {mode === "terminal" ? <div className="terminal-wrap"><Console key={`${selected}:${epoch}`} name={selected} /></div> : (
                <div className="message-list" ref={listRef} onScroll={onListScroll} onWheel={() => { cancelAnimationFrame(glide.current); glide.current = 0; }}>
                  {offset > 0 && <p className="empty-line older-hint">Scroll up for older messages</p>}
                  {current.length === 0 && !trailNode && !questions[selected] ? (
                    <div className="empty"><h2>Start a conversation</h2><p>Send an order to {selected}. Live CLI output is in Terminal.</p></div>
                  ) : visible.map((m, j) => { const i = j + offset; const prev = visible[j - 1];
                    // Like a group chat: a run of messages from the same sender to the same reader shows the avatar once.
                    const cont = !!prev && prev.from === m.from && prev.to === m.to && (!m.time || !prev.time || +new Date(m.time) - +new Date(prev.time) < 5 * 60000);
                    const from = agentProvider(m.from); return (
                    <React.Fragment key={m.id + i}>
                      {trailAboveLast && i === current.length - 1 && trailNode}
                      <article className={"message" + (m.from === "you" ? " mine" : "") + (cont ? " cont" : "")}>
                        <div className="msg-who">{!cont && <><Avatar name={m.from} provider={from} color={agentColor(m.from)} /><small>{m.from}</small></>}</div>
                        <div className="msg-bubble">
                          {m.from !== "you" && <div className="msg-tools"><CopyButton text={m.text} label="Copy message" /></div>}
                          <ChatMessage message={m}><div className="message-meta">{m.from !== "you" && <b className={`who c-${agentColor(m.from)}`}>{m.from}</b>}{m.from !== "you" && m.from !== "boss" && <span className="message-provider">{labels[from] || from}</span>}<span className="message-recipient">→ {m.to}</span>{m.time && <time>{new Date(m.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>}</div></ChatMessage>
                        </div>
                      </article>
                    </React.Fragment>
                  ); })}
                  {!trailAboveLast && trailNode}
                  {!archive && questions[selected] && <QuestionCard agent={selected} question={questions[selected]} openTerminal={() => setMode("terminal")} onError={setError} />}
                  <div ref={listEnd} />
                </div>
              )}
              {archive && <div className="archive-notice"><span>Viewing {archive.title} (read-only)</span><Button className="ghost" onClick={() => setArchive(null)}>Back to current chat</Button></div>}
              <div className={"composer" + (draggingFiles ? " dragging" : "")}
                onDragOver={e => { const types = Array.from(e.dataTransfer.types); if (types.includes("application/x-dispatch-path")) { e.preventDefault(); e.dataTransfer.dropEffect = "link"; return; } if (types.includes("Files")) { e.preventDefault(); setDraggingFiles(true); } }}
                onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDraggingFiles(false); }}
                onDrop={e => { e.preventDefault(); setDraggingFiles(false); if (archive || sending) return; const path = e.dataTransfer.getData("application/x-dispatch-path"); if (path) insertPath(path); else addFiles(e.dataTransfer.files); }}>
                {mode === "chat" && !atBottom && <button type="button" className="jump-bottom" aria-label="Scroll to the latest message" title="Latest message" onClick={() => toBottom(true)}><ArrowDownIcon aria-hidden="true" /></button>}
                {draggingFiles && <div className="drop-hint">Drop files to attach</div>}
                {mention && !archive && <MentionMenu items={mentionList} index={Math.min(mention.index, Math.max(0, mentionList.length - 1))} query={mention.query} loading={mentionAll.loading} pick={pickMention} hover={i => setMention(v => v && { ...v, index: i })} />}
                {attachments.length > 0 && <div className="attachment-list">{attachments.map((file, i) => <div className="attachment-chip" key={`${file.name}-${i}`}><AttachmentPreview file={file} /><span title={file.name}>{file.name}</span><button type="button" className="icon-button" aria-label={`Remove ${file.name}`} onClick={() => setAttachments(v => v.filter((_, index) => index !== i))}><XMarkIcon /></button></div>)}</div>}
                {links.length > 0 && <div className="link-list">{links.map(u => <a key={u} className="link-chip" href={u} target="_blank" rel="noreferrer" title={u}><LinkIcon aria-hidden="true" /><span>{linkLabel(u)}</span></a>)}</div>}
                <div className={"composer-input" + (links.length ? " has-links" : "")}>
                {links.length > 0 && <div className="composer-mirror" ref={mirror} aria-hidden="true">{splitLinks(text).map((part, i) => part.link ? <span key={i} className="composer-link">{part.text}</span> : part.text)}{"\n"}</div>}
                <textarea ref={textArea} onScroll={e => { if (mirror.current) mirror.current.scrollTop = e.currentTarget.scrollTop; }}
                  aria-label="Message" disabled={!!archive || sending} value={text} placeholder={voice === "on" ? "Listening… speak, then Enter to send" : `Message ${selected}…`}
                  onPaste={e => { if (e.clipboardData.files.length) { e.preventDefault(); addFiles(e.clipboardData.files); } }}
                  onChange={e => { if (dict.current) { vBase.current = e.target.value; vPos.current = e.target.selectionStart; vPartial.current = ""; } setText(e.target.value); findMention(e.target.value, e.target.selectionStart); }}
                  onSelect={e => { if (mention) findMention(e.currentTarget.value, e.currentTarget.selectionStart); }}
                  onBlur={() => setMention(null)}
                  onKeyDown={e => {
                    if (mention) {
                      const n = mentionList.length;
                      if (e.key === "ArrowDown" && n) { e.preventDefault(); setMention(v => v && { ...v, index: (Math.min(v.index, n - 1) + 1) % n }); return; }
                      if (e.key === "ArrowUp" && n) { e.preventDefault(); setMention(v => v && { ...v, index: (Math.min(v.index, n - 1) - 1 + n) % n }); return; }
                      if ((e.key === "Enter" || e.key === "Tab") && n && !e.shiftKey) { e.preventDefault(); pickMention(mentionList[Math.min(mention.index, n - 1)]); return; }
                      if (e.key === "Escape") { e.preventDefault(); setMention(null); return; }
                    }
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } if (e.key === "Escape" && dict.current) { e.preventDefault(); void stopVoice(); } }}
                />
                </div>
                <div className="composer-bar">
                  <input ref={fileInput} type="file" multiple hidden onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
                  <button type="button" className="icon-button" title="Attach files" aria-label="Attach files" disabled={!!archive || sending} onClick={() => fileInput.current?.click()}><PaperClipIcon /></button>
                  <label className="recipient"><span>To</span><select id="message-recipient" aria-label="Recipient" value={selected} onChange={e => setSelected(e.target.value)}>{agents.map(a => <option key={a} value={a}>{a}</option>)}</select><ChevronDownIcon aria-hidden="true" /></label>
                  <span className="grow" />
                  {working[selected] ? <>
                    <span className="composer-working"><StatusDot tone="working" label={`${selected} is working`} /></span>
                    <Button className="danger stop" onClick={interrupt} aria-label="Stop current task" title="Stop the current task"><StopIcon aria-hidden="true" />Stop</Button>
                  </> : <span className="composer-hint">Enter to send · Shift Enter for new line</span>}
                  <button type="button" className={"icon-button mic-button" + (voice === "on" ? " recording" : voice === "starting" ? " starting" : "")} disabled={!!archive || sending} onClick={() => void (voice === "off" ? startVoice() : stopVoice())} aria-pressed={voice !== "off"} aria-label={voice === "off" ? "Voice typing" : "Stop voice typing"} title={voice === "off" ? "Voice typing: speak, it types (Ctrl Alt Space)" : "Stop listening (Esc). Enter sends."}>
                    {voice === "on" ? <Visualizer analyser={voiceAnalyser} width={54} height={18} /> : <MicrophoneIcon />}
                  </button>
                  <Button className="primary send" onClick={() => void send()} disabled={!!archive || sending || (!text.trim() && !attachments.length && voice === "off")} aria-label="Send" title="Send (Enter)"><PaperAirplaneIcon aria-hidden="true" /></Button>
                </div>
              </div>
              </div>
            </div>
            </div>
        </div>}
      </main>
      {showSidebar && <Sidebar agents={team} selected={selected} activeView={view === "agent"} menu={agentMenu} setMenu={setAgentMenu}
        select={a => { setSelected(a); setView("agent"); if (questions[a]) setMode("chat"); }}
        act={(a, action) => void act(a, action)} openTerminal={openTerminal} enlist={() => setEnlisting(true)}
        saveTeam={agents.length > 1 && agents.includes("boss") ? () => setSavingTeam({ name: "", scope: "project" }) : undefined}
        changeBoss={() => { setAgentMenu(null); setBossSource("template"); setChangingBoss(true); }}
        switchBoss={() => void openSwitchBoss()}
        files={demo ? DEMO_FILES : gitFiles} openFile={openInIde} shells={shells} openShell={name => void openShell(name)} outputs={outputs} feed={agentFeed} color={agentColor} openProvider={id => { setProviderFocus(id); setView("providers"); }} />}

      {changingBoss && <Dialog title="Change boss" size="md" onClose={() => setChangingBoss(false)} footer={<>
        <Button className="ghost" onClick={() => setChangingBoss(false)}>Cancel</Button>
        <Button className="primary" disabled={bossSource === "template" && (!bossFile || !bossModel)} onClick={async () => { try { const chosen = await window.army.changeBoss(bossSource === "template" ? selectedBoss() : null, bossSource === "template" ? undefined : bossSource); setAgentTemplates(v => ({ ...v, boss: chosen })); if (bossSource !== "template") setAgents(v => v.filter(a => a !== bossSource)); setStopped(v => ({ ...v, boss: false })); setSelected("boss"); setView("agent"); setChangingBoss(false); } catch (e) { setError(String(e)); } }}>Change boss</Button>
      </>}>
        <label className="field">Choose from<select value={bossSource} onChange={e => setBossSource(e.target.value)}><option value="template">Boss template</option>{agents.filter(a => a !== "boss").map(a => <option key={a} value={a}>{a}</option>)}</select></label>
        {bossSource === "template" && bossPicker}
      </Dialog>}
      {switchingBoss && (() => {
        const curProv = agentTemplates.boss?.provider || "claude";
        const supportsAccounts = ["claude", "codex"].includes(curProv);
        const otherProviders = ["claude", "codex", "antigravity", "opencode", "qoder", "gemini"].filter(p => p !== curProv);
        return (
          <Dialog
            title="Switch boss"
            size="md"
            onClose={() => !switchBusy && setSwitchingBoss(false)}
            description={switchMode === "account"
              ? `Restart boss on ${curProv} with another account (resumes the session if available).`
              : "Restart boss on a different provider (starts a fresh session)."}
            footer={<>
              <Button className="ghost" disabled={switchBusy} onClick={() => setSwitchingBoss(false)}>Cancel</Button>
              <Button
                className="primary"
                disabled={switchBusy || (switchMode === "account" ? !switchAccountId : !switchProvider)}
                onClick={async () => {
                  if (!window.army.bossSwitch) return;
                  setSwitchBusy(true);
                  try {
                    const res = await window.army.bossSwitch(
                      switchMode === "account"
                        ? { provider: curProv, accountId: switchAccountId }
                        : { provider: switchProvider }
                    );
                    setAgentTemplates(v => ({ ...v, boss: res.template }));
                    setStopped(v => ({ ...v, boss: false }));
                    setSelected("boss");
                    setView("agent");
                    setSwitchingBoss(false);
                  } catch (e) { setError(String(e)); } finally { setSwitchBusy(false); }
                }}
              >
                {switchBusy ? "Switching…" : "Switch & restart"}
              </Button>
            </>}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {supportsAccounts && (
                <div style={{ display: "flex", gap: 6 }}>
                  <Button
                    className={switchMode === "account" ? "primary" : "secondary"}
                    onClick={() => setSwitchMode("account")}
                  >
                    Switch {curProv} account
                  </Button>
                  <Button
                    className={switchMode === "provider" ? "primary" : "secondary"}
                    onClick={() => setSwitchMode("provider")}
                  >
                    Switch provider
                  </Button>
                </div>
              )}
              {switchMode === "account" && supportsAccounts ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 260, overflowY: "auto" }}>
                  {bossAccounts.map(acc => {
                    const picked = switchAccountId === acc.id;
                    return (
                      <button
                        type="button"
                        key={acc.id}
                        onClick={() => setSwitchAccountId(acc.id)}
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 2,
                          textAlign: "left",
                          padding: "7px 10px",
                          borderRadius: 8,
                          border: picked ? "1px solid var(--accent)" : "1px solid var(--line)",
                          background: picked ? "var(--surface-2)" : "transparent",
                          color: "inherit",
                          cursor: "pointer",
                        }}
                      >
                        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <b>{acc.label}</b>
                          {acc.active && <span className="tag">Current</span>}
                        </span>
                        {(acc.email || acc.plan) && (
                          <small style={{ color: "var(--muted)" }}>{[acc.email, acc.plan].filter(Boolean).join(" · ")}</small>
                        )}
                      </button>
                    );
                  })}
                  {bossAccounts.length <= 1 && (
                    <small style={{ color: "var(--muted)" }}>Add more {curProv} accounts in Providers to switch between them here.</small>
                  )}
                </div>
              ) : (
                <label className="field">
                  New provider
                  <select value={switchProvider} onChange={e => setSwitchProvider(e.target.value)}>
                    {otherProviders.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </label>
              )}
            </div>
          </Dialog>
        );
      })()}
      {savingTeam && <Dialog title="Save as team template" onClose={() => setSavingTeam(null)} description={`The boss and its ${agents.length - 1} ${agents.length === 2 ? "agent" : "agents"} are saved as a team you can start again with one click. Chats and tasks are not part of it.`} footer={<>
        <Button className="ghost" onClick={() => setSavingTeam(null)}>Cancel</Button>
        <Button className="primary" disabled={!savingTeam.name.trim()} onClick={() => void saveTeam()}>Save team</Button>
      </>}>
        <label className="field">Team name<input autoFocus aria-label="Team name" maxLength={60} value={savingTeam.name} onChange={e => setSavingTeam({ ...savingTeam, name: e.target.value })} onKeyDown={e => { if (e.key === "Enter") void saveTeam(); }} /></label>
        <label className="field">Available in<select aria-label="Team scope" value={savingTeam.scope} onChange={e => setSavingTeam({ ...savingTeam, scope: e.target.value })}><option value="project">This workspace</option><option value="global">Every workspace</option></select></label>
      </Dialog>}
      {dismissAgent && <Dialog title={`Dismiss ${dismissAgent.name}?`} onClose={() => setDismissAgent(null)} description={dismissAgent.working ? "This agent is working. Dismissing it will stop its current work." : "This agent will be removed from the operation."} footer={<>
        <Button className="ghost" autoFocus onClick={() => setDismissAgent(null)}>Cancel</Button>
        <Button className="danger" onClick={async () => { const name = dismissAgent.name; setDismissAgent(null); try { await window.army.agentAction(name, "dismiss"); if (selected === name) setSelected("boss"); } catch (e) { setError(String(e)); } }}>Dismiss</Button>
      </>} />}
      {enlisting && <EnlistDialog agents={agents} close={() => setEnlisting(false)} openProviders={() => { setEnlisting(false); setView("providers"); }} enlist={async (name, template, task) => { try { await window.army.enlist(name, template, task); setAgents(v => [...v, name]); setAgentTemplates(v => ({ ...v, [name]: template })); setSelected(name); setView("agent"); setEnlisting(false); } catch (e) { setError(String(e).replace(/^Error: Error invoking remote method '[^']+': (Error: )?/, "")); } }} />}
      {search && <div className="dialog-overlay palette-overlay" onMouseDown={e => { if (e.target === e.currentTarget) { setSearch(false); setQuery(""); } }}>
        <div className="dialog palette" role="dialog" aria-modal="true" aria-label="Search">
          <label className="palette-input"><MagnifyingGlassIcon aria-hidden="true" /><input autoFocus placeholder="Search agents and views…" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === "Escape") { setSearch(false); setQuery(""); } if (e.key === "Enter" && searchItems[0]) pickSearch(searchItems[0].id); }} /><kbd>Esc</kbd></label>
          <div className="palette-list">{searchItems.map(x => <Button key={x.id} className="list-row" onClick={() => pickSearch(x.id)}><span className="row-text"><b>{x.label}</b></span><span className="row-hint">{x.hint}</span></Button>)}{searchItems.length === 0 && <p className="empty-line">Nothing matches.</p>}</div>
        </div>
      </div>}
      {trustWaiting.length > 0 && !trustLater && <Dialog title="Trust this folder?" size="md" className="trust-dialog" onClose={() => setTrustLater(true)}
        description={trustManual.length ? "These agents did not take the answer automatically. Open their terminal and pick the trust option there." : "Agents can read and edit files in this folder and run commands in it. They are waiting for your answer before they start."}
        footer={trustManual.length ? <>
          <Button className="ghost" onClick={() => setTrustLater(true)}>Later</Button>
          <Button className="primary" onClick={() => { setTrustLater(true); openTerminal(trustManual[0]); }}>Open terminal</Button>
        </> : <>
          <Button className="ghost" onClick={() => setTrustLater(true)}>Not now</Button>
          <Button className="primary" autoFocus disabled={trusting} onClick={() => void trustAll()}>{trusting ? "Trusting…" : "Trust this folder"}</Button>
        </>}>
        <div className="trust-path"><FolderIcon aria-hidden="true" /><span title={workspace}>{workspace}</span></div>
        <p className="trust-who">{(trustManual.length ? trustManual : trustWaiting).join(", ")} {(trustManual.length ? trustManual : trustWaiting).length === 1 ? "is" : "are"} waiting.</p>
      </Dialog>}
      <AskHost />
      {toast && <div className="toast" role={toast.tone === "error" ? "alert" : "status"}><StatusDot tone={toast.tone} /><span>{error}</span><button type="button" className="icon-button" aria-label="Dismiss" onClick={() => setError("")}><XMarkIcon /></button></div>}
    </div>
  );
}