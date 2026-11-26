export type Message = { id: string; from: string; to: string; text: string; chats?: Record<string, string> };
export type PluginField = { label: string; description: string; kind: "text" | "number" | "boolean" | "enum"; required: boolean; hasValue: boolean; value: string | boolean };
export type PluginQuestionAnswer = { action: "accept" | "decline"; values?: Record<number, string | boolean> };
/** How full an agent's conversation is, as its CLI reports it. Tokens; window null = not reported. */
export type AgentContext = {
  used: number; cached: number; fresh: number; output: number; window: number | null; percent: number | null; at: number; guessed?: boolean;
  model?: string; modelName?: string; effort?: string; cacheHit?: number | null; cacheUntil?: string | null; cost?: number; durationMs?: number; apiMs?: number; linesAdded?: number; linesRemoved?: number;
  session?: { input: number; output: number; cached?: number }; limits?: { label: string; usedPercent: number; resetsAt: string | null }[];
};
export type AgentQuestion = {
  id: string;
  at: string;
  kind?: "plugin" | "menu";
  /** A menu the agent's CLI shows in its terminal (approval, file access): its question and its own choices. */
  question?: string; options?: string[];
  questions?: { question: string; header: string; multiSelect: boolean; options: { label: string; description: string }[] }[];
  server?: string;
  title?: string;
  message?: string;
  parseable?: boolean;
  totalFields?: number;
  fields?: PluginField[];
};
export type CustomTool = { id: string; name: string; command: string; cwd: string; note: string; page?: string; autostart: boolean; agents: boolean; stopped?: boolean; terminal: string; log: string; running: boolean; exitCode: number | null; startedAt: string | null };
export type TaskCard = { id: string; agent: string; lead: string; title: string; text: string; startedAt: string; status: "working" | "waiting" | "stalled" | "done" | "stopped"; endedAt: string | null; reason?: string | null; waitReason?: string; stalledAt?: string };
export type QuestionAnswer ={ picks: number[]; other?: string };
export type Server = { id: string; name: string; host: string; port: number; user: string; key: string; note: string; icon: string; access: "off" | "ask" | "on"; vpnId?: string; hasPassword?: boolean; password?: string };
export type Vpn = { id: string; name: string; type: "wireguard" | "proxy" | "jump"; config?: string; hasKey?: boolean; clearKey?: boolean; protocol?: "socks5" | "http"; host?: string; port?: number; user?: string; hasPassword?: boolean; password?: string };
export type Account = { provider: "claude" | "codex" | "antigravity"; id: string; label: string; dir: string; active: boolean; isDefault?: boolean; email?: string; plan?: string };
export type ServerCall = { id: string; time: number; agent: string; server: string; serverId: string; tool: string; action: string; status: "waiting" | "running" | "done" | "failed" | "denied"; code?: number };
export type RemoteTarget = { hosts: string[]; port: number; token: string; name: string };
export type RemoteState = { state: "local" | "connecting" | "connected" | "lost" | "failed"; error: string; target: RemoteTarget | null };
export type RemoteStatus = { share: boolean; link: string; clients: number; target: RemoteTarget | null; loginItem: boolean; host: string };
export type RemoteDialog = { id: string; mode: "open" | "save"; options: { title?: string; properties?: string[]; defaultPath?: string; filters?: { name: string; extensions: string[] }[] } };
declare global {
  interface Window {
    army: {
      packs: { pending(): Promise<string | null>; [key: string]: any };
      attention: { list(): Promise<Record<string, string>>; trust(): Promise<string[]> };
      customTools: {
        list(): Promise<CustomTool[]>; save(t: Partial<CustomTool>): Promise<CustomTool>; remove(id: string): Promise<boolean>;
        start(id: string): Promise<string>; stop(id: string): Promise<boolean>;
        chooseFile(): Promise<{ command: string; cwd: string; name: string } | null>; chooseFolder(): Promise<string | null>;
      };
      questions: { list(): Promise<Record<string, AgentQuestion>>; answer(name: string, answers: QuestionAnswer[] | PluginQuestionAnswer | { label: string }): Promise<boolean> };
      chats: { list(name: string): Promise<any[]>; switch(name: string, id?: string): Promise<any> };
      enlist(name: string, template: any, task: string): Promise<any>;
      agentAction(name: string, action: string): Promise<boolean>;
      setModel(name: string, model: string): Promise<{ mode: "applied" | "queued" | "saved" | "restarted" | "fresh" }>;
      gitChanges(): Promise<{ path: string; add: number; del: number; status: string }[]>;
      shells: { choices(): Promise<{ id: string; label: string; path: string }[]>; list(): Promise<{ name: string; title: string; cwd: string; exited: boolean }[]>; open(cwd?: string): Promise<string>; close(name: string): Promise<boolean>; rename(name: string, title: string): Promise<boolean> };
      voice: {
        status(): Promise<{ installed: boolean; running: boolean; flavor: string; exe: string; model: string; dir: string; lang: string; mic: string; shortcut: string; shortcutOk: boolean }>;
        warm(): Promise<boolean>;
        transcribe(wav: ArrayBuffer): Promise<string>;
        overlayDone(text: string): void;
        overlayLive(text: string): void;
        overlayClose(): void;
        overlayReady(): void;
        capture(on: boolean): Promise<boolean>;
      };
      zoom?: { get(): Promise<number>; step(dir: -1 | 0 | 1): Promise<number> };
      ui: { get(): Promise<Record<string, any>>; set(patch: Record<string, any>): Promise<Record<string, any>> };
      files: {
        list(rel?: string): Promise<{ name: string; path: string; dir: boolean; ignored?: boolean }[]>;
        read(rel: string): Promise<{ text?: string; mtime?: number; binary?: boolean; tooLarge?: boolean; size?: number }>;
        write(rel: string, text: string): Promise<number>;
        head(rel: string): Promise<string | null>;
        media?(rel: string): Promise<{ kind: "image" | "video" | "audio"; url: string; size: number } | null>;
        lsp: { open(lang: string, rel: string, text: string): Promise<boolean>; change(lang: string, rel: string, version: number, text: string): Promise<boolean>; close(lang: string, rel: string): Promise<boolean>; request(lang: string, method: string, rel: string, position: { line: number; character: number }): Promise<any>; resolve(lang: string, rel: string, item: any): Promise<any>; cOptions?(rel: string): Promise<{ value: string; using: string; options: { id: string; label: string }[] }>; cChoose(rel: string, value: string): Promise<boolean> };
        lint(rel: string, text: string): Promise<{ line: number; col: number; endLine: number; endCol: number; message: string; severity: string }[]>;
        all(): Promise<string[]>;
        search(query: string, opts?: { caseSensitive?: boolean }): Promise<{ path: string; line: number; col: number; text: string }[]>;
        watch(on: boolean): Promise<boolean>;
        reveal(rel: string): Promise<boolean>;
        context?(rel: string, isDir: boolean): Promise<"open" | "deleted" | null>;
        act(action: "reveal" | "open" | "copy-path" | "copy-rel" | "copy-name" | "trash", rels: string[]): Promise<string[]>;
        import(dir: string, items: { name: string; data: ArrayBuffer | null }[]): Promise<number>;
      };
      setEffort(name: string, effort: string): Promise<{ mode: "applied" | "queued" | "saved" | "restarted" | "fresh" }>;
      setPermission(name: string, permission: string): Promise<{ mode: "applied" | "saved" | "restarted" | "fresh" }>;
      interrupt(name: string): Promise<boolean>;
      context: { list(): Promise<Record<string, AgentContext>>; compact(name: string): Promise<boolean> };
      keepsChat(name: string): Promise<boolean>;
      info(): Promise<{ workspace: string; demo: boolean; operations: any[]; workspaces: string[] }>;
      output(name: string): Promise<string>;
      workspace(target?: string): Promise<string>;
      operations: { list(): Promise<any[]>; resume(id: string): Promise<any>; remove(id: string): Promise<any[]> };
      start(template: any, team?: string): Promise<string[]>;
      teams: { list(): Promise<any[]>; save(team: any): Promise<string>; saveCurrent(name: string, scope: string): Promise<string>; remove(file: string): Promise<boolean> };
      tasks: { list(): Promise<TaskCard[]> };
      resetOperation(): Promise<{ name: string; template: any; enlistedBy?: string; stopped?: boolean; error?: string }[]>;
      changeBoss(template: any, agent?: string): Promise<any>;
      isWorking(name: string): Promise<boolean>;
      templates: { list(): Promise<{ items: any[]; models: Record<string, string[]>; efforts?: Record<string, string[]>; permissions?: Record<string, string[]> }>; saveAgent(agent: string, name: string, scope: "project" | "global"): Promise<string> };
      attachmentPreview(path: string, large?: boolean): Promise<{ name: string; image?: string } | null>;
      pathFor(file: File): string;
      saveAttachments(files: { name: string; data: ArrayBuffer }[]): Promise<string[]>;
      send(to: string, text: string): Promise<boolean>;
      input(name: string, data: string): void;
      resize(name: string, cols: number, rows: number): void;
      on(event: string, fn: (value: any) => void): () => void;
      servers: {
        list(): Promise<Server[]>;
        save(s: Partial<Server>): Promise<Server>;
        remove(id: string): Promise<boolean>;
        order(ids: string[]): Promise<boolean>;
        test(s: Partial<Server>): Promise<{ ok: boolean; output: string }>;
        connect(id: string): Promise<string>;
        chooseKey(): Promise<string | null>;
        chooseIcon(): Promise<string | null>;
        approve(id: string, ok: boolean): Promise<boolean>;
        pending(): Promise<ServerCall[]>;
        log(): Promise<ServerCall[]>;
      };
      vpns: {
        list(): Promise<Vpn[]>;
        save(v: Partial<Vpn>): Promise<Vpn>;
        remove(id: string): Promise<boolean>;
        test(v: Partial<Vpn>, targetHost?: string, targetPort?: number): Promise<{ ok: boolean; output: string }>;
        chooseConf(): Promise<{ name: string; text: string } | null>;
      };
      accounts?: {
        list(provider?: string): Promise<Account[]>;
        add(provider: string, label?: string): Promise<{ account: Account; terminal: string; list: Account[] }>;
        activate(provider: string, id: string): Promise<Account[]>;
        rename(provider: string, id: string, label: string): Promise<Account[]>;
        remove(provider: string, id: string): Promise<Account[]>;
      };
      bossSwitch?(opts: { provider?: string; accountId?: string }): Promise<{ provider: string; accountId?: string; template: any }>;
      remote: {
        state(): RemoteState;
        onState(fn: (s: RemoteState) => void): () => void;
        retry(): Promise<void>;
        connect(link: string): Promise<RemoteTarget>;
        disconnect(): Promise<boolean>;
        status(): Promise<RemoteStatus>;
        share(on: boolean): Promise<RemoteStatus>;
        newLink(): Promise<RemoteStatus>;
        loginItem(on: boolean): Promise<RemoteStatus>;
        onDialog(fn: (req: RemoteDialog) => void): () => void;
        answerDialog(id: string, result: { canceled: boolean; filePaths?: string[]; filePath?: string }): Promise<void>;
        list(dir?: string): Promise<{ path: string; parent: string | null; sep: string; home: string; entries: { name: string; dir: boolean }[] }>;
      };
    };
  }
}
