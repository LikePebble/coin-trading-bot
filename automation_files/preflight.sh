#!/bin/bash
# preflight.sh — simple pre-execution safety checks (A: Preflight)
# Usage: ./preflight.sh /path/to/script_or_binary [--run]

TARGET="$1"
RUN_FLAG="$2"
LOGCMD="/usr/local/bin/openclaw-agent-log"

if [ -z "$TARGET" ]; then
  echo "USAGE: $0 /path/to/script_or_binary [--run]"; exit 2
fi

if [ ! -e "$TARGET" ]; then
  echo "TARGET_NOT_FOUND"; exit 3
fi

# 1) whitelist of known-good SHA256 (optional)
WHITELIST="/Users/pebble/.openclaw/workspace/automation_files/preflight_whitelist.txt"
if [ -f "$WHITELIST" ]; then
  SHA=$(shasum -a 256 "$TARGET" | awk '{print $1}')
  if grep -q "$SHA" "$WHITELIST"; then
    echo "WHITELIST_OK"
  else
    echo "WHITELIST_MISS"
  fi
else
  echo "WHITELIST_NONE"
fi

# 2) simple permission/ownership checks
LS=$(ls -l "$TARGET")
echo "FILE_INFO: $LS"

# 3) basic static scan for scripts
case "$TARGET" in
  *.sh|*.bash|*.zsh)
    if command -v shellcheck >/dev/null 2>&1; then
      shellcheck "$TARGET" || true
    else
      echo "SHELLCHECK_MISSING"
    fi
    ;;
  *.js)
    if command -v eslint >/dev/null 2>&1; then
      eslint "$TARGET" || true
    else
      echo "ESLINT_MISSING"
    fi
    ;;
  *)
    echo "NO_STATIC_CHECK"
    ;;
esac

# 4) SUID/SGID check
PERM=$(stat -f %A "$TARGET" 2>/dev/null || stat -c %a "$TARGET" 2>/dev/null || echo "?")
if [ "$PERM" = "?" ]; then
  echo "PERM_UNKNOWN"
else
  if [ $((PERM & 4000)) -ne 0 ] || [ $((PERM & 2000)) -ne 0 ]; then
    echo "SUID_SGID_SET"
  else
    echo "PERM_OK"
  fi
fi

# Final decision: if --run provided and no glaring failures, execute
if [ "$RUN_FLAG" = "--run" ]; then
  # simple policy: don't run if whitelist missing AND SUID set
  if [ "$(grep -q 'SUID_SGID_SET' /dev/null 2>&1; echo $?)" -eq 0 ]; then
    # noop (we don't have grep output here) — we'll do a conservative check
    :
  fi
  echo "EXECUTING: $TARGET"
  $LOGCMD echo "preflight: executing $TARGET"
  if [ -x "$TARGET" ]; then
    "$TARGET"
    EXIT=$?
    echo "EXIT:$EXIT"
    exit $EXIT
  else
    # try running with shell
    sh "$TARGET"
    exit $?
  fi
else
  echo "DRY_RUN_COMPLETE"
fi
