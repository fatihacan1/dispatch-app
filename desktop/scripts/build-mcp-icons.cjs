// Generates desktop/src/lib/mcpIcons.ts:
// 1. Iconify 'logos' set (full-colour brand logos by gilbarbara/svg-logos), preferring <slug>-icon then <slug>.
// 2. Falls back to simple-icons@16.38.0 mono path (also used when a full-colour logo is mostly black/dark).
// 3. Ids without either get no entry (UI shows the initial letter).
// Run: node desktop/scripts/build-mcp-icons.cjs
const fs = require('fs');
const path = require('path');
const { CATALOG } = require('../electron/connectors.cjs');

const SIMPLE_ICONS_VERSION = '16.38.0';
const SI_BASE = `https://cdn.jsdelivr.net/npm/simple-icons@${SIMPLE_ICONS_VERSION}`;
const ICONIFY_BASE = 'https://api.iconify.design/logos';

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

async function fetchLogoSvg(key) {
  if (PREFER_MONO.has(key)) return null;
  const slug = LOGO_SLUGS[key] || key;
  for (const candidate of [`${slug}-icon`, slug]) {
    const r = await fetch(`${ICONIFY_BASE}/${candidate}.svg`);
    if (!r.ok) continue;
    const svg = await r.text();
    if (!svg.includes('<svg')) continue;
    if (isWideWordmark(svg)) continue;
    if (isMostlyDarkSvg(svg)) continue;
    return sanitizeSvg(svg, key);
  }
  return null;
}

async function main() {
  const metaRes = await fetch(`${SI_BASE}/data/simple-icons.json`);
  if (!metaRes.ok) throw new Error(`Failed to fetch simple-icons.json: ${metaRes.status}`);
  const meta = await metaRes.json();

  const hexBySlug = new Map();
  for (const item of meta) {
    hexBySlug.set(item.slug || titleToSlug(item.title), item.hex);
  }

  const keys = [...new Set(CATALOG.map(c => c.icon || c.id))];
  const icons = {};
  let logoCount = 0;
  let siCount = 0;
  const missing = [];

  for (const key of keys) {
    const fullSvg = await fetchLogoSvg(key);
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
    missing.push(key);
  }

  const outPath = path.resolve(__dirname, '../src/lib/mcpIcons.ts');
  const header =
    `// Generated by scripts/build-mcp-icons.cjs from Iconify 'logos' + simple-icons@${SIMPLE_ICONS_VERSION}. Do not edit by hand.\n` +
    `// color '' = near-black mark, drawn in the text color.\n` +
    `export type McpIcon = { svg: string } | { d: string; color: string };\n` +
    `export const MCP_ICONS: Record<string, McpIcon> = `;
  fs.writeFileSync(outPath, `${header}${JSON.stringify(icons, null, 1)};\n`);
  console.log(`Wrote ${Object.keys(icons).length} icons (${logoCount} full-colour logos, ${siCount} simple-icons mono, ${missing.length} letter fallback).`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
