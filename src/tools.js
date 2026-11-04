'use strict';
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');

const fn = (name, description, properties, required) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } });
const S = { type: 'string' };

const defs = [
  fn('bash', 'Run a shell command in the working directory (60s timeout). Use for running code, git, installs, searching (grep/find).', { command: S }, ['command']),
  fn('read_file', 'Read a text file. Optional 1-based line offset and line limit (default 400 lines).', { path: S, offset: { type: 'number' }, limit: { type: 'number' } }, ['path']),
  fn('write_file', 'Create or overwrite a file with the given content. Parent folders are created.', { path: S, content: S }, ['path', 'content']),
  fn('edit_file', 'Replace one exact occurrence of old_string with new_string in a file. old_string must be unique.', { path: S, old_string: S, new_string: S }, ['path', 'old_string', 'new_string']),
  fn('list_dir', 'List files and folders in a directory (default: working directory).', { path: S }, []),
];

const needsApproval = (n) => n === 'bash' || n === 'write_file' || n === 'edit_file';
const clip = (s, n = 8000) => (s.length > n ? s.slice(0, n) + `\n...[truncated ${s.length - n} chars]` : s);

function run(name, a, ctx) {
  const abs = (p) => path.resolve(ctx.cwd, p || '.');
  try {
    switch (name) {
      case 'bash': return new Promise((resolve) => {
        const c = spawn('sh', ['-c', String(a.command || '')], { cwd: ctx.cwd, env: process.env });
        let out = '';
        const add = (d) => { out += d; if (out.length > 200000) out = out.slice(-100000); };
        c.stdout.on('data', add); c.stderr.on('data', add);
        const kill = () => c.kill('SIGKILL');
        const t = setTimeout(() => { kill(); add('\n[timed out after 60s]'); }, 60000);
        ctx.signal && ctx.signal.addEventListener('abort', kill, { once: true });
        c.on('error', (e) => { clearTimeout(t); resolve('Error: ' + e.message); });
        c.on('close', (code) => { clearTimeout(t); resolve(clip(out || '(no output)') + `\n[exit ${code}]`); });
      });
      case 'read_file': {
        const lines = fs.readFileSync(abs(a.path), 'utf8').split('\n');
        const off = Math.max(1, a.offset || 1), lim = a.limit || 400;
        const part = lines.slice(off - 1, off - 1 + lim).map((l, i) => `${off + i}\t${l}`).join('\n');
        return Promise.resolve(clip(part) + (lines.length > off - 1 + lim ? `\n[file has ${lines.length} lines]` : ''));
      }
      case 'write_file': {
        const f = abs(a.path); fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, String(a.content ?? '')); return Promise.resolve(`Wrote ${f} (${String(a.content ?? '').length} chars)`);
      }
      case 'edit_file': {
        const f = abs(a.path), s = fs.readFileSync(f, 'utf8'), o = String(a.old_string ?? '');
        if (!o) return Promise.resolve('Error: old_string is empty');
        const n = s.split(o).length - 1;
        if (n === 0) return Promise.resolve('Error: old_string not found. Read the file again and copy the text exactly.');
        if (n > 1) return Promise.resolve(`Error: old_string matches ${n} places. Include more surrounding context.`);
        fs.writeFileSync(f, s.replace(o, () => String(a.new_string ?? ''))); return Promise.resolve('Edited ' + f);
      }
      case 'list_dir': {
        const d = abs(a.path);
        return Promise.resolve(fs.readdirSync(d, { withFileTypes: true }).map(e => e.name + (e.isDirectory() ? '/' : '')).join('\n') || '(empty)');
      }
      default: return Promise.resolve('Error: unknown tool ' + name);
    }
  } catch (e) { return Promise.resolve('Error: ' + e.message); }
}

module.exports = { defs, run, needsApproval, clip };
