# Free Agent

A Claude-Code / Codex-style coding agent with a web GUI that runs in Termux. Zero dependencies (just Node.js).
It reads/writes files and runs shell commands in the folder you launch it from, powered by **free-tier OpenAI-compatible APIs**.

## Install (Termux)

```sh
curl -fsSL https://raw.githubusercontent.com/elyasninjago03366-dev/agent_cli/main/install.sh | sh
```

Then:

```sh
cd ~/my-project
fa
```

`fa` chats with the agent right in the terminal (no browser needed). It uses the Python edition (`fa.py`, no Node.js required), so it also works on devices where Node.js crashes. On first run it asks for a free API key.
Terminal commands: `/models` (re-check every API and list ALL AIs; `/models top` for a short list), `/model <n|name>`, `/keys`, `/auto`, `/clear`, `/exit`. Ctrl+C stops a running task.

Prefer the web GUI? It needs a working Node.js: run `fa gui` and open the printed link. If `127.0.0.1` will not open (e.g. your browser is on ChromeOS but Termux runs in the Android container), use `fa gui --host 0.0.0.0` and try one of the printed LAN links, or just use the terminal mode.
Keys can also be set with `fa set groq YOUR_KEY`.

## Free providers (free key, no payment)

| id | where to get a key |
|---|---|
| openrouter | https://openrouter.ai/keys (only `:free` models are listed) |
| groq | https://console.groq.com/keys |
| gemini | https://aistudio.google.com/apikey |
| cerebras | https://cloud.cerebras.ai |
| mistral | https://console.mistral.ai/api-keys |
| nvidia | https://build.nvidia.com |
| github | https://github.com/settings/personal-access-tokens (models:read) |
| ollama | local, no key |

You can also add any OpenAI-compatible endpoint under "Custom provider". Free tiers have rate limits and change over time.

## Using it

- **Model menu** (top bar): every model from every provider you have a key for, ranked best-first (★).
- **`/models`** (or the ↻ button): re-checks all your APIs live and prints the full list; click a model to use it.
- **`/clear`**: new conversation.
- Shell commands and file edits ask for approval unless **auto-approve** is on.
- Needs models with tool/function-calling support; if one fails, pick another.

## Security

The server binds to `127.0.0.1` only, requires a random token (stored in `~/.free-agent/token`) and checks the Host header.
API keys are stored in `~/.free-agent/config.json` (chmod 600). The agent can run commands, so keep approvals on for untrusted tasks.

## Adding your own provider

In the terminal chat type `/provider` (or press `p` in the `/keys` menu), choose `a`, then enter a name, the base URL (the one ending in `/v1`) and the API key. It checks the connection and lists the models it finds. If an API can't list its models, set one by hand with `/model name:model-id`.

## Updating

Run the install command again; it replaces the app and keeps your keys.
