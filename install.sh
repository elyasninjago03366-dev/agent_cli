#!/bin/sh
# Free Agent installer (Termux / Linux). Usage:
#   curl -fsSL https://raw.githubusercontent.com/elyasninjago03366-dev/agent_cli/main/install.sh | sh
set -e
REPO="${FA_REPO:-elyasninjago03366-dev/agent_cli}"
BRANCH="${FA_BRANCH:-main}"
APP="$HOME/.free-agent-app"

if [ -n "$TERMUX_VERSION" ] || [ -d /data/data/com.termux ]; then
  echo "==> Installing Python (and Node.js) via pkg…"
  pkg install -y python curl tar >/dev/null 2>&1 || pkg install -y python curl tar
  pkg install -y nodejs-lts >/dev/null 2>&1 || true
fi

echo "==> Downloading Free Agent…"
rm -rf "$APP.new"; mkdir -p "$APP.new"
curl -fsSL "https://github.com/$REPO/archive/refs/heads/$BRANCH.tar.gz" | tar xz --strip-components=1 -C "$APP.new"
rm -rf "$APP"; mv "$APP.new" "$APP"
chmod +x "$APP/bin/fa.js" "$APP/fa.py"

BIN="${PREFIX:-$HOME/.local}/bin"; mkdir -p "$BIN"
rm -f "$BIN/fa"
cat > "$BIN/fa" <<'EOF'
#!/bin/sh
# Use the Python edition (terminal) by default; the web GUI ("fa gui") needs a working Node.js.
APP="$HOME/.free-agent-app"
if [ "$1" = "gui" ]; then
  exec node "$APP/bin/fa.js" "$@"
fi
if command -v python3 >/dev/null 2>&1; then exec python3 "$APP/fa.py" "$@"; fi
if command -v python >/dev/null 2>&1; then exec python "$APP/fa.py" "$@"; fi
exec node "$APP/bin/fa.js" "$@"
EOF
chmod +x "$BIN/fa"
echo
echo "Installed!  Run:  fa"
echo "It chats with the agent right in the terminal and asks for a free API key on first run."
case ":$PATH:" in *":$BIN:"*) ;; *) echo "(add $BIN to your PATH if 'fa' is not found)";; esac
