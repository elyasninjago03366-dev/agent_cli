#!/usr/bin/env node
'use strict';
const path = require('path'), os = require('os'), { spawn } = require('child_process');
const P = require('../src/providers');

const a = process.argv.slice(2);
const opt = (n, d) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : d; };
const cwd = path.resolve(opt('--dir', process.cwd()));

if (a[0] === 'help' || a[0] === '--help' || a[0] === '-h') {
  console.log(`fa - Free Agent
  fa                       chat with the agent right in the terminal (default)
  fa gui                   start the web GUI instead (prints a link)
  fa gui --host 0.0.0.0    web GUI reachable from other devices/containers (prints LAN links)
  fa --dir PATH            work in PATH instead of the current folder
  fa set <provider> <key>  save an API key (openrouter, groq, gemini, cerebras, mistral, nvidia, github)
  fa providers             show which providers have keys`);
  process.exit(0);
}
if (a[0] === 'set') {
  if (!P.get(a[1]) || !a[2]) { console.log('usage: fa set <provider> <key>\nproviders: ' + Object.keys(P.all()).join(', ')); process.exit(1); }
  P.setKey(a[1], a[2]); console.log('saved key for ' + a[1]); process.exit(0);
}
if (a[0] === 'providers') {
  for (const p of Object.values(P.all())) console.log((p.key || p.nokey ? '[x] ' : '[ ] ') + p.id.padEnd(11) + (p.signup || ''));
  process.exit(0);
}

if (a[0] === 'gui') {
  const { start } = require('../src/server');
  const host = opt('--host', '127.0.0.1');
  start({ cwd, host, port: parseInt(opt('--port', '8787'), 10) }).then(({ port, url }) => {
    console.log('\n  Free Agent GUI is running\n  folder: ' + cwd + '\n  open:   ' + url);
    if (host !== '127.0.0.1') {
      const tok = url.split('?t=')[1];
      for (const list of Object.values(os.networkInterfaces())) for (const i of list) if (i.family === 'IPv4' && !i.internal) console.log(`  or:     http://${i.address}:${port}/?t=${tok}`);
    }
    console.log('\n  Tip: if the link will not open, use the terminal mode instead: just run  fa\n  (Ctrl+C to stop)\n');
    try { const p = spawn('termux-open-url', [url], { stdio: 'ignore', detached: true }); p.on('error', () => {}); p.unref(); } catch {}
  }).catch((e) => { console.error(e.message); process.exit(1); });
} else {
  require('../src/cli').main({ cwd }).catch((e) => { console.error(e.message); process.exit(1); });
}
