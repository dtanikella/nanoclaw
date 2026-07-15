#!/usr/bin/env bash
#
# deploy.sh — One-command redeploy to the remote server.
#
# Usage:
#   bash deploy.sh [server]
#   bash deploy.sh root@203.0.113.1
#
# If <server> is omitted, reads DEPLOY_HOST from the DEPLOY_HOST environment
# variable or from the .env file in this directory.
#
# The remote path defaults to ~/nanoclaw. Override with DEPLOY_PATH env var
# or a DEPLOY_PATH= line in .env.
#
# Manual trigger only — no polling or CI integration.
#
# Steps performed on the server:
#   1. git pull (fast-forward only, fails if diverged)
#   2. pnpm install --frozen-lockfile
#   3. pnpm build
#   4. launchctl kickstart -k gui/501/com.nanoclaw  (macOS)
#      or: systemctl --user restart nanoclaw         (Linux)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ─── output helpers ──────────────────────────────────────────────────────────

use_ansi() { [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; }
dim()   { use_ansi && printf '\033[2m%s\033[0m' "$1" || printf '%s' "$1"; }
green() { use_ansi && printf '\033[32m%s\033[0m' "$1" || printf '%s' "$1"; }
red()   { use_ansi && printf '\033[31m%s\033[0m' "$1" || printf '%s' "$1"; }
bold()  { use_ansi && printf '\033[1m%s\033[0m' "$1" || printf '%s' "$1"; }

step_ok()   { printf '%s  %s\n' "$(green '✓')" "$1"; }
step_fail() { printf '%s  %s\n' "$(red   '✗')" "$1"; }
step_info() { printf '%s  %s\n' "$(dim   '·')" "$1"; }

# ─── resolve server ──────────────────────────────────────────────────────────

read_env_key() {
  local key="$1"
  local envfile="$SCRIPT_DIR/.env"
  [ -f "$envfile" ] || return 0
  local line
  line=$(grep -E "^${key}=" "$envfile" 2>/dev/null | head -1) || return 0
  [ -z "$line" ] && return 0
  local val="${line#*=}"
  # Strip surrounding quotes
  val="${val%\"}"; val="${val#\"}"; val="${val%\'}"; val="${val#\'}"
  printf '%s' "$val"
}

SERVER="${1:-}"

if [ -z "$SERVER" ]; then
  SERVER="${DEPLOY_HOST:-$(read_env_key DEPLOY_HOST)}"
fi

if [ -z "$SERVER" ]; then
  printf '%s\n' "$(red 'Error: no server specified.')"
  echo
  echo "  Provide it as an argument:    $(dim 'bash deploy.sh user@host')"
  echo "  Or set in .env:               $(dim 'DEPLOY_HOST=user@host')"
  echo "  Or export before running:     $(dim 'export DEPLOY_HOST=user@host')"
  echo
  exit 1
fi

# ─── resolve remote path ─────────────────────────────────────────────────────

DEPLOY_PATH="${DEPLOY_PATH:-$(read_env_key DEPLOY_PATH)}"
DEPLOY_PATH="${DEPLOY_PATH:-~/nanoclaw}"

# ─── deploy ──────────────────────────────────────────────────────────────────

echo
bold "Deploying to ${SERVER}"
echo "  $(dim "path: ${DEPLOY_PATH}")"
echo

step_info "Connecting…"

ssh -T "$SERVER" bash -s -- "$DEPLOY_PATH" <<'REMOTE'
set -euo pipefail

DEPLOY_PATH="$1"

# ─── remote output helpers ───────────────────────────────────────────────────

use_ansi() { [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; }
dim()   { use_ansi && printf '\033[2m%s\033[0m' "$1" || printf '%s' "$1"; }
green() { use_ansi && printf '\033[32m%s\033[0m' "$1" || printf '%s' "$1"; }
red()   { use_ansi && printf '\033[31m%s\033[0m' "$1" || printf '%s' "$1"; }

step_ok()   { printf '%s  %s\n' "$(green '✓')" "$1"; }
step_fail() { printf '%s  %s\n' "$(red   '✗')" "$1"; }
step_info() { printf '%s  %s\n' "$(dim   '·')" "$1"; }

# Expand tilde — eval is safe here since DEPLOY_PATH comes from our own .env
eval "DEPLOY_PATH_EXPANDED=$DEPLOY_PATH"

if [ ! -d "$DEPLOY_PATH_EXPANDED" ]; then
  step_fail "Directory not found: $DEPLOY_PATH_EXPANDED"
  exit 1
fi

cd "$DEPLOY_PATH_EXPANDED"

# ─── 1. git pull ─────────────────────────────────────────────────────────────

step_info "Pulling latest code…"
if git pull --ff-only 2>&1; then
  COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo unknown)
  step_ok "Up to date $(printf '\033[2m(%s)\033[0m' "$COMMIT")"
else
  step_fail "git pull failed — branch may have diverged. Resolve manually and retry."
  exit 1
fi

# ─── 2. pnpm install --frozen-lockfile ───────────────────────────────────────

step_info "Installing dependencies…"
if pnpm install --frozen-lockfile 2>&1; then
  step_ok "Dependencies installed"
else
  step_fail "pnpm install failed"
  exit 1
fi

# ─── 3. pnpm build ───────────────────────────────────────────────────────────

step_info "Building…"
if pnpm build 2>&1; then
  step_ok "Build complete"
else
  step_fail "pnpm build failed"
  exit 1
fi

# ─── 4. restart service ──────────────────────────────────────────────────────

step_info "Restarting service…"

OS=$(uname -s)
if [ "$OS" = "Darwin" ]; then
  UID_NUM=$(id -u)
  if launchctl kickstart -k "gui/${UID_NUM}/com.nanoclaw" 2>&1; then
    step_ok "Service restarted $(printf '\033[2m(launchctl kickstart gui/%s/com.nanoclaw)\033[0m' "$UID_NUM")"
  else
    step_fail "launchctl kickstart failed — service may not be loaded"
    echo "  To load it:  $(printf '\033[2mlaunchctl load ~/Library/LaunchAgents/com.nanoclaw.plist\033[0m')"
    exit 1
  fi
elif [ "$OS" = "Linux" ]; then
  if systemctl --user restart nanoclaw 2>&1; then
    step_ok "Service restarted $(printf '\033[2m(systemctl --user restart nanoclaw)\033[0m')"
  else
    step_fail "systemctl restart failed"
    exit 1
  fi
else
  step_fail "Unknown OS: $OS — don't know how to restart the service"
  exit 1
fi

REMOTE

step_ok "Deploy complete"
echo
