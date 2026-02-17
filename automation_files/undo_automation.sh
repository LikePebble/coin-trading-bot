#!/bin/bash
# undo_automation.sh — removes automation templates created in workspace
set -e
DIR="/Users/pebble/.openclaw/workspace/automation_files"
rm -f "$DIR/auto_quit_apps.sh" "$DIR/session_manager.sh" "$DIR/sudoers_template.txt" "$DIR/quick_instructions.txt"
echo "Local templates removed. If you applied the sudoers file, remove it with:" 
echo "  sudo rm -f /etc/sudoers.d/openclaw-revoke-session && sudo visudo -c"
