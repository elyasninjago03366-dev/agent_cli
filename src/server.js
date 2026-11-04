'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const P = require('./providers'), { runAgent } = require('./agent');

function start({ cwd, port, host = '127.0.0.1' }) {
  const lan = host !== '127.0.0.1';
  const TOKEN = P.token();
  const sessions = new Map(), pending = new Map();
  const html = () => fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'));

  const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  const body = (req) => new Promise((ok) => { let b = ''; req.on('data', d => { b += d; if (b.length > 5e6) req.destroy(); }); req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch { ok({}); } }); });

  const server = http.createServer(async (req, res) => {
    // Only answer requests addressed to localhost (blocks DNS-rebinding) and require the token for the API.
    const host = (req.headers.host || '').split(':')[0];
    if (!lan && host !== '127.0.0.1' && host !== 'localhost') { res.writeHead(403); return res.end('forbidden'); }
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && url.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(html()); }
    if (!url.pathname.startsWith('/api/') || req.headers['x-token'] !== TOKEN) return json(res, 401, { error: 'unauthorized' });

    try {
      if (url.pathname === '/api/info') return json(res, 200, { cwd });

      if (url.pathname === '/api/config' && req.method === 'GET')
        return json(res, 200, Object.values(P.all()).map(p => ({ id: p.id, label: p.label, signup: p.signup, hasKey: !!p.key, nokey: !!p.nokey, custom: !!p.custom })));

      if (url.pathname === '/api/config' && req.method === 'POST') {
        const b = await body(req);
        if (b.custom) P.addCustom({ id: String(b.custom.id).replace(/[^\w-]/g, '').toLowerCase(), label: b.custom.label, base: String(b.custom.base).replace(/\/$/, ''), key: b.custom.key });
        else if (b.remove) P.removeCustom(b.remove);
        else if (b.id) P.setKey(b.id, String(b.key || '').trim());
        P.clearCache(); return json(res, 200, { ok: true });
      }

      if (url.pathname === '/api/models') return json(res, 200, await P.allModels(url.searchParams.get('refresh') === '1'));

      if (url.pathname === '/api/approve') { const b = await body(req); const r = pending.get(b.id); if (r) { pending.delete(b.id); r(!!b.ok); } return json(res, 200, { ok: true }); }

      if (url.pathname === '/api/reset') { const b = await body(req); sessions.delete(b.sid); return json(res, 200, { ok: true }); }

      if (url.pathname === '/api/chat') {
        const b = await body(req);
        const prov = P.get(b.provider);
        if (!prov || !P.usable(prov)) return json(res, 400, { error: 'Provider not configured' });
        const s = sessions.get(b.sid) || { messages: [] }; sessions.set(b.sid, s);
        res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-cache', 'x-accel-buffering': 'no' });
        const ac = new AbortController(), mine = new Set();
        res.on('close', () => { ac.abort(); for (const id of mine) { const r = pending.get(id); if (r) { pending.delete(id); r(false); } } });
        const emit = (e) => { if (!res.writableEnded && !res.destroyed) res.write(JSON.stringify(e) + '\n'); };
        s.messages.push({ role: 'user', content: String(b.text || '') });
        await runAgent({
          prov, model: b.model, messages: s.messages, cwd, emit, auto: !!b.auto, signal: ac.signal,
          approve: (info) => new Promise((r) => { const id = crypto.randomUUID(); pending.set(id, r); mine.add(id); emit({ type: 'approval', id, name: info.name, args: info.args }); }),
        });
        return res.end();
      }
      return json(res, 404, { error: 'not found' });
    } catch (e) { if (!res.headersSent) json(res, 500, { error: String(e.message || e) }); else res.end(); }
  });

  return new Promise((resolve, reject) => {
    let p = port;
    server.on('error', (e) => { if (e.code === 'EADDRINUSE' && p < port + 20) { p++; server.listen(p, host); } else reject(e); });
    server.on('listening', () => resolve({ port: p, url: `http://127.0.0.1:${p}/?t=${TOKEN}` }));
    server.listen(p, host);
  });
}

module.exports = { start };
