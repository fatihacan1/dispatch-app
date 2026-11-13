import { useEffect, useState } from "react";
import unrealSvg from "../../public/tools/unreal.svg?raw";
import memorySvg from "../../public/tools/memory.svg?raw";
import rustSvg from "../../public/tools/rustxng.svg?raw";
import ddgsSvg from "../../public/tools/ddgs.svg?raw";
import blenderSvg from "../../public/tools/blender.svg?raw";
import { ArrowTopRightOnSquareIcon, FolderArrowDownIcon, FolderIcon, MicrophoneIcon } from "@heroicons/react/16/solid";
import { Button, Console, StatusDot } from "../components/common";
import { ScheduleTool, TelegramTool } from "./ToolsExtra";

type Comfy = { installed: boolean; running: boolean; url: string; path: string; version: string; models: number; gpu: string; startedByDispatch: boolean };
const army = () => (window as any).army;
// Single-color brand marks (simple-icons), inlined so they take the theme's text color.
const MARKS: Record<string, string> = { blender: blenderSvg, unreal: unrealSvg, memory: memorySvg, rustxng: rustSvg, ddgs: ddgsSvg };
const Mark = ({ id }: { id: string }) => <span className="prov-icon tool-mark" aria-hidden="true" dangerouslySetInnerHTML={{ __html: MARKS[id].replace("<svg", '<svg fill="currentColor"') }} />;

/** Local tools agents can use. Enable a tool per agent in Agent templates > Tools. */
export function Tools({ openMemory }: { openMemory?: () => void }) {
  const [comfy, setComfy] = useState<Comfy | null>(null);
  const [mcp, setMcp] = useState<Record<string, boolean> | null>(null);
  const [busy, setBusy] = useState(false);
  const [task, setTask] = useState<{ name: string; label: string; done?: boolean; code?: number } | null>(null);
  const [error, setError] = useState("");
  const [files, setFiles] = useState<Record<string, string | null>>({});
  const loadFiles = () => Promise.all(["comfyui", "voicestudio", "rustxng", "ddgs", "blender"].map(async id => [id, await army().tools.file?.(id).catch(() => null)] as const)).then(e => setFiles(Object.fromEntries(e)));
  const show = (id: string) => files[id] ? <button type="button" className="icon-button lg" title={`Show ${files[id]} in folder`} aria-label={`Show ${files[id]} in folder`} onClick={() => army().tools.reveal(id)}><FolderArrowDownIcon /></button> : null;
  const [voice, setVoice] = useState<{ installed: boolean; running: boolean; url: string; path: string } | null>(null);
  const [bl, setBl] = useState<{ installed: boolean; running: boolean; addon: boolean; version: string; path: string; port: number } | null>(null);
  const [ue, setUe] =useState<{ installed: boolean; running: boolean; version: string; url: string; project: string; projectName: string; pluginsEnabled: boolean } | null>(null);
  const [stt, setStt] = useState<{ installed: boolean; running: boolean; flavor: string; dir: string; shortcut: string; modelName: string } | null>(null);
  const refresh = async () => { try { setComfy(await army().tools.status()); setVoice(await army().tools.voiceStatus()); setStt(await army().voice.status()); setUe(await army().tools.unrealStatus()); setBl(await army().tools.blenderStatus()); } catch (e) { setError(String(e)); } };
  useEffect(() => {
    void refresh(); void loadFiles(); army().mcpStatus?.().then(setMcp).catch(() => {});
    const id = window.setInterval(refresh, 3000);
    const off = army().on("tool:done", (e: any) => { setTask(t => t && t.name === e.name ? { ...t, done: true, code: e.exitCode } : t); void refresh(); void loadFiles(); army().mcpStatus?.().then(setMcp).catch(() => {}); });
    return () => { window.clearInterval(id); off(); };
  }, []);
  const run = async (fn: () => Promise<any>) => { setBusy(true); setError(""); try { await fn(); } catch (e) { setError(String(e).replace(/^Error: Error invoking remote method '[^']+': (Error: )?/, "")); } finally { setBusy(false); setTimeout(refresh, 1500); } };
  const comfyTone = !comfy ? "idle" : comfy.running ? "working" : comfy.installed ? "idle" : "idle";
  const comfyLabel = !comfy ? "Checking…" : comfy.running ? "Running" : comfy.installed ? "Stopped" : "Not installed";

  return (
    <div className={"page prov-page tools-page" + (task ? " with-task" : "")}>
      <div className="view-heading"><h1>Tools</h1></div>
      <div className="prov-list">
        <p className="page-lead">Local tools your agents can use. Turn a tool on for an agent in Agent templates, under Tools. Everything a tool generates or downloads shows up under Outputs in the side panel.</p>
        <ScheduleTool />
        <TelegramTool />
        <div className="prov-row">
          <img className="prov-icon" src="./tools/comfyui.svg" alt="" />
          <div className="prov-main">
            <div className="prov-title"><b>ComfyUI</b><StatusDot tone={comfyTone} label={comfyLabel} /></div>
            <small>{comfy?.installed ? [comfy.version && `v${comfy.version}`, comfy.path, `${comfy.models} models`, comfy.gpu].filter(Boolean).join(" · ") : "Image, video, audio, music and 3D workflows, with the official template library."}</small>
            <small>Agents can search templates, download the models a template needs, run workflows and read the results.</small>
          </div>
          <div className="prov-actions">
            {comfy && !comfy.installed && <Button className="primary" disabled={busy} onClick={() => run(async () => setTask({ label: "ComfyUI", name: await army().tools.install("comfyui") }))}>Install</Button>}
            {comfy?.installed && !comfy.running && <Button className="primary" disabled={busy} onClick={() => run(() => army().tools.start())}>Start</Button>}
            {comfy?.running && <Button className="secondary" onClick={() => window.open(comfy.url, "_blank")}><ArrowTopRightOnSquareIcon aria-hidden="true" />Open</Button>}
            {comfy?.running && <Button className="danger-ghost" disabled={busy} onClick={() => run(() => army().tools.stop())}>Stop</Button>}
            {show("comfyui")}
            <button type="button" className="icon-button lg" title="Choose ComfyUI folder" aria-label="Choose ComfyUI folder" onClick={() => run(() => army().tools.choosePath())}><FolderIcon /></button>
          </div>
        </div>
        <div className="prov-row">
          <Mark id="unreal" />
          <div className="prov-main">
            <div className="prov-title"><b>Unreal Engine</b><StatusDot tone={ue?.running ? "working" : "idle"} label={!ue ? "Checking…" : !ue.installed ? "Not found" : ue.running ? "Connected" : "Editor closed"} /></div>
            <small>{ue?.installed ? [`UE ${ue.version}`, ue.projectName || "No project chosen", ue.project && (ue.pluginsEnabled ? "MCP plugins on" : "MCP plugins off"), ue.url].filter(Boolean).join(" · ") : "Needs Unreal Engine 5.8 or newer, installed from the Epic Games Launcher."}</small>
            <small>Uses Epic's Unreal MCP plugin: agents edit Blueprints, actors and levels, compile C++ with Live Coding and run automation tests while the editor is open.</small>
          </div>
          <div className="prov-actions">
            {ue?.installed && ue.project && !ue.pluginsEnabled && <Button className="primary" disabled={busy} onClick={() => run(() => army().tools.unrealEnable())}>Enable MCP plugins</Button>}
            {ue?.installed && ue.project && ue.pluginsEnabled && !ue.running && <Button className="primary" disabled={busy} onClick={() => run(() => army().tools.unrealOpen())}>Open editor</Button>}
            {ue?.installed && <button type="button" className="icon-button lg" title="Choose .uproject" aria-label="Choose Unreal project" onClick={() => run(async () => { await army().tools.unrealChoose(); void loadFiles(); })}><FolderIcon /></button>}
          </div>
        </div>
        <div className="prov-row">
          <Mark id="blender" />
          <div className="prov-main">
            <div className="prov-title"><b>Blender</b><StatusDot tone={bl?.running ? "working" : "idle"} label={!bl ? "Checking…" : !bl.installed ? "Not found" : !bl.addon ? "Add-on missing" : bl.running ? "Connected" : "Closed"} /></div>
            <small>{bl?.installed ? [`Blender ${bl.version}`, bl.path, bl.addon ? `MCP add-on on port ${bl.port}` : "MCP add-on not installed"].join(" · ") : "Install Blender from blender.org or Steam, or choose blender.exe."}</small>
            <small>Agents clean up and fix 3D models: remesh, UVs, baking, materials and textures, scale and pivot, export to FBX or glTF, and check the viewport. Blender opens automatically when an agent needs it.</small>
          </div>
          <div className="prov-actions">
            {bl?.installed && !bl.addon && <Button className="primary" disabled={busy} onClick={() => run(async () => setTask({ label: "Blender MCP add-on", name: await army().tools.install("blender") }))}>Install add-on</Button>}
            {bl?.installed && bl.addon && !bl.running && <Button className="primary" disabled={busy} onClick={() => run(() => army().tools.blenderStart())}>Open Blender</Button>}
            {show("blender")}
            <button type="button" className="icon-button lg" title="Choose blender.exe" aria-label="Choose blender.exe" onClick={() => run(async () => { await army().tools.blenderChoose(); void loadFiles(); })}><FolderIcon /></button>
          </div>
        </div>
        <div className="prov-row">
          <img className="prov-icon" src="./tools/voicestudio.png" alt="" />
          <div className="prov-main">
            <div className="prov-title"><b>VoiceStudio</b><StatusDot tone={voice?.running ? "working" : "idle"} label={!voice ? "Checking…" : voice.running ? "Running" : voice.installed ? "Stopped" : "Not installed"} /></div>
            <small>{voice?.installed ? [voice.path, voice.url].filter(Boolean).join(" · ") : "Voice cloning, speech, voice design and transcription, fully local."}</small>
            <small>Agents can clone a voice, generate speech and transcribe audio. VoiceStudio starts automatically when an agent needs it.</small>
          </div>
          <div className="prov-actions">
            {voice && !voice.installed && <Button className="primary" disabled={busy} onClick={() => run(async () => setTask({ label: "VoiceStudio", name: await army().tools.install("voicestudio") }))}>Install</Button>}
            {voice?.installed && !voice.running && <Button className="primary" disabled={busy} onClick={() => run(() => army().tools.voiceStart())}>Start</Button>}
            {show("voicestudio")}
            <button type="button" className="icon-button lg" title="Choose VoiceStudio.exe" aria-label="Choose VoiceStudio.exe" onClick={() => run(async () => { await army().tools.voiceChoose(); void loadFiles(); })}><FolderIcon /></button>
          </div>
        </div>
        <div className="prov-row">
          <span className="prov-icon tool-glyph"><MicrophoneIcon aria-hidden="true" /></span>
          <div className="prov-main">
            <div className="prov-title"><b>Voice typing</b><StatusDot tone={stt?.installed ? "working" : "idle"} label={!stt ? "Checking…" : stt.installed ? (stt.running ? "Loaded" : "Ready") : "Not installed"} /></div>
            <small>{stt?.installed ? `whisper.cpp ${stt.flavor === "cuda" ? "on your NVIDIA GPU" : stt.flavor === "vulkan" ? "on your GPU (Vulkan)" : "on the CPU"} · large-v3-turbo · ${stt.dir}` : "Speak instead of typing: the mic in the chat box and a shortcut that works from any app. Runs fully on this computer, Turkish included."}</small>
            <small>{stt?.installed ? `Shortcut ${stt.shortcut.replace(/\+/g, " ")} · language and shortcut in Settings, Voice.` : "Installs the whisper.cpp engine (NVIDIA: CUDA build, about 650 MB; AMD/Intel: Vulkan build included with Dispatch; else CPU, 21 MB) and the model (large-v3-turbo 547 MB on NVIDIA; small 181 MB on other machines), checksums verified."}</small>
          </div>
          <div className="prov-actions">
            {stt && !stt.installed && <Button className="primary" disabled={busy} onClick={() => run(async () => setTask({ label: "voice typing", name: await army().tools.install("whisper") }))}>Install</Button>}
            {stt?.installed && <button type="button" className="icon-button lg" title="Show the voice typing folder" aria-label="Show the voice typing folder" onClick={() => army().tools.reveal("whisper")}><FolderArrowDownIcon /></button>}
          </div>
        </div>
        <div className="prov-row">
          <Mark id="memory" />
          <div className="prov-main">
            <div className="prov-title"><b>Memory</b><StatusDot tone="working" label="Built in" /></div>
            <small>Long-term memory for the boss only: project and global knowledge graphs it searches instead of rereading everything.</small>
            <small>Based on the official MCP Memory server (open source). Settings are under Settings, Memory.</small>
          </div>
          <div className="prov-actions">{openMemory && <Button className="secondary" onClick={openMemory}>Open</Button>}</div>
        </div>
        {[{ id: "rustxng", name: "RustXNG", desc: "Web search and page reading", how: "Official Windows release, checksum verified" }, { id: "ddgs", name: "DDGS", desc: "Image, video and news search", how: "Installed with Python in its own environment" }].map(t => (
          <div className="prov-row" key={t.id}>
            <Mark id={t.id} />
            <div className="prov-main">
              <div className="prov-title"><b>{t.name}</b><StatusDot tone={mcp?.[t.id] ? "working" : "idle"} label={mcp === null ? "Checking…" : mcp[t.id] ? "Ready" : "Not installed"} /></div>
              <small>{t.desc} · Built in, {mcp?.[t.id] ? "ready for agents" : t.how.toLowerCase()}</small>
            </div>
            <div className="prov-actions">
              {show(t.id)}
              {mcp && !mcp[t.id] && <Button className="primary" disabled={busy} onClick={() => run(async () => setTask({ label: t.name, name: await army().tools.install(t.id) }))}>Install</Button>}
            </div>
          </div>
        ))}
        {error && <p className="tpl-error">{error}</p>}
      </div>
      {task && <div className="prov-task">
        <div className="prov-task-head"><span>{task.done ? (task.code === 0 ? "Finished" : `Exited with code ${task.code}`) : `Installing ${task.label}…`}</span>{task.label === "ComfyUI" && <small>Downloads the official Windows portable build (several GB).</small>}<Button className="ghost" onClick={() => setTask(null)}>{task.done ? "Close" : "Hide"}</Button></div>
        <Console key={task.name} name={task.name} />
      </div>}
    </div>
  );
}
