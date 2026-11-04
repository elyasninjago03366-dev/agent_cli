'use strict';
const readline = require('readline');
const P = require('./providers'), { runAgent } = require('./agent');

const col = (n) => (s) => `\x1b[${n}m${s}\x1b[0m`;
const dim = col(2), bold = col(1), cy = col(36), gr = col(32), rd = col(31), yl = col(33);

async function main({ cwd }) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
  const q = [], waiters = []; let closed = false;
  rl.on('line', (l) => (waiters.length ? waiters.shift()(l) : q.push(l)));
  rl.on('close', () => { closed = true; waiters.splice(0).forEach((w) => w(null)); });
  const next = () => (q.length ? Promise.resolve(q.shift()) : closed ? Promise.resolve(null) : new Promise((r) => waiters.push(r)));
  const ask = async (p) => { rl.setPrompt(p); rl.prompt(); return next(); };

  let running = null, auto = false, cur = null, flat = [], D = null, lastSigint = 0;
  const messages = [];
  rl.on('SIGINT', () => {
    if (running) { running.abort(); console.log(yl('\n^C stopped')); return; }
    if (Date.now() - lastSigint < 2000) { console.log(); process.exit(0); }
    lastSigint = Date.now(); console.log(dim('\n(press Ctrl+C again or type /exit to quit)')); rl.prompt();
  });

  async function addKeys() {
    const list = Object.values(P.all()).filter((p) => !p.nokey);
    for (;;) {
      console.log('\n' + bold('Add a free API key') + dim('  (blank = done)'));
      list.forEach((p, i) => console.log(`  ${i + 1}. ${p.label.padEnd(26)} ${p.key ? gr('✓ saved') : dim(p.signup)}`));
      const n = await ask('provider number> '); if (n === null || !n.trim()) return;
      const p = list[parseInt(n, 10) - 1]; if (!p) { console.log(rd('invalid number')); continue; }
      console.log(dim('Get a free key at: ' + p.signup));
      const k = await ask(p.id + ' key> '); if (k === null) return;
      if (k.trim()) { P.setKey(p.id, k.trim()); console.log(gr('saved ✓')); }
    }
  }

  async function loadModels(force) {
    process.stdout.write(dim('checking models in all your APIs… '));
    D = await P.allModels(force);
    flat = D.providers.flatMap((p) => p.models.map((m) => ({ provider: p.id, label: p.label, ...m })));
    console.log(dim(`${flat.length} models from ${D.providers.filter((p) => p.ok).length} provider(s)`));
    return D;
  }

  function show(all) {
    if (!D || !D.providers.length) return console.log('No providers with keys yet. Use /keys');
    let n = 0;
    for (const p of D.providers) {
      if (!p.ok) { console.log('\n' + bold(p.label) + ' ' + rd('✗ ' + p.error.slice(0, 120))); continue; }
      console.log('\n' + bold(p.label) + dim(` (${p.models.length})`));
      p.models.forEach((m, i) => {
        n++;
        if (!all && i >= 15) return;
        const here = cur && cur.provider === p.id && cur.model === m.id;
        console.log(`  ${String(n).padStart(3)}. ${i < 2 ? yl('★') : ' '} ${here ? gr(m.id + '  ← current') : m.id}`);
      });
      if (!all && p.models.length > 15) console.log(dim(`       … ${p.models.length - 15} more (use /models all)`));
    }
    console.log(dim('\nPick with /model <number> or /model <part of name>.  ★ = best ranked'));
  }

  function choose(arg) {
    let m = null;
    if (/^\d+$/.test(arg)) m = flat[parseInt(arg, 10) - 1];
    else m = flat.find((x) => x.id.toLowerCase().includes(arg.toLowerCase()));
    if (!m) return console.log(rd('no such model — try /models'));
    cur = { provider: m.provider, model: m.id }; P.setLast(cur);
    console.log(gr('model → ') + `${m.provider}/${m.id}`);
  }

  function emit(e) {
    if (e.type === 'text') console.log('\n' + e.text);
    else if (e.type === 'tool') { const a = e.args || {}; console.log(cy('\n⚙ ' + e.name) + ' ' + dim(e.name === 'bash' ? a.command : (a.path || ''))); }
    else if (e.type === 'result') { const o = e.output.split('\n').slice(0, 8).join('\n'); console.log(dim(o.length > 600 ? o.slice(0, 600) + '…' : o)); }
    else if (e.type === 'error') console.log(rd('\n✗ ' + e.message));
  }

  async function approve({ name, args }) {
    const what = name === 'bash' ? args.command : name === 'edit_file' ? `${args.path}\n  - ${String(args.old_string).slice(0, 200)}\n  + ${String(args.new_string).slice(0, 200)}` : `${args.path} (${String(args.content || '').length} chars)`;
    console.log(yl('\n🔒 allow ' + name + '?') + '\n' + dim(what));
    const a = ((await ask('[y]es / [n]o / [a]lways> ')) || 'n').trim().toLowerCase();
    if (a.startsWith('a')) { auto = true; console.log(dim('auto-approve on (/auto to toggle)')); return true; }
    return a.startsWith('y');
  }

  console.log('\n' + bold('Free Agent') + dim('  folder: ' + cwd));
  await loadModels(false);
  if (!D.providers.length) { console.log(yl('\nNo API keys yet — add at least one free key.')); await addKeys(); await loadModels(true); }
  const last = P.getLast();
  cur = last && flat.find((m) => m.provider === last.provider && m.id === last.model) ? last : D.best ? { provider: D.best.provider, model: D.best.id } : null;
  console.log(dim('Type a task, or /help.  Current model: ') + (cur ? gr(cur.provider + '/' + cur.model) : rd('none (use /keys)')));

  for (;;) {
    const line = await ask(bold(cy((cur ? cur.model.split('/').pop().slice(0, 24) : 'no-model') + ' ❯ ')));
    if (line === null) break;
    const text = line.trim(); if (!text) continue;
    if (text === '/exit' || text === '/quit') break;
    if (text === '/help') { console.log(`
  /models [all]   re-check every API and list all available AIs
  /model <n|name> switch model (number from /models, or part of its name)
  /keys           add or change API keys
  /auto           toggle auto-approve for commands and edits (now: ${auto ? 'on' : 'off'})
  /clear          start a new conversation
  /exit           quit        (Ctrl+C stops a running task)`); continue; }
    if (text === '/models' || text === '/models all') { await loadModels(true); show(text.endsWith('all')); continue; }
    if (text === '/model') { if (!flat.length) await loadModels(false); show(false); continue; }
    if (text.startsWith('/model ')) { if (!flat.length) await loadModels(false); choose(text.slice(7).trim()); continue; }
    if (text === '/keys') { await addKeys(); await loadModels(true); if (!cur && D.best) { cur = { provider: D.best.provider, model: D.best.id }; P.setLast(cur); } continue; }
    if (text === '/auto') { auto = !auto; console.log('auto-approve ' + (auto ? 'ON' : 'off')); continue; }
    if (text === '/clear') { messages.length = 0; console.log(dim('conversation cleared')); continue; }
    if (text.startsWith('/')) { console.log(rd('unknown command — /help')); continue; }
    if (!cur) { console.log(rd('No model selected. Use /keys to add a free API key.')); continue; }
    const prov = P.get(cur.provider);
    messages.push({ role: 'user', content: text });
    running = new AbortController();
    await runAgent({ prov, model: cur.model, messages, cwd, emit, approve, auto, signal: running.signal });
    running = null; console.log();
  }
  rl.close(); process.exit(0);
}

module.exports = { main };
