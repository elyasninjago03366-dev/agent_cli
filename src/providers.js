'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');

const DIR = path.join(os.homedir(), '.free-agent');
const CFG = path.join(DIR, 'config.json');

// All of these expose an OpenAI-compatible API and have a free tier (you only need a free key).
const BUILTIN = {
  openrouter: { label: 'OpenRouter (free models)', base: 'https://openrouter.ai/api/v1', env: 'OPENROUTER_API_KEY', signup: 'https://openrouter.ai/keys' },
  groq:       { label: 'Groq',                     base: 'https://api.groq.com/openai/v1', env: 'GROQ_API_KEY', signup: 'https://console.groq.com/keys' },
  gemini:     { label: 'Google AI Studio',         base: 'https://generativelanguage.googleapis.com/v1beta/openai', env: 'GEMINI_API_KEY', signup: 'https://aistudio.google.com/apikey' },
  cerebras:   { label: 'Cerebras',                 base: 'https://api.cerebras.ai/v1', env: 'CEREBRAS_API_KEY', signup: 'https://cloud.cerebras.ai' },
  mistral:    { label: 'Mistral (free tier)',      base: 'https://api.mistral.ai/v1', env: 'MISTRAL_API_KEY', signup: 'https://console.mistral.ai/api-keys' },
  nvidia:     { label: 'NVIDIA NIM',               base: 'https://integrate.api.nvidia.com/v1', env: 'NVIDIA_API_KEY', signup: 'https://build.nvidia.com' },
  github:     { label: 'GitHub Models',            base: 'https://models.github.ai/inference', env: 'GITHUB_MODELS_TOKEN', signup: 'https://github.com/settings/personal-access-tokens' },
  ollama:     { label: 'Ollama (local)',           base: 'http://localhost:11434/v1', nokey: true, optional: true, signup: 'https://ollama.com' },
};

function load() { try { return JSON.parse(fs.readFileSync(CFG, 'utf8')); } catch { return {}; } }
function save(c) { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(CFG, JSON.stringify(c, null, 2), { mode: 0o600 }); }
function token() {
  const f = path.join(DIR, 'token');
  try { return fs.readFileSync(f, 'utf8').trim(); } catch {
    const t = crypto.randomBytes(16).toString('hex');
    fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(f, t, { mode: 0o600 }); return t;
  }
}

function all() {
  const c = load(), out = {};
  for (const [id, b] of Object.entries(BUILTIN)) out[id] = { id, ...b, key: (c.keys || {})[id] || (b.env && process.env[b.env]) || '' };
  for (const x of c.custom || []) out[x.id] = { id: x.id, label: x.label || x.id, base: x.base.replace(/\/$/, ''), custom: true, key: x.key || '', nokey: !x.key, signup: '' };
  return out;
}
const get = (id) => all()[id];
const usable = (p) => p.nokey || p.key;

function setKey(id, key) { const c = load(); c.keys = c.keys || {}; if (key) c.keys[id] = key; else delete c.keys[id]; save(c); }
function addCustom(x) {
  const c = load(); c.custom = (c.custom || []).filter(y => y.id !== x.id);
  c.custom.push({ id: x.id, label: x.label, base: x.base, key: x.key || '' }); save(c);
}
function getLast() { return load().last || null; }
function setLast(x) { const c = load(); c.last = x; save(c); }
function removeCustom(id) { const c = load(); c.custom = (c.custom || []).filter(y => y.id !== id); save(c); }

function headers(p) {
  const h = { 'content-type': 'application/json' };
  if (p.key) h.authorization = 'Bearer ' + p.key;
  if (p.id === 'openrouter') { h['http-referer'] = 'https://github.com/free-agent'; h['x-title'] = 'Free Agent'; }
  return h;
}
const sig = (s, ms) => (AbortSignal.any && s) ? AbortSignal.any([s, AbortSignal.timeout(ms)]) : (s || AbortSignal.timeout(ms));

// Heuristic "how good is this model for agentic coding" score, used to rank the lists.
function score(id) {
  const s = id.toLowerCase(); let n = 0;
  const rules = [
    [/gpt-oss-120b/, 95], [/qwen3-coder/, 94], [/kimi-k2/, 93], [/glm-(4\.[5-9]|[5-9])/, 92],
    [/gemini-(2\.5|3)(\.\d)?-pro|gemini-3/, 91], [/deepseek-(v3|r1|chat)/, 90], [/qwen3-(235|480|next|32)/, 88],
    [/gemini-2\.5-flash(?!-lite)/, 86], [/llama-3\.3-70b|llama-4|llama-3\.1-405b/, 84], [/mistral-(large|medium)|devstral/, 83],
    [/gpt-4\.1|gpt-4o(?!-mini)|o4-mini|o3/, 85], [/gpt-oss-20b/, 78],
  ];
  for (const [r, v] of rules) if (r.test(s)) n = Math.max(n, v);
  if (!n) { const m = s.match(/(\d+)b\b/); n = 40 + Math.min(35, m ? parseInt(m[1], 10) / 4 : 10); }
  if (/coder|devstral/.test(s)) n += 3;
  if (/lite|mini|small|nano|tiny|\b[1-8]b\b/.test(s)) n -= 8;
  return Math.round(n);
}

const BAD = /embed|whisper|tts|guard|moderation|rerank|dall-e|image|audio|transcribe|ocr|speech|safety|reward|clip|vision-only|parse/i;

async function listModels(p) {
  const url = p.id === 'github' ? 'https://models.github.ai/catalog/models' : p.base + '/models';
  const r = await fetch(url, { headers: headers(p), signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (await r.text()).slice(0, 150));
  const j = await r.json();
  const rows = Array.isArray(j) ? j : (j.data || j.models || []);
  let out = rows.map(m => ({ id: String(m.id || m.name || '').replace(/^models\//, ''), m })).filter(x => x.id && !BAD.test(x.id));
  if (p.id === 'openrouter') {
    out = out.filter(({ id, m }) => (/:free$/.test(id) || (m.pricing && +m.pricing.prompt === 0 && +m.pricing.completion === 0)) && id !== 'openrouter/auto')
             .filter(({ m }) => !m.supported_parameters || m.supported_parameters.includes('tools'));
  }
  if (p.id === 'gemini') out = out.filter(x => /gemini/.test(x.id));
  return out.map(({ id }) => ({ id, score: score(id) + (/gemma/.test(id) ? -20 : 0) })).sort((a, b) => b.score - a.score);
}

let cache = null;
async function allModels(force) {
  if (!force && cache && Date.now() - cache.t < 300000) return cache.v;
  const ps = Object.values(all()).filter(usable);
  const res = await Promise.allSettled(ps.map(listModels));
  const providers = [];
  ps.forEach((p, i) => {
    const r = res[i];
    if (r.status === 'fulfilled') providers.push({ id: p.id, label: p.label, ok: true, models: r.value });
    else if (!p.optional) providers.push({ id: p.id, label: p.label, ok: false, error: String(r.reason.message || r.reason), models: [] });
  });
  const flat = providers.flatMap(p => p.models.map(m => ({ provider: p.id, ...m })));
  flat.sort((a, b) => b.score - a.score);
  const v = { providers, best: flat[0] ? { provider: flat[0].provider, id: flat[0].id } : null };
  cache = { t: Date.now(), v };
  return v;
}
const clearCache = () => { cache = null; };

async function chat(p, body, signal) {
  let last = '';
  for (let i = 0; i < 3; i++) {
    const r = await fetch(p.base + '/chat/completions', { method: 'POST', headers: headers(p), body: JSON.stringify(body), signal: sig(signal, 120000) });
    const t = await r.text();
    if (r.ok) { try { return JSON.parse(t); } catch { throw new Error('Bad JSON from provider: ' + t.slice(0, 200)); } }
    last = `HTTP ${r.status}: ${t.slice(0, 400)}`;
    if (r.status === 429 || r.status >= 500) { await new Promise(s => setTimeout(s, 1500 * (i + 1) ** 2)); continue; }
    break;
  }
  throw new Error(last);
}

module.exports = { getLast, setLast, all, get, usable, setKey, addCustom, removeCustom, allModels, clearCache, chat, token, DIR };
