import { Fragment, useEffect, useState, type ReactNode } from "react";

// Small, safe Markdown for chat: paragraphs, headings, lists, code fences, quotes, **bold**, *em*, `code`, links.
// Never injects HTML. Agents also write "1) foo 2) bar" inline; that becomes a list too.

function inline(text: string, key = ""): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n\s][^*\n]*\*)|(\[[^\]\n]+\]\((https?:\/\/[^)\s]+)\))|(https?:\/\/[^\s)]+)/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${i++}`;
    if (m[1]) out.push(<code key={k}>{m[1].slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={k}>{inline(m[2].slice(2, -2), k)}</strong>);
    else if (m[3]) out.push(<em key={k}>{m[3].slice(1, -1)}</em>);
    else if (m[4]) out.push(<a key={k} href={m[5]} target="_blank" rel="noreferrer">{m[4].slice(1, m[4].indexOf("]"))}</a>);
    else if (m[6]) out.push(<a key={k} href={m[6]} target="_blank" rel="noreferrer">{m[6]}</a>);
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
export function imageAt(line: string): { alt: string; src: string } | null {
  const m = line.match(IMAGE); if (!m) return null;
  const src = m[2].trim().replace(/^<(.+)>$/, "$1").trim();
  if (!src || /^[a-z][a-z0-9+.-]*:\/\//i.test(src) || /^data:/i.test(src)) return null;
  return { alt: m[1].trim(), src };
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

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0, n = 0;
  const key = () => `b${n++}`;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const fence = line.match(/^\s*```/);
    if (fence) {
      const body: string[] = []; i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      i++; blocks.push(<pre key={key()}><code>{body.join("\n")}</code></pre>); continue;
    }
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
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { blocks.push(<p key={key()} className={`md-h md-h${h[1].length}`}>{inline(h[2], `h${n}`)}</p>); i++; continue; }
    if (/^\s*>\s?/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ""));
      blocks.push(<blockquote key={key()}>{inline(body.join(" "), `q${n}`)}</blockquote>); continue;
    }
    const bullet = /^\s*[-*•]\s+/, numbered = /^\s*\d{1,2}[.)]\s+/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line), re = ordered ? numbered : bullet, items: string[] = [];
      while (i < lines.length && re.test(lines[i])) {
        let item = lines[i++].replace(re, "");
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !bullet.test(lines[i]) && !numbered.test(lines[i])) item += " " + lines[i++].trim();
        items.push(item);
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(<List key={key()}>{items.map((t, j) => <li key={j}>{inline(t, `l${n}-${j}`)}</li>)}</List>); continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !imageAt(lines[i]) && !/^\s*```/.test(lines[i]) && !/^#{1,4}\s/.test(lines[i]) && !bullet.test(lines[i]) && !numbered.test(lines[i]) && !/^\s*>/.test(lines[i]) && !(para.length && tableAt(lines, i))) para.push(lines[i++]);
    const p = para.join("\n");
    const list = inlineList(p.replace(/\n/g, " "));
    if (list) {
      blocks.push(<Fragment key={key()}>{list.lead.trim() && <p>{inline(list.lead, `p${n}`)}</p>}<ol>{list.items.map((t, j) => <li key={j}>{inline(t, `il${n}-${j}`)}</li>)}</ol></Fragment>);
    } else blocks.push(<p key={key()}>{inline(p, `p${n}`)}</p>);
  }
  return <div className="md">{blocks}</div>;
}

/** First sentence of a message, for collapsed rows. */
export function firstSentence(text: string, max = 180) {
  const flat = text.replace(/```[\s\S]*?```/g, " ").replace(/[#>*`]/g, "").replace(/\s+/g, " ").trim();
  const m = flat.match(/^.{20,}?[.!?:](?=\s|$)/);
  const s = m ? m[0] : flat;
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}
