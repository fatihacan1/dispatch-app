import { memo } from "react";
import { ICON_SPRITE, type IconId } from "./fileIconData";

const FILE_NAMES: Record<string, IconId> = {
  "package.json": "nodejs",
  "package-lock.json": "lock",
  "cargo.lock": "lock",
  "poetry.lock": "lock",
  "go.sum": "lock",
  "yarn.lock": "yarn",
  "pnpm-lock.yaml": "pnpm",
  "bun.lockb": "bun",
  "bun.lock": "bun",
  "tsconfig.json": "tsconfig",
  ".gitignore": "git",
  ".gitattributes": "git",
  ".gitmodules": "git",
  "dockerfile": "docker",
  ".dockerignore": "docker",
  ".env": "tune",
};

const EXT_ICONS: Record<string, IconId> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "react_ts",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "react",
  json: "json",
  jsonc: "json",
  json5: "json",
  md: "markdown",
  mdx: "markdown",
  css: "css",
  scss: "sass",
  sass: "sass",
  html: "html",
  htm: "html",
  py: "python",
  pyi: "python",
  pyw: "python",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  c: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  h: "h",
  cs: "csharp",
  php: "php",
  rb: "ruby",
  swift: "swift",
  sh: "console",
  bash: "console",
  zsh: "console",
  bat: "console",
  cmd: "console",
  ps1: "powershell",
  psm1: "powershell",
  psd1: "powershell",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  xml: "xml",
  plist: "xml",
  csproj: "xml",
  sql: "database",
  sqlite: "database",
  db: "database",
  env: "tune",
  lock: "lock",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  ico: "image",
  bmp: "image",
  avif: "image",
  svg: "svg",
  mp3: "audio",
  wav: "audio",
  ogg: "audio",
  flac: "audio",
  m4a: "audio",
  aac: "audio",
  mp4: "video",
  webm: "video",
  mov: "video",
  mkv: "video",
  avi: "video",
  pdf: "pdf",
  zip: "zip",
  tar: "zip",
  gz: "zip",
  tgz: "zip",
  "7z": "zip",
  rar: "zip",
  fbx: "3d",
  glb: "3d",
  gltf: "3d",
  obj: "3d",
  stl: "3d",
  uasset: "3d",
  blend: "blender",
  txt: "document",
  log: "log",
  csv: "table",
  tsv: "table",
};

const DIR_ICONS: Record<string, string> = {
  src: "folder-src",
  electron: "folder-desktop",
  components: "folder-components",
  assets: "folder-resource",
  public: "folder-public",
  node_modules: "folder-node",
  test: "folder-test",
  tests: "folder-test",
  e2e: "folder-test",
  __tests__: "folder-test",
  docs: "folder-docs",
  doc: "folder-docs",
  scripts: "folder-scripts",
  dist: "folder-dist",
  build: "folder-dist",
  release: "folder-dist",
  out: "folder-dist",
  ".git": "folder-git",
  ".github": "folder-github",
  ".vscode": "folder-vscode",
  ".dispatch": "folder-config",
};

const fileCache = new Map<string, IconId>();
const dirCache = new Map<string, string>();

const baseName = (nameOrPath: string): string => {
  const clean = nameOrPath.endsWith("/") ? nameOrPath.slice(0, -1) : nameOrPath;
  const i = clean.lastIndexOf("/");
  return (i >= 0 ? clean.slice(i + 1) : clean).toLowerCase();
};

/** Resolve a Material Icon Theme symbol id for a file name or path (memoized). */
export function iconForFile(nameOrPath: string): IconId {
  const name = baseName(nameOrPath);
  const cached = fileCache.get(name);
  if (cached) return cached;

  let icon: IconId | undefined = FILE_NAMES[name];
  if (!icon) {
    if (name.startsWith("tsconfig.") && name.endsWith(".json")) icon = "tsconfig";
    else if (/^vite(st)?\.config\.(js|ts|mjs|cjs|mts|cts)$/.test(name)) icon = "vite";
    else if (name.startsWith("dockerfile.") || /^docker-compose(\..+)?\.ya?ml$/.test(name)) icon = "docker";
    else if (name.startsWith(".env.")) icon = "tune";
    else {
      const dot = name.lastIndexOf(".");
      if (dot > 0) icon = EXT_ICONS[name.slice(dot + 1)];
    }
  }
  const result = icon || "file";
  fileCache.set(name, result);
  return result;
}

/** Resolve a Material Icon Theme symbol id for a folder name or path (memoized). */
export function iconForDir(nameOrPath: string, open = false): IconId {
  const name = baseName(nameOrPath);
  let base = dirCache.get(name);
  if (!base) {
    base = DIR_ICONS[name] || "folder";
    dirCache.set(name, base);
  }
  return (open ? `${base}-open` : base) as IconId;
}

const SPRITE_ID = "mi-icon-sprite";

function ensureSprite(): void {
  if (typeof document === "undefined" || document.getElementById(SPRITE_ID)) return;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.id = SPRITE_ID;
  svg.setAttribute("aria-hidden", "true");
  svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none";
  svg.innerHTML = ICON_SPRITE;
  document.body.appendChild(svg);
}

/** Plain Material Icon Theme glyph for a file or folder. */
export const FileIcon = memo(function FileIcon({
  name,
  dir = false,
  open = false,
  className,
}: {
  name: string;
  dir?: boolean;
  open?: boolean;
  className?: string;
}) {
  ensureSprite();
  const id = dir ? iconForDir(name, open) : iconForFile(name);
  return (
    <svg className={className} width={16} height={16} aria-hidden="true">
      <use href={`#mi-${id}`} />
    </svg>
  );
});
