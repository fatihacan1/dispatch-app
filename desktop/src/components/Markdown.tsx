import { Fragment, useEffect, useState, type ReactNode } from "react";
import { CopyButton } from "./CopyButton";

// Small, safe Markdown for chat: paragraphs, headings, lists, code fences, quotes, **bold**, *em*, `code`, links.
// Never injects HTML. Agents also write "1) foo 2) bar" inline; that becomes a list too.

const LOCAL_LINK = /^(?:file:\/\/|[a-z]:[\\/]|\/|\.{0,2}[\\/])/i;
/** Where a link points on this computer: "file:///D:/a%20b/x.md#L10" → "D:/a b/x.md"; null for web links and the like. */
export function localTarget(dest: string): string | null {
  let d = dest.trim().replace(/^<(.+)>$/, "$1");
  if (/^file:\/\//i.test(d)) { d = d.replace(/^file:\/\/(?:localhost)?/i, "").replace(/^\/(?=[a-z]:)/i, ""); try { d = decodeURIComponent(d); } catch {} }
  else if (/^[a-z][a-z0-9+.-]*:(?![\\/]?[^/]*[\\/])/i.test(d) && !/^[a-z]:/i.test(d)) return null;
  else if (/^[a-z][a-z0-9+.-]+:/i.test(d) || d.startsWith("#")) return null;
  else if (!LOCAL_LINK.test(d) && !/[\\/.]/.test(d)) return null;
  d = d.replace(/#L?\d[\w-]*$/i, "").replace(/:\d+(?::\d+)?$/, "");
  return d || null;
}
function FileLink({ target, children }: { target: string; children: ReactNode }) {
  const [missing, setMissing] = useState(false);
  const open = async () => {
    const r = await (window as any).army?.chatImage?.openPath?.(target).catch(() => null);
    setMissing(!!r?.missing);
    if (r?.rel) window.dispatchEvent(new CustomEvent("dispatch-open-file", { detail: r.rel }));
  };
  return <button type="button" className="md-file" title={missing ? `Not found: ${target}` : target} onClick={() => void open()}>{children}</button>;
}

// A link's target may hold balanced parentheses ("src/(app)/page.tsx") and, in < >, spaces.
const INLINE = /(`[^`\n]+`)|(\*\*(?:[^*\n]|\*(?!\*))+\*\*)|(\*[^*\n\s](?:[^*\n]*[^*\n\s])?\*(?![\w*]))|\[([^\]\n]+)\]\((<[^>\n]+>|(?:[^()\s]|\([^()\s]*\))+)\)|(https?:\/\/[^\s)\]]+)/g;
function inline(text: string, key = ""): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0, m: RegExpExecArray | null, i = 0;
  const re = new RegExp(INLINE.source, "g");
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${i++}`;
    if (m[1]) out.push(<code key={k}>{m[1].slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={k}>{inline(m[2].slice(2, -2), k)}</strong>);
    else if (m[3]) out.push(<em key={k}>{inline(m[3].slice(1, -1), k)}</em>);
    else if (m[4]) {
      const label = inline(m[4], k), local = localTarget(m[5]);
      if (/^https?:\/\//i.test(m[5])) out.push(<a key={k} href={m[5]} target="_blank" rel="noreferrer">{label}</a>);
      else if (local) out.push(<FileLink key={k} target={local}>{label}</FileLink>);
      else out.push(<Fragment key={k}>{label}</Fragment>);
    }
    else if (m[6]) { const url = m[6].replace(/[.,;:!?]+$/, ""); out.push(<a key={k} href={url} target="_blank" rel="noreferrer">{url}</a>); if (url.length < m[6].length) out.push(m[6].slice(url.length)); }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// "Started. 1) did a 2) did b" -> lead + list items, only when there are at least two numbered parts.
function inlineList(p: string): { lead: string; items: string[] } | null {
  const parts = p.split(/\s(?=\d{1,2}\)\s)/);
  if (parts.length < 3) return null;
  const items = parts.slice(1).map(s => s.replace(/^\d{1,2}\)\s/, ""));
  return { lead: parts[0], items };
}

// "![alt](D:\path\shot.png)" or "![alt](<path with spaces.png>)" on its own line: an image an agent shows from its outputs.
// Local paths only; the main process decides which files may be read (electron/chat-image.cjs).
const IMAGE = /^\s*!\[([^\]\n]*)\]\((.+)\)\s*$/;
const LINK = /^\s*\[([^\]\n]*)\]\((.+)\)\s*$/;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v)$/i;
const AUDIO_EXT = /\.(mp3|wav|ogg|m4a|flac)$/i;
const LOCAL_PATH = /^(?:[a-z]:[\\/]|\\\\|\/|\.\.?[\\/])/i;

function mediaExtKind(target: string): "video" | "audio" | null {
  if (VIDEO_EXT.test(target)) return "video";
  if (AUDIO_EXT.test(target)) return "audio";
  return null;
}

export function mediaAt(line: string): { kind: "video" | "audio"; alt: string; src: string; remote: boolean } | null {
  let alt = "", raw = "";
  const m = line.match(IMAGE) || line.match(LINK);
  if (m) {
    alt = m[1].trim();
    raw = m[2].trim().replace(/^<(.+)>$/, "$1").trim();
  } else {
    const t = line.trim();
    if (!t) return null;
    if (t.startsWith("<") && t.endsWith(">")) raw = t.slice(1, -1).trim();
    else if (/^https:\/\//i.test(t) && !/\s/.test(t)) raw = t;
    else if (LOCAL_PATH.test(t) || (!/\s/.test(t) && /[\\/]/.test(t))) raw = t;
    else return null;
  }
  if (!raw) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) || /^data:/i.test(raw)) {
    if (!/^https:\/\//i.test(raw)) return null;
    try {
      const kind = mediaExtKind(new URL(raw).pathname);
      return kind ? { kind, alt, src: raw, remote: true } : null;
    } catch { return null; }
  }
  const kind = mediaExtKind(raw);
  return kind ? { kind, alt, src: raw, remote: false } : null;
}

export function imageAt(line: string): { alt: string; src: string } | null {
  const m = line.match(IMAGE); if (!m) return null;
  const src = m[2].trim().replace(/^<(.+)>$/, "$1").trim();
  if (!src || /^[a-z][a-z0-9+.-]*:\/\//i.test(src) || /^data:/i.test(src) || mediaExtKind(src)) return null;
  return { alt: m[1].trim(), src };
}
function ChatMedia({ kind, alt, src, remote }: { kind: "video" | "audio"; alt: string; src: string; remote: boolean }) {
  const [url, setUrl] = useState<string | null | undefined>(remote ? src : undefined);
  useEffect(() => {
    if (remote) { setUrl(src); return; }
    let on = true; const api = (window as any).army?.chatImage;
    if (!api?.media) { setUrl(null); return; }
    api.media(src).then((res: { url?: string } | null) => { if (on) setUrl(res?.url || null); }).catch(() => { if (on) setUrl(null); });
    return () => { on = false; };
  }, [src, remote]);
  const name = src.split(/[\\/]/).pop()?.split("?")[0] || src;
  if (!url) return <p className="md-image-missing">{url === undefined ? `Loading ${kind}` : `${kind === "video" ? "Video" : "Audio"} not available`}: {alt || name}</p>;
  return kind === "video"
    ? <video className="md-video" src={url} controls preload="metadata" title={alt || name} />
    : <audio className="md-audio" src={url} controls title={alt || name} />;
}
function ChatImage({ alt, src }: { alt: string; src: string }) {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let on = true; const api = (window as any).army?.chatImage;
    if (!api) { setUrl(null); return; }
    api.get(src).then((u: string | null) => { if (on) setUrl(u || null); }).catch(() => { if (on) setUrl(null); });
    return () => { on = false; };
  }, [src]);
  const name = src.split(/[\\/]/).pop() || src;
  if (!url) return <p className="md-image-missing">{url === undefined ? "Loading image" : "Image not available"}: {alt || name}</p>;
  return <button type="button" className="md-image" title={`${alt || name} · click to open`} onClick={() => void (window as any).army?.chatImage?.open(src)}><img src={url} alt={alt || name} /></button>;
}

// A table starts with a row of cells followed by a |---|---| line.
const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim());
const tableAt = (lines: string[], i: number) => lines[i].includes("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes("|");

// One list item per entry, with the lines that belong under it (nested lists, code, paragraphs), already dedented.
// "1. Title" followed by "- detail" lines keeps the details under their number, also when they are not indented.
const MARK = /^(\s*)([-*•]|\d{1,3}[.)])\s+(.*)$/;
export type ListItem = { text: string; body: string[] };
export function takeList(lines: string[], at: number): { ordered: boolean; start: number; items: ListItem[]; next: number } {
  const head = MARK.exec(lines[at])!, base = head[1].length, ordered = /\d/.test(head[2]);
  const items: ListItem[] = []; let i = at, attached = false;
  const isOrdered = (s: string) => /\d/.test(s);
  while (i < lines.length) {
    const line = lines[i], m = MARK.exec(line);
    if (!line.trim()) {
      let n = i; while (n < lines.length && !lines[n].trim()) n++;
      if (n >= lines.length) { i = n; break; }
      const nm = MARK.exec(lines[n]), indent = /^\s*/.exec(lines[n])![0].length;
      if ((nm && indent < base + 2 && indent >= base - 1 && isOrdered(nm[2]) === ordered) || indent >= base + 2) { items[items.length - 1]?.body.push(""); i = n; continue; }
      break;
    }
    const indent = /^\s*/.exec(line)![0].length;
    if (m && indent < base + 2 && isOrdered(m[2]) === ordered) { if (indent < base - 1) break; items.push({ text: m[3], body: [] }); i++; continue; }
    if (!items.length) break;
    if (indent >= base + 2) { items[items.length - 1].body.push(line); i++; continue; }
    // Bullets at the same depth under a number, with the next number still to come: they belong to this one.
    if (m && ordered && indent >= base) {
      let n = i; while (n < lines.length && (!lines[n].trim() || (MARK.test(lines[n]) && !isOrdered(MARK.exec(lines[n])![2])) || /^\s{2,}\S/.test(lines[n]))) n++;
      const nm = n < lines.length ? MARK.exec(lines[n]) : null;
      if (attached || (nm && isOrdered(nm[2]) && parseInt(nm[2]) === parseInt(head[2]) + items.length)) {
        attached = true; items[items.length - 1].body.push("  " + line); i++; continue; }
    }
    break;
  }
  for (const it of items) {
    while (it.body.length && !it.body[it.body.length - 1].trim()) it.body.pop();
    const cut = Math.min(...it.body.filter(l => l.trim()).map(l => /^\s*/.exec(l)![0].length));
    if (Number.isFinite(cut)) it.body = it.body.map(l => l.slice(Math.min(cut, /^\s*/.exec(l)![0].length)));
  }
  return { ordered, start: ordered ? parseInt(head[2]) : 1, items, next: i };
}
const taskMark = (t: string) => t.replace(/^\[ \]\s+/, "☐ ").replace(/^\[[xX]\]\s+/, "☑ ");
const plainBody = (body: string[]) => body.every(l => l.trim() && !MARK.test(l) && !/^\s*(?:```|>|#{1,6}\s|\|)/.test(l) && !mediaAt(l) && !imageAt(l));

export function Markdown({ text }: { text: string }) { return <div className="md">{renderBlocks(text.replace(/\r\n/g, "\n").split("\n"))}</div>; }
function renderBlocks(lines: string[]): ReactNode[] {
  const blocks: ReactNode[] = [];
  let i = 0, n = 0;
  const key = () => `b${n++}`;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const fence = line.match(/^\s*```\s*([\w#+.-]*)/);
    if (fence) {
      const body: string[] = []; i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      i++;
      // Something to paste somewhere: the language on the left, a copy button on the right.
      const code = body.join("\n");
      blocks.push(<div className="md-code" key={key()}><div className="md-code-head"><span>{fence[1] || "code"}</span><CopyButton text={code} label="Copy code" showLabel /></div><pre><code>{code}</code></pre></div>); continue;
    }
    const media = mediaAt(line);
    if (media) { blocks.push(<ChatMedia key={key()} {...media} />); i++; continue; }
    const img = imageAt(line);
    if (img) { blocks.push(<ChatImage key={key()} alt={img.alt} src={img.src} />); i++; continue; }
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) { blocks.push(<hr key={key()} />); i++; continue; }
    if (tableAt(lines, i)) {
      const head = cells(lines[i]); i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]));
      const k = n;
      blocks.push(<div className="md-table" key={key()}><table>
        <thead><tr>{head.map((c, j) => <th key={j}>{inline(c, `th${k}-${j}`)}</th>)}</tr></thead>
        <tbody>{rows.map((r, y) => <tr key={y}>{head.map((_, j) => <td key={j}>{inline(r[j] || "", `td${k}-${y}-${j}`)}</td>)}</tr>)}</tbody>
      </table></div>);
      continue;
    }
    const h = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) { blocks.push(<p key={key()} className={`md-h md-h${Math.min(4, h[1].length)}`}>{inline(h[2], `h${n}`)}</p>); i++; continue; }
    if (/^\s*>\s?/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ""));
      blocks.push(<blockquote key={key()}>{renderBlocks(body)}</blockquote>); continue;
    }
    if (MARK.test(line)) {
      const list = takeList(lines, i); i = list.next;
      const items = list.items.map((it, j) => <li key={j}>{plainBody(it.body) ? inline(taskMark([it.text, ...it.body.map(l => l.trim())].join(" ")), `l${n}-${j}`) : <>{inline(taskMark(it.text), `l${n}-${j}`)}{renderBlocks(it.body)}</>}</li>);
      blocks.push(list.ordered ? <ol key={key()} start={list.start}>{items}</ol> : <ul key={key()}>{items}</ul>); continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !mediaAt(lines[i]) && !imageAt(lines[i]) && !/^\s*```/.test(lines[i]) && !/^\s{0,3}#{1,6}\s/.test(lines[i]) && !MARK.test(lines[i]) && !/^\s*>/.test(lines[i]) && !(para.length && tableAt(lines, i))) para.push(lines[i++]);
    const p = para.join("\n");
    const list = inlineList(p.replace(/\n/g, " "));
    if (list) {
      blocks.push(<Fragment key={key()}>{list.lead.trim() && <p>{inline(list.lead, `p${n}`)}</p>}<ol>{list.items.map((t, j) => <li key={j}>{inline(t, `il${n}-${j}`)}</li>)}</ol></Fragment>);
    } else blocks.push(<p key={key()}>{inline(p, `p${n}`)}</p>);
  }
  return blocks;
}

/** First sentence of a message, for collapsed rows. */
export function firstSentence(text: string, max = 180) {
  const flat = text.replace(/```[\s\S]*?```/g, " ").replace(/[#>*`]/g, "").replace(/\s+/g, " ").trim();
  const m = flat.match(/^.{20,}?[.!?:](?=\s|$)/);
  const s = m ? m[0] : flat;
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}
