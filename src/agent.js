'use strict';
const P = require('./providers'), T = require('./tools');

const SYS = (cwd) => `You are Free Agent, an autonomous coding agent running in a terminal (Termux on Android / ChromeOS).
Working directory: ${cwd}
Use the tools to explore, edit and run code. Read files before editing them, verify your work by running it, and keep replies short and concrete.
Prefer edit_file for small changes and write_file for new files. Never invent file contents.`;

// If a previous run was stopped mid-way, drop a dangling assistant tool_calls message.
function repair(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'assistant' && m.tool_calls) {
      const answered = messages.slice(i + 1).filter(x => x.role === 'tool').length;
      if (answered < m.tool_calls.length) messages.length = i;
      return;
    }
    if (m.role === 'user') return;
  }
}

async function runAgent({ prov, model, messages, cwd, emit, approve, auto, signal }) {
  repair(messages);
  for (let step = 0; step < 30; step++) {
    if (signal.aborted) return;
    let data;
    try {
      data = await P.chat(prov, { model, messages: [{ role: 'system', content: SYS(cwd) }, ...messages], tools: T.defs, tool_choice: 'auto' }, signal);
    } catch (e) {
      if (signal.aborted) return;
      emit({ type: 'error', message: String(e.message || e) + '\nTip: if this model does not support tools or is rate-limited, pick another one in the model menu.' });
      return;
    }
    const msg = data.choices && data.choices[0] && data.choices[0].message;
    if (!msg) { emit({ type: 'error', message: 'Empty response: ' + JSON.stringify(data).slice(0, 300) }); return; }
    const calls = msg.tool_calls && msg.tool_calls.length ? msg.tool_calls : null;
    const m = { role: 'assistant', content: msg.content || (calls ? null : '') };
    if (calls) m.tool_calls = calls;
    messages.push(m);
    if (msg.content) emit({ type: 'text', text: msg.content });
    if (!calls) { emit({ type: 'done' }); return; }

    for (const tc of calls) {
      let args = {};
      try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
      const name = tc.function.name;
      emit({ type: 'tool', name, args });
      let out;
      if (T.needsApproval(name) && !auto && !(await approve({ name, args }))) out = 'The user denied this action.';
      else out = await T.run(name, args, { cwd, signal });
      emit({ type: 'result', name, output: out.slice(0, 1500) });
      messages.push({ role: 'tool', tool_call_id: tc.id, content: T.clip(out) });
    }
  }
  emit({ type: 'error', message: 'Step limit (30) reached. Send another message to continue.' });
}

module.exports = { runAgent };
