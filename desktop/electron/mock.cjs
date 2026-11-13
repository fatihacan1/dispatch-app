// Dev-only mock workspace: fills every screen with believable data (npm run dev > rail > Mock).
const fs = require('node:fs');
const path = require('node:path');

const w = (f, d) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, d); };
const tpl = (name, description, provider, model, body, extra = '') => `---\nname: ${name}\ndescription: ${description}\nprovider: ${provider}\nmodel: ${model}\n${extra}---\n\n${body}\n`;
const ago = m => Date.now() - m * 60e3;

// A soft two-colour gradient as PNG, so Outputs has real thumbnails.
function image(nativeImage, width, height, a, b) {
  const buf = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const t = (x / width + y / height) / 2, i = (y * width + x) * 4;
    buf[i] = Math.round(a[2] + (b[2] - a[2]) * t); buf[i + 1] = Math.round(a[1] + (b[1] - a[1]) * t); buf[i + 2] = Math.round(a[0] + (b[0] - a[0]) * t); buf[i + 3] = 255;
  }
  return nativeImage.createFromBitmap(buf, { width, height }).toPNG();
}

function seed(ws, { nativeImage }) {
  // Windows may hold a handle on a watched folder for a moment; files are overwritten below anyway.
  try { fs.rmSync(ws, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
  const d = path.join(ws, '.dispatch');
  w(path.join(ws, 'README.md'), '# Daily Shorts Studio\n\nMock workspace for Dispatch development.\n');
  w(path.join(ws, 'src', 'pipeline.ts'), 'export const steps = ["script", "voice", "edit", "thumbnail", "upload"];\n');

  // Agents and a team
  w(path.join(d, 'agents', 'studio-lead.md'), tpl('studio-lead', 'Runs the daily video pipeline and leads the production team.', 'claude', 'claude-sonnet-5-5', 'Own the daily short from script to upload. Enlist writer, editor and designer as needed.'));
  w(path.join(d, 'agents', 'writer.md'), tpl('writer', 'Writes 60-second scripts in the channel voice.', 'claude', 'claude-sonnet-5-5', 'Write tight scripts with a hook in the first 3 seconds.'));
  w(path.join(d, 'agents', 'editor.md'), tpl('editor', 'Cuts video, adds captions and music.', 'codex', 'gpt-6.1-terra', 'Edit vertical 9:16 video, burn captions, normalise audio.', 'dispatch_mcp: comfyui\n'));
  w(path.join(d, 'agents', 'designer.md'), tpl('designer', 'Makes thumbnails and title cards.', 'claude', 'claude-haiku-5-5', 'Bold, readable thumbnails; three options per video.', 'dispatch_mcp: comfyui\n'));
  const snap = (name, description, provider, model) => ({ name, description, provider, model, effort: '', extra: {}, body: description });
  w(path.join(d, 'teams', 'daily-studio.json'), JSON.stringify({ name: 'Daily studio', description: 'One short video every morning.', boss: { template: 'boss', provider: '', model: '', notes: 'Upload before 10:00.' }, members: [
    { name: 'studio-lead', template: 'studio-lead', snapshot: snap('studio-lead', 'Runs the daily video pipeline', 'claude', 'claude-sonnet-5-5') },
    { name: 'writer', template: 'writer', snapshot: snap('writer', 'Writes scripts', 'claude', 'claude-sonnet-5-5') },
    { name: 'editor', template: 'editor', snapshot: snap('editor', 'Cuts video', 'codex', 'gpt-6.1-terra') },
    { name: 'designer', template: 'designer', snapshot: snap('designer', 'Makes thumbnails', 'claude', 'claude-haiku-5-5') },
  ] }, null, 2));

  // Boss memory with activity
  const ent = (name, entityType, summary, observations, extra = {}) => JSON.stringify({ type: 'entity', name, entityType, observations, summary, updatedAt: new Date(ago(Math.random() * 3000)).toISOString(), ...extra });
  w(path.join(d, 'memory', 'project.jsonl'), [
    ent('Video format', 'convention', 'Vertical 9:16, 55-60 s, captions burned in', ['Vertical 9:16 at 1080x1920', 'Length 55-60 seconds', 'Captions burned in, max 2 lines', 'Hook in the first 3 seconds'], { pinned: true }),
    ent('Upload time', 'preference', 'Upload before 10:00 local time', ['User wants the video live before 10:00', 'Weekends: 11:00 is fine']),
    ent('Thumbnail style', 'convention', 'Big face, 3 words max, yellow on dark', ['Max three words', 'Yellow text on a dark background', 'Designer makes three options, user picks']),
    ent('Music licence', 'gotcha', 'Only tracks from the /music folder are cleared', ['Two uploads were muted for unlicensed music in October', 'Use only files from /music']),
    ent('Channel', 'project', 'Tech explainers for beginners, Turkish voice-over', ['Audience: beginners', 'Voice-over in Turkish, subtitles in English']),
    JSON.stringify({ type: 'relation', from: 'Thumbnail style', to: 'Video format', relationType: 'part of' }),
    JSON.stringify({ type: 'relation', from: 'Music licence', to: 'Channel', relationType: 'applies to' }),
  ].join('\n') + '\n');
  w(path.join(d, 'memory-log.jsonl'), [
    { t: ago(90), by: 'boss', tool: 'memory_search', scope: 'project', detail: 'video format upload', ok: true, tokens: 180, results: 2 },
    { t: ago(80), by: 'boss', tool: 'memory_open', scope: 'project', detail: 'Video format', ok: true, tokens: 95, results: 1 },
    { t: ago(30), by: 'boss', tool: 'add_observations', scope: 'project', detail: 'Thumbnail style', ok: true, tokens: 40 },
    { t: ago(5), by: 'boss', tool: 'create_entities', scope: 'project', detail: 'Music licence', ok: true, tokens: 60 },
  ].map(x => JSON.stringify({ ...x, t: new Date(x.t).toISOString() })).join('\n') + '\n');

  // Skills (this workspace)
  const sk = path.join(d, 'skills');
  w(path.join(sk, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'dispatch-project', version: '1.0.0' }));
  w(path.join(sk, 'skills', 'youtube-upload', 'SKILL.md'), '---\nname: youtube-upload\ndescription: Uploads a finished short with title, tags and schedule.\n---\nSteps.');
  w(path.join(sk, 'skills', 'youtube-upload', 'upload.py'), 'print("upload")');
  w(path.join(sk, 'disabled', 'trend-scout', 'SKILL.md'), '---\nname: trend-scout\ndescription: Finds trending topics for tomorrow.\n---\nSteps.');
  w(path.join(sk, 'sources.json'), JSON.stringify({ 'youtube-upload': { kind: 'github', owner: 'example', repo: 'creator-skills', ref: 'main', sub: 'skills', skillPath: 'youtube-upload', url: 'https://github.com/example/creator-skills', installedAt: new Date(ago(2000)).toISOString() } }, null, 2));

  // Schedules: active, waiting for approval, paused
  const day = 86400e3, at = (h, m) => { const t = new Date(); t.setHours(h, m, 0, 0); return t.getTime() <= Date.now() ? t.getTime() + day : t.getTime(); };
  w(path.join(d, 'schedules.json'), JSON.stringify([
    { id: 'a1b2c3d4', title: 'Daily video', why: 'The user wants one short video live every morning', task: 'Make and upload today\'s short.', to: 'boss', by: 'boss', every: day, time: '08:00', once: 0, status: 'active', created: ago(5000), runs: 12, last: ago(600), lastNote: 'Sent to boss yesterday 08:00', next: at(8, 0) },
    { id: 'e5f6a7b8', title: 'Trend check', why: 'Pick tomorrow\'s topic from what is trending', task: 'List 5 trending beginner tech topics.', to: 'writer', by: 'studio-lead', every: day, time: '18:00', once: 0, status: 'pending', created: ago(20), runs: 0, last: 0, lastNote: '', next: at(18, 0) },
    { id: 'c9d0e1f2', title: 'Weekly stats', why: 'Weekly view count report for the user', task: 'Summarise this week\'s views and retention.', to: 'boss', by: 'boss', every: 7 * day, time: '09:00', once: 0, status: 'paused', created: ago(9000), runs: 3, last: ago(4000), lastNote: 'Paused by the user', next: at(9, 0) + 3 * day },
  ], null, 2));

  // Outputs gallery
  const out = path.join(d, 'outputs'), log = [];
  const png = (agent, file, a, b, minutes) => { const f = path.join(out, agent, file); w(f, image(nativeImage, 320, 180, a, b)); log.push({ time: ago(minutes), tool: 'agent', kind: 'file', agent, file: f, size: fs.statSync(f).size }); };
  png('designer', 'thumb-option-1.png', [255, 196, 0], [40, 40, 60], 50);
  png('designer', 'thumb-option-2.png', [255, 90, 90], [30, 30, 50], 48);
  png('designer', 'thumb-option-3.png', [80, 200, 255], [20, 20, 40], 46);
  const txt = (agent, file, text, minutes) => { const f = path.join(out, agent, file); w(f, text); log.push({ time: ago(minutes), tool: 'agent', kind: 'file', agent, file: f, size: text.length }); };
  txt('writer', 'script-2026-11-10.md', '# Why your Wi-Fi is slow\n\nHook: Your router is lying to you...\n', 70);
  txt('editor', 'final-cut.mp4', 'mock video', 12);
  log.push({ time: ago(8), tool: 'comfyui', kind: 'download', agent: 'designer', file: path.join(out, 'models', 'flux-schnell.safetensors'), bytes: 3.1e9, total: 5.2e9, done: false });
  log.push({ time: ago(3), tool: 'comfyui', kind: 'job', agent: 'designer', status: 'queued', files: [] });
  w(path.join(d, 'outputs.jsonl'), log.map(x => JSON.stringify(x)).join('\n') + '\n');
}

// Chatter for the operation log, as if the team had been working for a while.
const MESSAGES = [
  ['you', 'boss', 'Make today\'s short: why Wi-Fi gets slow at night. Upload before 10.'],
  ['boss', 'studio-lead', 'Today: "Why your Wi-Fi is slow at night". Format and music rules are in your task notes. Upload before 10:00.'],
  ['studio-lead', 'writer', 'Write a 60 s script, beginner level, hook in 3 s.'],
  ['writer', 'studio-lead', 'Script ready: outputs/writer/script-2026-11-10.md (148 words, 57 s read).'],
  ['studio-lead', 'designer', 'Three thumbnail options, max 3 words, yellow on dark.'],
  ['designer', 'studio-lead', 'Done: three options in outputs/designer.'],
  ['studio-lead', 'editor', 'Cut the video from the script and voice-over, captions burned in, music from /music only.'],
  ['editor', 'studio-lead', 'Rendering 1080x1920, 58 s. ETA 4 min.'],
  ['studio-lead', 'boss', 'Script and thumbnails done, edit rendering. On track for 09:40.'],
  ['boss', 'you', 'On track: script and thumbnails are ready, the edit is rendering. Pick a thumbnail under Outputs when you have a minute.'],
];

module.exports = { seed, MESSAGES };
