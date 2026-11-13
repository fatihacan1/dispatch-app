export type Message = { id: string; from: string; to: string; text: string; chats?: Record<string, string> };
export type Server = { id: string; name: string; host: string; port: number; user: string; key: string; note: string; icon: string; access: "off" | "ask" | "on"; hasPassword?: boolean; password?: string };
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
      chats: { list(name: string): Promise<any[]>; switch(name: string, id?: string): Promise<any> };
      enlist(name: string, template: any, task: string): Promise<any>;
      agentAction(name: string, action: string): Promise<boolean>;
      setModel(name: string, model: string): Promise<{ mode: "applied" | "queued" | "saved" | "restarted" | "fresh" }>;
      gitChanges(): Promise<{ path: string; add: number; del: number; status: string }[]>;
      shells: { list(): Promise<{ name: string; title: string; cwd: string; exited: boolean }[]>; open(): Promise<string>; close(name: string): Promise<boolean>; rename(name: string, title: string): Promise<boolean> };
      voice: {
        status(): Promise<{ installed: boolean; running: boolean; flavor: string; exe: string; model: string; dir: string; lang: string; mic: string; shortcut: string; shortcuts: string[]; shortcutOk: boolean }>;
        warm(): Promise<boolean>;
        transcribe(wav: ArrayBuffer): Promise<string>;
        overlayDone(text: string): void;
        overlayLive(text: string): void;
        overlayClose(): void;
      };
      ui: { get(): Promise<Record<string, any>>; set(patch: Record<string, any>): Promise<Record<string, any>> };
      files: {
        list(rel?: string): Promise<{ name: string; path: string; dir: boolean; ignored?: boolean }[]>;
        read(rel: string): Promise<{ text?: string; mtime?: number; binary?: boolean; tooLarge?: boolean; size?: number }>;
        write(rel: string, text: string): Promise<number>;
        head(rel: string): Promise<string | null>;
        all(): Promise<string[]>;
        search(query: string, opts?: { caseSensitive?: boolean }): Promise<{ path: string; line: number; col: number; text: string }[]>;
        watch(on: boolean): Promise<boolean>;
        reveal(rel: string): Promise<boolean>;
        context?(rel: string, isDir: boolean): Promise<"open" | "deleted" | null>;
        import(dir: string, items: { name: string; data: ArrayBuffer | null }[]): Promise<number>;
      };
      setEffort(name: string, effort: string): Promise<{ mode: "applied" | "queued" | "saved" | "restarted" | "fresh" }>;
      info(): Promise<{ workspace: string; demo: boolean; operations: any[]; workspaces: string[] }>;
      output(name: string): Promise<string>;
      workspace(target?: string): Promise<string>;
      operations: { list(): Promise<any[]>; resume(id: string): Promise<any>; remove(id: string): Promise<any[]> };
      start(template: any, team?: string): Promise<string[]>;
      teams: { list(): Promise<any[]>; save(team: any): Promise<string>; saveCurrent(name: string, scope: string): Promise<string>; remove(file: string): Promise<boolean> };
      resetOperation(): Promise<{ name: string; template: any; enlistedBy?: string }[]>;
      changeBoss(template: any, agent?: string): Promise<any>;
      isWorking(name: string): Promise<boolean>;
      templates: { list(): Promise<{ items: any[]; models: Record<string, string[]>; efforts?: Record<string, string[]> }>; saveAgent(agent: string, name: string, scope: "project" | "global"): Promise<string> };
      attachmentPreview(path: string): Promise<{ name: string; image?: string } | null>;
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
