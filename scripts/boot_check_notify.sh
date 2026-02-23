#!/bin/bash
# boot_check_notify.sh — one-shot boot check (no KeepAlive, exits immediately)
export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
WORKDIR="/Users/pebble/.openclaw/workspace"
cd "$WORKDIR"
. "$WORKDIR/.env" 2>/dev/null || true

STRAT_RUNNING=0; NOTIFY_RUNNING=0
pgrep -f "strategy_engine.js" >/dev/null && STRAT_RUNNING=1
pgrep -f "notify_telegram.js" >/dev/null && NOTIFY_RUNNING=1

if [ "$STRAT_RUNNING" -eq 0 ] || [ "$NOTIFY_RUNNING" -eq 0 ]; then
  # Send one-shot notification and EXIT (do not hold the process)
  /opt/homebrew/bin/node -e "
    const nt=require('./scripts/notify_telegram');
    nt.sendTelegram('Boot check: strategy=${STRAT_RUNNING} notify=${NOTIFY_RUNNING}')
      .then(()=>process.exit(0))
      .catch(()=>process.exit(1));
    setTimeout(()=>process.exit(0), 5000);
  "
fi
exit 0
