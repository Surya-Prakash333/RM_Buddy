#!/bin/bash
# health-check-all.sh — Verify all RM Buddy services are healthy

URLS=(
  "http://localhost:3000/health:Gateway"
  "http://localhost:3001/health:Core-API"
  "http://localhost:3002/health:Auth"
  "http://localhost:3003/health:Comm"
  "http://localhost:5000/health:Orchestrator"
)

ALL_OK=true
echo "RM Buddy Health Check"
echo "━━━━━━━━━━━━━━━━━━━━━"

for entry in "${URLS[@]}"; do
  url="${entry%%:*}"
  name="${entry##*:}"
  body=$(curl -sf --max-time 5 "$url" 2>/dev/null)
  status=$(echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','?'))" 2>/dev/null || echo "UNREACHABLE")
  if [ "$status" = "ok" ] || [ "$status" = "healthy" ] || [ "$status" = "success" ]; then
    echo "✅ $name → $status"
  else
    echo "❌ $name → $status"
    ALL_OK=false
  fi
done

echo ""
if [ "$ALL_OK" = true ]; then
  echo "✅ All services healthy"
  exit 0
else
  echo "❌ Some services unhealthy — check pm2 logs"
  exit 1
fi
