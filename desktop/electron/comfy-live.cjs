// Live progress and preview frames of a ComfyUI job, for the Outputs list. ComfyUI sends them over its websocket to the
// client id that queued the prompt (mcp-comfy logs that id with the job), so Dispatch listens as that client.

/** Parse a binary preview frame: [u32 event][...]. Event 1: [u32 format][image]; event 4: [u32 metaLen][meta json][image]. */
function previewFrame(buf) {
  if (!buf || buf.length < 8) return null;
  const event = buf.readUInt32BE(0);
  if (event === 1) { const fmt = buf.readUInt32BE(4); return { mime: fmt === 2 ? 'image/png' : 'image/jpeg', data: buf.subarray(8) }; }
  if (event === 4) {
    const len = buf.readUInt32BE(4); if (buf.length < 8 + len) return null;
    let meta = {}; try { meta = JSON.parse(buf.subarray(8, 8 + len).toString('utf8')); } catch {}
    return { mime: meta.image_type || 'image/jpeg', data: buf.subarray(8 + len), promptId: meta.prompt_id };
  }
  return null;
}

/** listen(url, clientId, onEvent) -> close(). onEvent({ id, value?, max?, node?, preview?, done? }). Reconnects while open. */
function listen(url, clientId, onEvent, { WebSocketImpl = globalThis.WebSocket, previewEveryMs = 700 } = {}) {
  let ws = null, closed = false, current = null, lastPreview = 0, retry = null;
  const connect = () => {
    if (closed || !WebSocketImpl) return;
    try { ws = new WebSocketImpl(url.replace(/^http/, 'ws').replace(/\/$/, '') + '/ws?clientId=' + encodeURIComponent(clientId)); } catch { return; }
    ws.binaryType = 'arraybuffer';
    ws.onmessage = ev => {
      if (typeof ev.data === 'string') {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        const d = m.data || {};
        if (d.prompt_id) current = d.prompt_id;
        if (m.type === 'progress' && current) onEvent({ id: current, value: d.value, max: d.max, node: d.node });
        else if (m.type === 'executing' && d.prompt_id) { if (d.node == null) onEvent({ id: d.prompt_id, done: true }); else onEvent({ id: d.prompt_id, node: d.node }); }
        else if ((m.type === 'execution_success' || m.type === 'execution_error' || m.type === 'execution_interrupted') && d.prompt_id) onEvent({ id: d.prompt_id, done: true });
        return;
      }
      const f = previewFrame(Buffer.from(ev.data));
      const id = f?.promptId || current;
      if (!f || !id || !f.data.length || Date.now() - lastPreview < previewEveryMs) return;
      lastPreview = Date.now();
      onEvent({ id, preview: `data:${f.mime};base64,${f.data.toString('base64')}` });
    };
    ws.onclose = () => { ws = null; if (!closed) retry = setTimeout(connect, 3000); };
    ws.onerror = () => {};
  };
  connect();
  return () => { closed = true; clearTimeout(retry); try { ws?.close(); } catch {} };
}
module.exports = { listen, previewFrame };
