Automation ground rules and installed helpers

Overview
- Purpose: Minimal safe automation so the assistant can quietly handle routine UI dialogs, close apps, and tidy idle shells while logging actions.
- Scope: Non-sensitive actions only. Anything involving credentials, payments, or account changes will always require explicit confirmation.

Files created (templates / no sudo required):
1) auto_quit_apps.sh
   - AppleScript-driven wrapper to request app quit (uses osascript). Intended to be run when Accessibility is granted.
   - Path: /Users/pebble/.openclaw/workspace/automation_files/auto_quit_apps.sh

2) session_manager.sh
   - Idle-session detector (template). Scans who/w output, logs candidates for termination, and (when sudoers allows) will call pkill -t <tty> to close sessions.
   - Path: /Users/pebble/.openclaw/workspace/automation_files/session_manager.sh

3) undo_automation.sh
   - Removes the files created by the assistant and prints the sudoers filename to delete if applied.
   - Path: /Users/pebble/.openclaw/workspace/automation_files/undo_automation.sh

4) sudoers_template.txt
   - Template that, if applied by an admin, allows openclaw-agent to pkill specific ttys without a password.
   - Path: /Users/pebble/.openclaw/workspace/automation_files/sudoers_template.txt

5) quick_instructions.txt
   - Concise instructions for the two manual steps needed to fully activate automation:
     1) Grant Accessibility to Terminal (or the chosen automation runner).
     2) Run the single sudo command shown in this file to install the prepared sudoers file.
   - Path: /Users/pebble/.openclaw/workspace/automation_files/quick_instructions.txt

Logging
- All automation actions should call /usr/local/bin/openclaw-agent-log (already installed) to record intent and result.

Safety
- The templates do not modify system sudoers or restart services. They are inert until the admin runs the single sudo command shown in quick_instructions.txt.
- To revoke any changes, run undo_automation.sh and remove /etc/sudoers.d/openclaw-revoke-session if present.

---

Next steps (what you need to do once):
1) Grant Accessibility permission to Terminal/iTerm (System Settings → Privacy & Security → Accessibility).  
2) As admin(pebble) run the command from quick_instructions.txt (one sudo line) when you are ready.

If you want, I can paste that one sudo line here for you to copy-paste into a Terminal.
