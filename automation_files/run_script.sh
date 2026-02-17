#!/bin/bash
# run_script.sh — wrapper to run preflight then execute
TARGET="$1"
if [ -z "$TARGET" ]; then echo 'USAGE: run_script.sh /path/to/script'; exit 2; fi
/Users/pebble/.openclaw/workspace/automation_files/preflight.sh "$TARGET" --run
