#!/bin/bash
# start-all.sh — Build and start all RM Buddy services via PM2
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
echo "Starting RM Buddy from: $ROOT"

# ── Node.js services ────────────────────────────────────────────────────────
for svc in gateway auth-service core-api communication-service; do
  dir="$ROOT/apps/$svc"
  echo ""
  echo "→ $svc"
  cd "$dir"
  if [ -f "tsconfig.json" ] && [ -f "package.json" ]; then
    npm run build --if-present 2>/dev/null || echo "  [skip] no build script"
  fi
  pm2 start ecosystem.config.js --env production 2>/dev/null || \
    pm2 restart "$(node -e "const c=require('./ecosystem.config.js'); console.log(c.apps[0].name)" 2>/dev/null)" 2>/dev/null || \
    echo "  [warn] pm2 start may have failed — check pm2 status"
done

# ── Python orchestrator ──────────────────────────────────────────────────────
echo ""
echo "→ agent-orchestrator"
cd "$ROOT/apps/agent-orchestrator"
if [ ! -d ".venv" ]; then
  echo "  Creating virtualenv with uv..."
  uv venv
  uv pip install -r requirements.txt -q
fi
pm2 start ecosystem.config.js 2>/dev/null || pm2 restart rm-orchestrator 2>/dev/null || true

# ── Save & persist ───────────────────────────────────────────────────────────
pm2 save
echo ""
echo "Done! Run 'pm2 status' to verify all services."
echo "Run './deployment/scripts/health-check-all.sh' to check health endpoints."
