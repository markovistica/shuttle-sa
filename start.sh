#!/bin/bash

cleanup() {
  echo ""
  echo "Zaustavljam procese..."
  kill "$NPM_PID" "$NGROK_PID" 2>/dev/null
  wait "$NPM_PID" "$NGROK_PID" 2>/dev/null
  echo "Gotovo."
  exit 0
}

trap cleanup INT TERM

cd "$(dirname "$0")"

# Ugasi stari ngrok i oslobodi port
pkill -f "ngrok http" 2>/dev/null || true
if lsof -ti:3000 &>/dev/null; then
  echo "Port 3000 je zauzet — gasim stari proces..."
  lsof -ti:3000 | xargs kill -9 2>/dev/null
  sleep 1
fi

echo "Pokrećem Symphony Shuttle..."
npm start &
NPM_PID=$!

sleep 2

ngrok http 3000 > /tmp/ngrok-shuttle.log 2>&1 &
NGROK_PID=$!

echo "Čekam ngrok URL..."
URL=""
for i in $(seq 1 20); do
  URL=$(curl -s http://127.0.0.1:4040/api/tunnels 2>/dev/null \
    | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    t = d.get('tunnels', [])
    print(t[0]['public_url'] if t else '')
except Exception:
    print('')
" 2>/dev/null) || true
  if [ -n "$URL" ]; then
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  Symphony Shuttle je spreman!"
    echo "  URL: $URL"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    break
  fi
  sleep 1
done

if [ -z "$URL" ]; then
  echo "Upozorenje: ngrok URL nije pronađen. Provjeri /tmp/ngrok-shuttle.log"
fi

wait "$NPM_PID"
