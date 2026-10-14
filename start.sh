#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
/usr/bin/time -p pwd
PROJECT_DIR="$(pwd)"
PORT="${PORT:-3000}"
OPENCODE_WEB_DIR="${OPENCODE_WEB_DIR:-/home/runner/work/_temp/omgithub-web}"
DIST="$PROJECT_DIR/dist"
SRC_HTML="$PROJECT_DIR/undertale-port/index.html"
/usr/bin/time -p mkdir -p "$DIST" "$OPENCODE_WEB_DIR"
if [[ -f "$PROJECT_DIR/package.json" ]]; then
  if [[ -f "$PROJECT_DIR/package-lock.json" ]]; then
    /usr/bin/time -p npm ci --no-audit --no-fund
  else
    /usr/bin/time -p npm install --no-audit --no-fund
  fi
  /usr/bin/time -p npm run --silent build --if-present
fi
if [[ -f "$SRC_HTML" ]]; then
  /usr/bin/time -p cp -f "$SRC_HTML" "$DIST/index.html"
elif [[ -f "$PROJECT_DIR/index.html" ]]; then
  /usr/bin/time -p cp -f "$PROJECT_DIR/index.html" "$DIST/index.html"
fi
/usr/bin/time -p test -f "$DIST/index.html"
/usr/bin/time -p python3 -c "import json,sys; json.dump({'project':sys.argv[1],'directory':sys.argv[2]}, open(sys.argv[3],'w'))" "$PROJECT_DIR" "$DIST" "$OPENCODE_WEB_DIR/deployment-output.json"
/usr/bin/time -p cat "$OPENCODE_WEB_DIR/deployment-output.json"
echo "Serving $DIST on port $PORT (foreground)"
exec /usr/bin/time -p python3 -m http.server "$PORT" --directory "$DIST"
