#!/bin/sh
# Free Agent installer (Termux / Linux). Usage:
#   curl -fsSL https://raw.githubusercontent.com/elyasninjago03366-dev/agent_cli/main/install.sh | sh
set -e
REPO="${FA_REPO:-elyasninjago03366-dev/agent_cli}"
BRANCH="${FA_BRANCH:-main}"
APP="$HOME/.free-agent-app"

if [ -n "$TERMUX_VERSION" ] || [ -d /data/data/com.termux ]; then
  echo "==> Installing Node.js (Termux)…"
  pkg install -y nodejs curl tar >/dev/null 2>&1 || pkg install -y nodejs curl tar
fi
command -v node >/dev/null 2>&1 || { echo "Node.js 18+ is required. Install it first (Termux: pkg install nodejs)."; exit 1; }

echo "==> Downloading Free Agent…"
rm -rf "$APP.new"; mkdir -p "$APP.new"
curl -fsSL "https://github.com/$REPO/archive/refs/heads/$BRANCH.tar.gz" | tar xz --strip-components=1 -C "$APP.new"
rm -rf "$APP"; mv "$APP.new" "$APP"
chmod +x "$APP/bin/fa.js"

BIN="${PREFIX:-$HOME/.local}/bin"; mkdir -p "$BIN"
ln -sf "$APP/bin/fa.js" "$BIN/fa"
echo
echo "Installed!  Run:  fa"
echo "Then open the printed link in your browser, add a free API key in the ⚙ menu, and chat."
case ":$PATH:" in *":$BIN:"*) ;; *) echo "(add $BIN to your PATH if 'fa' is not found)";; esac
