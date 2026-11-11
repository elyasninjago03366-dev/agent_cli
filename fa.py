#!/usr/bin/env python3
"""Free Agent (Python edition): terminal coding agent using free OpenAI-compatible APIs. Standard library only."""
import json, os, re, subprocess, sys, urllib.request, urllib.error, concurrent.futures as cf
try:
    import readline  # noqa: F401  (line editing / history)
except Exception:
    pass

DIR = os.path.join(os.path.expanduser('~'), '.free-agent')
CFG = os.path.join(DIR, 'config.json')
BUILTIN = {
    'openrouter': dict(label='OpenRouter (free models)', base='https://openrouter.ai/api/v1', env='OPENROUTER_API_KEY', signup='https://openrouter.ai/keys'),
    'groq': dict(label='Groq', base='https://api.groq.com/openai/v1', env='GROQ_API_KEY', signup='https://console.groq.com/keys'),
    'gemini': dict(label='Google AI Studio', base='https://generativelanguage.googleapis.com/v1beta/openai', env='GEMINI_API_KEY', signup='https://aistudio.google.com/apikey'),
    'cerebras': dict(label='Cerebras', base='https://api.cerebras.ai/v1', env='CEREBRAS_API_KEY', signup='https://cloud.cerebras.ai'),
    'mistral': dict(label='Mistral (free tier)', base='https://api.mistral.ai/v1', env='MISTRAL_API_KEY', signup='https://console.mistral.ai/api-keys'),
    'nvidia': dict(label='NVIDIA NIM', base='https://integrate.api.nvidia.com/v1', env='NVIDIA_API_KEY', signup='https://build.nvidia.com'),
    'github': dict(label='GitHub Models', base='https://models.github.ai/inference', env='GITHUB_MODELS_TOKEN', signup='https://github.com/settings/personal-access-tokens'),
    'ollama': dict(label='Ollama (local)', base='http://localhost:11434/v1', nokey=True, optional=True, signup='https://ollama.com'),
}


def c(n):
    return lambda s: f'\x1b[{n}m{s}\x1b[0m'


dim, bold, cy, gr, rd, yl = c(2), c(1), c(36), c(32), c(31), c(33)


# ---------- config ----------
def load():
    try:
        with open(CFG) as f:
            return json.load(f)
    except Exception:
        return {}


def save(cfg):
    os.makedirs(DIR, exist_ok=True)
    with open(CFG, 'w') as f:
        json.dump(cfg, f, indent=2)
    try:
        os.chmod(CFG, 0o600)
    except Exception:
        pass


def providers():
    cfg, out = load(), {}
    for pid, b in BUILTIN.items():
        out[pid] = dict(b, id=pid, key=(cfg.get('keys') or {}).get(pid) or os.environ.get(b.get('env', ''), ''))
    for x in cfg.get('custom') or []:
        out[x['id']] = dict(id=x['id'], label=x.get('label', x['id']), base=x['base'].rstrip('/'), custom=True, key=x.get('key', ''), nokey=not x.get('key'), signup='')
    return out


def usable(p):
    return p.get('nokey') or p.get('key')


def set_key(pid, key):
    cfg = load()
    cfg.setdefault('keys', {})[pid] = key
    save(cfg)


# ---------- http / models ----------
def http(url, p=None, body=None, timeout=20):
    h = {'user-agent': 'free-agent/1.0', 'content-type': 'application/json'}
    if p and p.get('key'):
        h['authorization'] = 'Bearer ' + p['key']
    if p and p['id'] == 'openrouter':
        h['x-title'] = 'Free Agent'
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, headers=h, method='POST' if body is not None else 'GET')
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'replace')


def score(mid):
    s, n = mid.lower(), 0
    rules = [(r'gpt-oss-120b', 95), (r'qwen3-coder', 94), (r'kimi-k2', 93), (r'glm-(4\.[5-9]|[5-9])', 92),
             (r'gemini-(2\.5|3)(\.\d)?-pro|gemini-3', 91), (r'deepseek-(v3|r1|chat)', 90), (r'qwen3-(235|480|next|32)', 88),
             (r'gemini-2\.5-flash(?!-lite)', 86), (r'llama-3\.3-70b|llama-4|llama-3\.1-405b', 84), (r'mistral-(large|medium)|devstral', 83),
             (r'gpt-4\.1|gpt-4o(?!-mini)|o4-mini|o3', 85), (r'gpt-oss-20b', 78)]
    for r, v in rules:
        if re.search(r, s):
            n = max(n, v)
    if not n:
        m = re.search(r'(\d+)b\b', s)
        n = 40 + min(35, int(m.group(1)) / 4 if m else 10)
    if re.search(r'coder|devstral', s):
        n += 3
    if re.search(r'lite|mini|small|nano|tiny|\b[1-8]b\b', s):
        n -= 8
    if 'gemma' in s:
        n -= 20
    return round(n)


BAD = re.compile(r'embed|whisper|tts|guard|moderation|rerank|dall-e|image|audio|transcribe|ocr|speech|safety|reward|clip|vision-only|parse', re.I)


def list_models(p):
    url = 'https://models.github.ai/catalog/models' if p['id'] == 'github' else p['base'] + '/models'
    import time
    st = txt = None
    for attempt in range(3):  # slow/filtered networks often time out on the first TLS handshake
        try:
            st, txt = http(url, p, timeout=30)
            break
        except Exception as e:
            if attempt == 2:
                raise RuntimeError(f'network problem reaching {p["base"]}: {e}')
            time.sleep(2)
    if st != 200:
        raise RuntimeError(f'HTTP {st} {txt[:150]}')
    j = json.loads(txt)
    rows = j if isinstance(j, list) else (j.get('data') or j.get('models') or [])
    out = []
    for m in rows:
        mid = re.sub(r'^models/', '', str(m.get('id') or m.get('name') or ''))
        if not mid or BAD.search(mid):
            continue
        if p['id'] == 'openrouter':
            pr = m.get('pricing') or {}
            free = mid.endswith(':free') or (pr and float(pr.get('prompt', 1)) == 0 and float(pr.get('completion', 1)) == 0)
            sp = m.get('supported_parameters')
            if not free or mid == 'openrouter/auto' or (sp is not None and 'tools' not in sp):
                continue
        if p['id'] == 'gemini' and 'gemini' not in mid:
            continue
        out.append(dict(id=mid, score=score(mid)))
    return sorted(out, key=lambda x: -x['score'])


def all_models():
    ps = [p for p in providers().values() if usable(p)]
    res = []
    with cf.ThreadPoolExecutor(max_workers=8) as ex:
        futs = [(p, ex.submit(list_models, p)) for p in ps]
        for p, f in futs:
            try:
                res.append(dict(id=p['id'], label=p['label'], ok=True, models=f.result()))
            except Exception as e:
                if not p.get('optional'):
                    res.append(dict(id=p['id'], label=p['label'], ok=False, error=str(e), models=[]))
    flat = [dict(provider=p['id'], **m) for p in res for m in p['models']]
    flat.sort(key=lambda m: -m['score'])
    return res, flat


def chat(p, body):
    import time
    last = ''
    for i in range(3):
        st, txt = http(p['base'] + '/chat/completions', p, body, timeout=120)
        if st == 200:
            return json.loads(txt)
        last = f'HTTP {st}: {txt[:400]}'
        if st == 429 or st >= 500:
            time.sleep(1.5 * (i + 1) ** 2)
            continue
        break
    raise RuntimeError(last)


# ---------- tools ----------
def fn(name, desc, props, req):
    return {'type': 'function', 'function': {'name': name, 'description': desc, 'parameters': {'type': 'object', 'properties': props, 'required': req}}}


S = {'type': 'string'}
TOOLS = [
    fn('bash', 'Run a shell command in the working directory (60s timeout).', {'command': S}, ['command']),
    fn('read_file', 'Read a text file. Optional 1-based line offset and line limit (default 400).', {'path': S, 'offset': {'type': 'number'}, 'limit': {'type': 'number'}}, ['path']),
    fn('write_file', 'Create or overwrite a file. Parent folders are created.', {'path': S, 'content': S}, ['path', 'content']),
    fn('edit_file', 'Replace one exact, unique occurrence of old_string with new_string in a file.', {'path': S, 'old_string': S, 'new_string': S}, ['path', 'old_string', 'new_string']),
    fn('list_dir', 'List files and folders in a directory (default: working directory).', {'path': S}, []),
]


def clip(s, n=8000):
    return s if len(s) <= n else s[:n] + f'\n...[truncated {len(s) - n} chars]'


def run_tool(name, a, cwd):
    ab = lambda p: os.path.normpath(os.path.join(cwd, p or '.'))
    try:
        if name == 'bash':
            try:
                r = subprocess.run(['sh', '-c', str(a.get('command', ''))], cwd=cwd, capture_output=True, text=True, timeout=60, errors='replace')
                return clip((r.stdout + r.stderr) or '(no output)') + f'\n[exit {r.returncode}]'
            except subprocess.TimeoutExpired as e:
                return clip(((e.stdout or b'').decode('utf-8', 'replace') if isinstance(e.stdout, bytes) else (e.stdout or ''))) + '\n[timed out after 60s]'
        if name == 'read_file':
            with open(ab(a['path']), encoding='utf-8', errors='replace') as f:
                lines = f.read().split('\n')
            off, lim = max(1, int(a.get('offset') or 1)), int(a.get('limit') or 400)
            part = '\n'.join(f'{off + i}\t{l}' for i, l in enumerate(lines[off - 1:off - 1 + lim]))
            return clip(part) + (f'\n[file has {len(lines)} lines]' if len(lines) > off - 1 + lim else '')
        if name == 'write_file':
            f = ab(a['path'])
            os.makedirs(os.path.dirname(f), exist_ok=True)
            with open(f, 'w', encoding='utf-8') as fh:
                fh.write(str(a.get('content', '')))
            return f'Wrote {f} ({len(str(a.get("content", "")))} chars)'
        if name == 'edit_file':
            f = ab(a['path'])
            with open(f, encoding='utf-8') as fh:
                s = fh.read()
            o = str(a.get('old_string', ''))
            if not o:
                return 'Error: old_string is empty'
            n = s.count(o)
            if n == 0:
                return 'Error: old_string not found. Read the file again and copy the text exactly.'
            if n > 1:
                return f'Error: old_string matches {n} places. Include more surrounding context.'
            with open(f, 'w', encoding='utf-8') as fh:
                fh.write(s.replace(o, str(a.get('new_string', '')), 1))
            return 'Edited ' + f
        if name == 'list_dir':
            d = ab(a.get('path'))
            return '\n'.join(e + ('/' if os.path.isdir(os.path.join(d, e)) else '') for e in sorted(os.listdir(d))) or '(empty)'
        return 'Error: unknown tool ' + name
    except Exception as e:
        return 'Error: ' + str(e)


# ---------- agent ----------
def system_prompt(cwd):
    return (f'You are Free Agent, an autonomous coding agent running in a terminal (Termux on Android / ChromeOS).\nWorking directory: {cwd}\n'
            'Use the tools to explore, edit and run code. Read files before editing them, verify your work by running it, and keep replies short and concrete.\n'
            'Prefer edit_file for small changes and write_file for new files. Never invent file contents.')


def repair(messages):
    for i in range(len(messages) - 1, -1, -1):
        m = messages[i]
        if m['role'] == 'assistant' and m.get('tool_calls'):
            if sum(1 for x in messages[i + 1:] if x['role'] == 'tool') < len(m['tool_calls']):
                del messages[i:]
            return
        if m['role'] == 'user':
            return


def run_agent(state):
    p, model, messages, cwd = state['prov'], state['model'], state['messages'], state['cwd']
    repair(messages)
    for _ in range(30):
        try:
            data = chat(p, {'model': model, 'messages': [{'role': 'system', 'content': system_prompt(cwd)}] + messages, 'tools': TOOLS, 'tool_choice': 'auto'})
        except Exception as e:
            print(rd(f'\n✗ {e}\nTip: if this model does not support tools or is rate-limited, pick another with /model.'))
            return
        try:
            msg = data['choices'][0]['message']
        except Exception:
            print(rd('\n✗ Empty response: ' + json.dumps(data)[:300]))
            return
        calls = msg.get('tool_calls') or None
        m = {'role': 'assistant', 'content': msg.get('content') or (None if calls else '')}
        if calls:
            m['tool_calls'] = calls
        messages.append(m)
        if msg.get('content'):
            print('\n' + msg['content'])
        if not calls:
            return
        for tc in calls:
            try:
                args = json.loads(tc['function'].get('arguments') or '{}')
            except Exception:
                args = {}
            name = tc['function']['name']
            print(cy('\n⚙ ' + name) + ' ' + dim(args.get('command') if name == 'bash' else str(args.get('path', ''))))
            ok = True
            if name in ('bash', 'write_file', 'edit_file') and not state['auto']:
                what = args.get('command') if name == 'bash' else (f"{args.get('path')}\n  - {str(args.get('old_string'))[:200]}\n  + {str(args.get('new_string'))[:200]}" if name == 'edit_file' else f"{args.get('path')} ({len(str(args.get('content', '')))} chars)")
                print(yl('\n🔒 allow ' + name + '?') + '\n' + dim(str(what)))
                a = (input('[y]es / [n]o / [a]lways> ') or 'n').strip().lower()
                if a.startswith('a'):
                    state['auto'] = True
                    print(dim('auto-approve on (/auto to toggle)'))
                ok = a[:1] in ('y', 'a')
            out = run_tool(name, args, cwd) if ok else 'The user denied this action.'
            o = '\n'.join(out.split('\n')[:8])
            print(dim(o[:600] + ('…' if len(o) > 600 else '')))
            messages.append({'role': 'tool', 'tool_call_id': tc.get('id'), 'content': clip(out)})
    print(rd('\n✗ Step limit (30) reached. Send another message to continue.'))


# ---------- cli ----------
def add_keys():
    lst = [p for p in providers().values() if not p.get('nokey')]
    while True:
        print('\n' + bold('Add a free API key') + dim('  (blank = done, p = add your own provider with a base URL)'))
        for i, p in enumerate(lst, 1):
            print(f"  {i}. {p['label']:<26} {gr('✓ saved') if p['key'] else dim(p['signup'])}")
        try:
            n = input('provider number> ').strip()
        except EOFError:
            return
        if not n:
            return
        if n.lower() == 'p':
            manage_providers()
            lst = [q for q in providers().values() if not q.get('nokey') or q.get('custom')]
            lst = [q for q in lst if not q.get('custom')]
            continue
        if not n.isdigit() or not 1 <= int(n) <= len(lst):
            print(rd('invalid number'))
            continue
        p = lst[int(n) - 1]
        print(dim('Get a free key at: ' + p['signup']))
        k = input(p['id'] + ' key> ').strip()
        if k:
            set_key(p['id'], k)
            lst = [q for q in providers().values() if not q.get('nokey')]
            print(gr('saved ✓'))


def manage_providers():
    """Add / remove custom OpenAI-compatible providers (name + base URL + key) by hand."""
    while True:
        cfg = load()
        custom = cfg.get('custom') or []
        print('\n' + bold('Custom providers') + dim('  (any OpenAI-compatible API)'))
        if custom:
            for i, x in enumerate(custom, 1):
                print(f"  {i}. {x['label']:<20} {dim(x['base'])}  {gr('key ✓') if x.get('key') else dim('no key')}")
        else:
            print(dim('  none yet'))
        print('\n  a = add new   r = remove   (blank = done)')
        try:
            ch = input('provider> ').strip().lower()
        except EOFError:
            return
        if not ch:
            return
        if ch == 'a':
            name = input('name (e.g. myhost)> ').strip()
            base = input('base URL (e.g. https://api.example.com/v1)> ').strip().rstrip('/')
            if not name or not base:
                print(rd('name and base URL are required'))
                continue
            if not re.match(r'^https?://', base):
                base = 'https://' + base
            if base.endswith('/chat/completions'):
                base = base[:-len('/chat/completions')]
            key = input('API key (blank if none)> ').strip()
            pid = re.sub(r'[^\w-]', '', name).lower() or 'custom'
            if pid in BUILTIN:
                pid += '-custom'
            custom = [x for x in custom if x['id'] != pid]
            custom.append({'id': pid, 'label': name, 'base': base, 'key': key})
            cfg['custom'] = custom
            save(cfg)
            print(gr(f'saved ✓ "{name}"') + dim(' — checking it…'))
            try:
                ms = list_models(dict(id=pid, label=name, base=base, key=key))
                print(gr(f'works: {len(ms)} models found'))
            except Exception as e:
                print(yl(f'saved, but the model list failed: {str(e)[:150]}'))
                print(dim('check the base URL (it usually ends in /v1) and the key; if the API lists no models, set one by hand: /model ' + pid + ':<model-name>'))
        elif ch == 'r':
            if not custom:
                continue
            n = input('number to remove> ').strip()
            if n.isdigit() and 1 <= int(n) <= len(custom):
                gone = custom.pop(int(n) - 1)
                cfg['custom'] = custom
                save(cfg)
                print(gr('removed ') + gone['label'])
            else:
                print(rd('invalid number'))


def show(res, cur, everything):
    if not res:
        return print('No providers with keys yet. Use /keys')
    n = 0
    for p in res:
        if not p['ok']:
            print('\n' + bold(p['label']) + ' ' + rd('✗ ' + p['error'][:120]))
            continue
        print('\n' + bold(p['label']) + dim(f" ({len(p['models'])})"))
        for i, m in enumerate(p['models']):
            n += 1
            if not everything and i >= 15:
                continue
            here = cur and cur['provider'] == p['id'] and cur['model'] == m['id']
            print(f"  {n:>3}. {yl('★') if i < 2 else ' '} {gr(m['id'] + '  ← current') if here else m['id']}")
        if not everything and len(p['models']) > 15:
            print(dim(f"       … {len(p['models']) - 15} more (use /models all)"))
    print(dim('\nPick with /model <number> or /model <part of name>.  ★ = best ranked'))


def main():
    a = sys.argv[1:]
    cwd = os.getcwd()
    if '--dir' in a:
        cwd = os.path.abspath(a[a.index('--dir') + 1])
    if a[:1] == ['set'] and len(a) >= 3:
        set_key(a[1], a[2])
        return print('saved key for ' + a[1])
    if a[:1] in (['help'], ['--help'], ['-h']):
        return print('fa.py: chat in the terminal.  fa set <provider> <key> | fa --dir PATH')
    print('\n' + bold('Free Agent') + dim('  folder: ' + cwd))

    def refresh():
        print(dim('checking models in all your APIs… '), end='', flush=True)
        res, flat = all_models()
        print(dim(f"{len(flat)} models from {sum(1 for p in res if p['ok'])} provider(s)"))
        return res, flat

    res, flat = refresh()
    if not res:
        print(yl('\nNo API keys yet — add at least one free key.'))
        add_keys()
        res, flat = refresh()
    last = load().get('last')
    cur = last if last and any(m['provider'] == last['provider'] and m['id'] == last['model'] for m in flat) else ({'provider': flat[0]['provider'], 'model': flat[0]['id']} if flat else None)
    print(dim('Type a task, or /help.  Current model: ') + (gr(f"{cur['provider']}/{cur['model']}") if cur else rd('none (use /keys)')))
    state = {'auto': False, 'messages': [], 'cwd': cwd}
    last_int = 0

    def choose(arg):
        nonlocal cur
        if ':' in arg and arg.split(':', 1)[0] in providers() and arg.split(':', 1)[1]:
            pid, mid = arg.split(':', 1)
            cur = {'provider': pid, 'model': mid}
            cfg = load()
            cfg['last'] = cur
            save(cfg)
            return print(gr('model → ') + f'{pid}/{mid}')
        m = flat[int(arg) - 1] if arg.isdigit() and 0 < int(arg) <= len(flat) else next((x for x in flat if arg.lower() in x['id'].lower()), None)
        if not m:
            return print(rd('no such model — try /models'))
        cur = {'provider': m['provider'], 'model': m['id']}
        cfg = load()
        cfg['last'] = cur
        save(cfg)
        print(gr('model → ') + f"{m['provider']}/{m['id']}")

    while True:
        try:
            label = (cur['model'].split('/')[-1][:24] if cur else 'no-model')
            text = input(bold(cy(label + ' ❯ '))).strip()
        except EOFError:
            break
        except KeyboardInterrupt:
            now = __import__('time').time()
            if now - last_int < 2:
                print()
                break
            last_int = now
            print(dim('\n(press Ctrl+C again or type /exit to quit)'))
            continue
        if not text:
            continue
        if text in ('/exit', '/quit'):
            break
        if text == '/help':
            print(f"""
  /models [all]   re-check every API and list all available AIs
  /model <n|name> switch model (number from /models, or part of its name)
                  or type one yourself: /model provider:model-name
  /keys           add or change API keys
  /provider       add your own provider (name + base URL + key), or remove one
  /auto           toggle auto-approve (now: {'on' if state['auto'] else 'off'})
  /clear          start a new conversation
  /exit           quit        (Ctrl+C stops a running task)""")
        elif text in ('/models', '/models all'):
            res, flat = refresh()
            show(res, cur, text.endswith('all'))
        elif text == '/model':
            show(res, cur, False)
        elif text.startswith('/model '):
            choose(text[7:].strip())
        elif text == '/provider':
            manage_providers()
            res, flat = refresh()
            if not cur and flat:
                cur = {'provider': flat[0]['provider'], 'model': flat[0]['id']}
        elif text == '/keys':
            add_keys()
            res, flat = refresh()
            if not cur and flat:
                cur = {'provider': flat[0]['provider'], 'model': flat[0]['id']}
        elif text == '/auto':
            state['auto'] = not state['auto']
            print('auto-approve ' + ('ON' if state['auto'] else 'off'))
        elif text == '/clear':
            state['messages'] = []
            print(dim('conversation cleared'))
        elif text.startswith('/'):
            print(rd('unknown command — /help'))
        elif not cur:
            print(rd('No model selected. Use /keys to add a free API key.'))
        else:
            state.update(prov=providers()[cur['provider']], model=cur['model'])
            state['messages'].append({'role': 'user', 'content': text})
            try:
                run_agent(state)
            except KeyboardInterrupt:
                print(yl('\n^C stopped'))
            print()


if __name__ == '__main__':
    main()
