#!/bin/bash
# auto_quit_apps.sh — request apps to quit using AppleScript (osascript)
# Usage: ./auto_quit_apps.sh "Terminal" "Google Chrome" "Safari"

for app in "$@"; do
  /usr/bin/osascript -e "tell application \"$app\" to quit saving no" 2>/dev/null
  /usr/bin/logger -t openclaw-agent "auto_quit_apps: requested quit for $app"
  /usr/local/bin/openclaw-agent-log echo "auto_quit_apps: requested quit for $app" || true
done
