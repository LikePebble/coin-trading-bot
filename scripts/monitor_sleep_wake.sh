#!/bin/bash
# monitor_sleep_wake.sh
# Logs sleep/wake events and process states to logs/sleep_wake.log
LOGFILE="$(dirname "$0")/../logs/sleep_wake.log"
STRATEGY_PID_FILE="$(dirname "$0")/strategy_pid.txt"

echo "[init] $(date -u +%Y-%m-%dT%H:%M:%SZ) Monitor starting" >> "$LOGFILE"

# Function to log process status
log_processes(){
  echo "[proc] $(date -u +%Y-%m-%dT%H:%M:%SZ) PID List" >> "$LOGFILE"
  ps -eo pid,etimes,comm | grep node | grep -v grep >> "$LOGFILE" 2>&1 || true
}

# Initial log
log_processes

# Use pmset to watch for sleep/wake events via system log
# This will tail the unified logs for 'Sleep' or 'Wake' events
# Requires macOS unified log; fallback to pmset -g if unavailable
if command -v log >/dev/null 2>&1; then
  # Use log stream (this runs indefinitely)
  log stream --style syslog --predicate 'eventMessage CONTAINS "Entering Sleep" OR eventMessage CONTAINS "Wake reason"' --info | while read -r line; do
    ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    echo "[power] $ts $line" >> "$LOGFILE"
    # On wake, capture processes
    if echo "$line" | grep -q "Wake reason"; then
      echo "[power] $ts Detected Wake -> logging processes and network" >> "$LOGFILE"
      log_processes
      ping -c 3 8.8.8.8 >> "$LOGFILE" 2>&1 || echo "[power] $ts ping failed" >> "$LOGFILE"
    fi
  done
else
  # Fallback: poll pmset -g log every 10s and detect changes
  last_log=""
  while true; do
    cur=$(pmset -g log | tail -n 200)
    if [[ "$cur" != "$last_log" ]]; then
      ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
      echo "[power] $ts pmset log changed" >> "$LOGFILE"
      echo "$cur" >> "$LOGFILE"
      last_log="$cur"
      log_processes
    fi
    sleep 10
  done
fi
