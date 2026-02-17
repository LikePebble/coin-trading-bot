#!/bin/bash
# session_manager.sh — template to detect idle ttys and (optionally) terminate them
# This script only logs candidates. To actually kill a tty it calls sudo pkill -t <tty> (requires sudoers).

LOGCMD="/usr/local/bin/openclaw-agent-log"

# find logged-in ttys and idle time (minutes)
who | awk '{print $2, $3, $4}' | while read tty host time; do
  # naive: record candidate; replace with more advanced idle checks if desired
  echo "candidate: $tty from $host at $time"
  $LOGCMD echo "session_manager: candidate $tty from $host at $time" || true
done

# To terminate (example): sudo pkill -t ttys003
# That action is intentionally commented out. Use sudoers template to allow specific pkill commands.
