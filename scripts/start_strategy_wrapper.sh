#!/bin/bash
WORKDIR="/Users/pebble/.openclaw/workspace"
cd "$WORKDIR"
# load env
if [ -f "$WORKDIR/.env" ]; then
  set -o allexport
  source "$WORKDIR/.env"
  set +o allexport
fi
# Ensure LIVE flags for wrapper
export LIVE_MODE=true
export LIVE_TRADING_ENABLED=true
# Start strategy
exec /usr/bin/env node "$WORKDIR/scripts/strategy_engine.js"
