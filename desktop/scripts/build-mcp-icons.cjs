// Generates desktop/src/lib/mcpIcons.ts:
// 1. Iconify 'logos' set (full-colour brand logos by gilbarbara/svg-logos), preferring <slug>-icon then <slug>.
// 2. Falls back to simple-icons@16.38.0 mono path (also used when a full-colour logo is mostly black/dark).
// 3. Falls back to svgl (api.svgl.app), preferring dark-theme variant.
// 4. Falls back to the brand's own website icon (apple-touch-icon.png or <head> icon links, PNG <= 12 KB or SVG).
// 5. Ids without any of the above get no entry (UI shows the initial letter).
// Run: node desktop/scripts/build-mcp-icons.cjs
const fs = require('fs');
const path = require('path');
const { CATALOG } = require('../electron/connectors.cjs');

let sharp = null;
try { sharp = require('sharp'); } catch {}

const SIMPLE_ICONS_VERSION = '16.38.0';
const SI_BASE = `https://cdn.jsdelivr.net/npm/simple-icons@${SIMPLE_ICONS_VERSION}`;
const ICONIFY_LOGOS_JSON = 'https://cdn.jsdelivr.net/npm/@iconify-json/logos@1/icons.json';
const SVGL_BASE = 'https://api.svgl.app';
const MAX_PNG_BYTES = 12 * 1024;
const FETCH_HEADERS = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' };

const LOGO_SLUGS = {
  googlechrome: 'chrome',
  huggingface: 'hugging-face',
  digitalocean: 'digital-ocean',
  calcom: 'cal',
  mercadopago: 'mercado-pago',
  launchdarkly: 'launchdarkly',
};

const SI_SLUGS = {
  calcom: 'caldotcom',
};

// Brands whose Iconify 'logos' mark is black/monochrome and should use Simple Icons currentColor instead.
const PREFER_MONO = new Set([
  'github',
  'vercel',
  'notion',
  'railway',
  'resend',
  'sanity',
  'posthog',
  'prisma',
  'sentry',
  'miro',
  'buffer',
  'square',
  'calcom',
  'intercom',
]);

function titleToSlug(title) {
  return title
    .toLowerCase()
    .replace(/\+/g, 'plus')
    .replace(/\./g, 'dot')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '');
}

function isNearBlackHex(hex) {
  const h = hex.length === 3 ? hex.replace(/./g, c => c + c) : hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luma < 45 || (Math.max(r, g, b) < 95 && luma < 70);
}

function isMostlyDarkSvg(svg) {
  const hexes = [...svg.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)].map(m => m[1]);
  if (hexes.length === 0) return true;
  return hexes.every(isNearBlackHex);
}

function isWideWordmark(svg) {
  const m = /viewBox=["'][\d.\-]+\s+[\d.\-]+\s+([\d.]+)\s+([\d.]+)["']/i.exec(svg);
  if (!m) return false;
  const w = parseFloat(m[1]);
  const h = parseFloat(m[2]);
  return h > 0 && w / h > 2.2;
}

function sanitizeSvg(svg, key) {
  let s = svg
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(?:xlink:)?href\s*=\s*(?:"(?!#)[^"]*"|'(?!#)[^']*')/gi, '');

  // Namespace internal IDs so gradients/clipPaths never collide across icons on the page.
  const prefix = `mcp_${key.replace(/[^a-z0-9]/gi, '_')}_`;
  const ids = new Set([...s.matchAll(/\sid=["']([^"']+)["']/g)].map(m => m[1]));
  for (const id of ids) {
    const safe = prefix + id;
    s = s
      .replace(new RegExp(`(\\sid=["'])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(["'])`, 'g'), `$1${safe}$2`)
      .replace(new RegExp(`url\\(#${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`, 'g'), `url(#${safe})`)
      .replace(new RegExp(`((?:xlink:)?href=["']#)${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(["'])`, 'g'), `$1${safe}$2`);
  }

  // Strip root width/height so CSS (.mcp-logo svg) sizes cleanly via viewBox.
  s = s.replace(/<svg\b([^>]*)>/i, (_, attrs) => {
    const cleaned = attrs
      .replace(/\s(?:width|height)=["'][^"']*["']/gi, '')
      .replace(/\sxmlns:xlink=["'][^"']*["']/gi, '');
    return `<svg${cleaned}>`;
  });

  return s.trim();
}

function adaptDarkSvgToCurrentColor(svg) {
  const withoutStyle = svg.replace(/<style[\s\S]*?<\/style>/gi, '');
  if (!isMostlyDarkSvg(withoutStyle)) return svg;
  let s = withoutStyle.replace(/\b(fill|stroke)=["']([^"']+)["']/gi, (full, attr, val) => {
    const v = val.trim().toLowerCase();
    if (v === 'black' || (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) && isNearBlackHex(v.slice(1)))) {
      return `${attr}="currentColor"`;
    }
    return full;
  });
  return s;
}

function fetchLogoSvg(key, logoSet) {
  if (PREFER_MONO.has(key) || !logoSet) return null;
  const slug = LOGO_SLUGS[key] || key;
  for (const candidate of [`${slug}-icon`, slug]) {
    const entry = logoSet.icons?.[candidate];
    if (!entry || !entry.body) continue;
    const w = entry.width || logoSet.width || 256;
    const h = entry.height || logoSet.height || 256;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${entry.body}</svg>`;
    if (isWideWordmark(svg)) continue;
    if (isMostlyDarkSvg(svg)) continue;
    return sanitizeSvg(svg, key);
  }
  return null;
}

async function fetchSvglSvg(key, item) {
  const queries = [...new Set([item.name, key].filter(Boolean))];
  for (const q of queries) {
    const r = await fetch(`${SVGL_BASE}?search=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(10000) }).catch(() => null);
    if (!r || !r.ok) continue;
    const list = await r.json().catch(() => null);
    if (!Array.isArray(list) || !list.length) continue;
    const targetSlug = titleToSlug(item.name || key);
    const match = list.find(e => titleToSlug(e.title || '') === targetSlug || titleToSlug(e.title || '') === key);
    if (!match || !match.route) continue;
    const route = typeof match.route === 'object' ? (match.route.dark || match.route.light) : match.route;
    if (!route) continue;
    const svgRes = await fetch(route, { signal: AbortSignal.timeout(10000) }).catch(() => null);
    if (!svgRes || !svgRes.ok) continue;
    const svg = await svgRes.text();
    if (!svg.includes('<svg') || isWideWordmark(svg)) continue;
    return sanitizeSvg(svg, key);
  }
  return null;
}

function isPngBuffer(buf) {
  return buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
}

async function tryIconUrl(url, key) {
  const r = await fetch(url, { headers: FETCH_HEADERS, redirect: 'follow', signal: AbortSignal.timeout(10000) }).catch(() => null);
  if (!r || !r.ok) return null;
  const ct = (r.headers.get('content-type') || '').toLowerCase();
  const buf = Buffer.from(await r.arrayBuffer());
  if (!buf.length) return null;
  if (ct.includes('svg') || url.toLowerCase().split('?')[0].endsWith('.svg')) {
    const svg = buf.toString('utf8');
    if (svg.includes('<svg') && !isWideWordmark(svg)) return { svg: adaptDarkSvgToCurrentColor(sanitizeSvg(svg, key)) };
    return null;
  }
  if (isPngBuffer(buf)) {
    let finalBuf = buf;
    if (finalBuf.length > MAX_PNG_BYTES && sharp) {
      try {
        finalBuf = await sharp(buf).resize(48, 48, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
      } catch {}
    }
    if (finalBuf.length <= MAX_PNG_BYTES) {
      return { src: `data:image/png;base64,${finalBuf.toString('base64')}` };
    }
  }
  return null;
}

function parseAttr(tag, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : '';
}

function parseSizeScore(sizes) {
  if (!sizes) return 0;
  if (/any/i.test(sizes)) return 10000;
  let best = 0;
  for (const m of sizes.matchAll(/(\d+)\s*x\s*(\d+)/gi)) best = Math.max(best, Number(m[1]) * Number(m[2]));
  return best;
}

async function fetchDomainIcon(key, item) {
  let domain = item.domain;
  if (!domain && item.url && /^https?:\/\//.test(item.url)) {
    try { domain = new URL(item.url).hostname.replace(/^(?:mcp|api|app)\./, ''); } catch {}
  }
  if (!domain) return null;

  const candidates = [];
  const home = await fetch(`https://${domain}/`, { headers: FETCH_HEADERS, redirect: 'follow', signal: AbortSignal.timeout(10000) }).catch(() => null);
  if (home && home.ok) {
    const html = await home.text();
    const baseUrl = home.url || `https://${domain}/`;
    const head = html.slice(0, 120000);
    for (const m of head.matchAll(/<link\b[^>]*>/gi)) {
      const tag = m[0];
      const rel = parseAttr(tag, 'rel').toLowerCase();
      if (!/\b(?:icon|apple-touch-icon|apple-touch-icon-precomposed)\b/.test(rel)) continue;
      const href = parseAttr(tag, 'href').trim();
      if (!href || href.startsWith('data:')) continue;
      let abs;
      try { abs = new URL(href, baseUrl).toString(); } catch { continue; }
      const type = parseAttr(tag, 'type').toLowerCase();
      const isSvg = type.includes('svg') || abs.toLowerCase().split('?')[0].endsWith('.svg');
      const isPng = type.includes('png') || abs.toLowerCase().split('?')[0].endsWith('.png') || rel.includes('apple-touch-icon');
      if (!isSvg && !isPng) continue;
      const score = (isSvg ? 1000000 : 0) + parseSizeScore(parseAttr(tag, 'sizes')) + (rel.includes('apple-touch-icon') ? 100 : 0);
      candidates.push({ url: abs, score });
    }
  }
  // Try /apple-touch-icon.png after SVG links, before smaller PNGs.
  candidates.push({ url: `https://${domain}/apple-touch-icon.png`, score: 50000 });
  candidates.sort((a, b) => b.score - a.score);
  const seen = new Set();
  for (const c of candidates) {
    if (seen.has(c.url)) continue;
    seen.add(c.url);
    const hit = await tryIconUrl(c.url, key);
    if (hit) return hit;
  }
  return null;
}

async function main() {
  const [metaRes, logosRes] = await Promise.all([
    fetch(`${SI_BASE}/data/simple-icons.json`),
    fetch(ICONIFY_LOGOS_JSON, { signal: AbortSignal.timeout(20000) }).catch(() => null),
  ]);
  if (!metaRes.ok) throw new Error(`Failed to fetch simple-icons.json: ${metaRes.status}`);
  const meta = await metaRes.json();
  const logoSet = logosRes && logosRes.ok ? await logosRes.json().catch(() => null) : null;

  const hexBySlug = new Map();
  for (const item of meta) {
    hexBySlug.set(item.slug || titleToSlug(item.title), item.hex);
  }

  const itemByKey = new Map();
  for (const c of CATALOG) {
    const k = c.icon || c.id;
    if (!itemByKey.has(k)) itemByKey.set(k, c);
  }
  const keys = [...itemByKey.keys()];
  const icons = {};
  let logoCount = 0;
  let siCount = 0;
  let svglCount = 0;
  let siteCount = 0;
  const missing = [];

  for (const key of keys) {
    const item = itemByKey.get(key);
    const fullSvg = fetchLogoSvg(key, logoSet);
    if (fullSvg) {
      icons[key] = { svg: fullSvg };
      logoCount++;
      continue;
    }

    const siSlug = SI_SLUGS[key] || key;
    const hex = hexBySlug.get(siSlug);
    if (hex) {
      const svgRes = await fetch(`${SI_BASE}/icons/${siSlug}.svg`);
      if (svgRes.ok) {
        const svg = await svgRes.text();
        const m = /<path[^>]+d="([^"]+)"/.exec(svg);
        if (m) {
          icons[key] = {
            d: m[1],
            color: isNearBlackHex(hex) ? '' : `#${hex}`,
          };
          siCount++;
          continue;
        }
      }
    }

    const svglSvg = await fetchSvglSvg(key, item);
    if (svglSvg) {
      icons[key] = { svg: svglSvg };
      svglCount++;
      continue;
    }

    const siteIcon = await fetchDomainIcon(key, item);
    if (siteIcon) {
      icons[key] = siteIcon;
      siteCount++;
      continue;
    }

    missing.push(key);
  }

  const outPath = path.resolve(__dirname, '../src/lib/mcpIcons.ts');
  const header =
    `// Generated by scripts/build-mcp-icons.cjs from Iconify 'logos' + simple-icons@${SIMPLE_ICONS_VERSION} + svgl + brand site icons. Do not edit by hand.\n` +
    `// color '' = near-black mark, drawn in the text color.\n` +
    `export type McpIcon = { svg: string } | { d: string; color: string } | { src: string };\n` +
    `export const MCP_ICONS: Record<string, McpIcon> = `;
  fs.writeFileSync(outPath, `${header}${JSON.stringify(icons, null, 1)};\n`);
  console.log(`Wrote ${Object.keys(icons).length} icons (${logoCount} Iconify logos, ${siCount} simple-icons mono, ${svglCount} svgl, ${siteCount} site icons, ${missing.length} letter fallback: ${missing.join(', ')}).`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
