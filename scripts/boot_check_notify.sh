#!/bin/bash
# boot_check_notify.sh
# Run at user login/boot: check if strategy and notify services are running; if not, send Telegram asking whether to start live trading
WORKDIR="/Users/pebble/.openclaw/workspace"
cd "$WORKDIR"
. "$WORKDIR/.env" 2>/dev/null || true

# helper to check process
is_running(){ pgrep -f "$1" >/dev/null; }
STRAT_RUNNING=0
NOTIFY_RUNNING=0
if is_running "strategy_engine.js"; then STRAT_RUNNING=1; fi
if is_running "notify_telegram.js"; then NOTIFY_RUNNING=1; fi

# load notify lib via node to send message
NODE_CMD="node -e \"(async()=>{try{const nt=require('./scripts/notify_telegram'); await nt.sendTelegram('Boot check: strategy_running='+${STRAT_RUNNING}+' notify_running='+${NOTIFY_RUNNING});}catch(e){console.error(e)}})()\""

# If either missing, ask user via Telegram whether to start live
if [ "$STRAT_RUNNING" -eq 0 ] || [ "$NOTIFY_RUNNING" -eq 0 ]; then
  # send prompt
  eval $NODE_CMD
fi

# exit
exit 0
