#!/bin/bash
cd "$(dirname "$0")"

PUBLIC_CFG="../Публичный портфель/python/config.json"
if [ -f "$PUBLIC_CFG" ] && [ ! -f "config.json" ]; then
  cp "$PUBLIC_CFG" "config.json"
fi
if [ ! -f "config.json" ] && [ -f "config.example.json" ]; then
  cp "config.example.json" "config.json"
fi

if [ -f package.json ] && grep -q '"commonjs"' package.json 2>/dev/null; then
  rm -f package.json
fi

PORT=5500
lsof -ti :$PORT 2>/dev/null | xargs kill -9 2>/dev/null
sleep 0.4
nohup python3 server.py >>/tmp/portfolio-tracker.log 2>&1 &

for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -sf --max-time 2 "http://127.0.0.1:$PORT/api/health" | grep -q 'portfolio-tracker'; then
    break
  fi
  sleep 0.3
done

open "http://127.0.0.1:$PORT/index.html?v=$(date +%s)"
