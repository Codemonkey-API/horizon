#!/usr/bin/env bash
set -Eeuo pipefail

DRY_RUN=0

case "${1:-}" in
  "") ;;
  --dry-run) DRY_RUN=1 ;;
  --help|-h)
    echo "Usage: $0 [--dry-run]"
    exit 0
    ;;
  *)
    echo "Usage: $0 [--dry-run]" >&2
    exit 2
    ;;
esac

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
HOME_DIR="${HOME:?HOME must be set}"
SERVICE_DIR="$HOME_DIR/.config/systemd/user"
STATE_DIR="$HOME_DIR/.local/state/horizon/install-backups"

NODE_BIN="$(command -v node || true)"
NPM_BIN="$(command -v npm || true)"
ELECTRON="$ROOT/node_modules/.bin/electron"

NAMES=(horizon-server horizon-rotation horizon-desktop)
BACKUP_DIR=""
TRANSACTION_STARTED=0
COMMITTED=0

fail() {
  printf 'Horizon installer: ERROR: %s\n' "$*" >&2
  exit 1
}

rollback() {
  local status=$?
  trap - EXIT

  if (( TRANSACTION_STARTED == 1 && COMMITTED == 0 )); then
    echo "Installation failed. Restoring previous configuration..." >&2

    systemctl --user disable "${NAMES[@]}" >/dev/null 2>&1 || true

    for name in "${NAMES[@]}"; do
      local file="$SERVICE_DIR/$name.service"
      local saved="$BACKUP_DIR/$name.service"

      if [[ -f "$saved" ]]; then
        cp -a "$saved" "$file"
      else
        rm -f "$file"
      fi
    done

    systemctl --user daemon-reload >/dev/null 2>&1 || true

    for name in "${NAMES[@]}"; do
      if [[ -f "$BACKUP_DIR/$name.was-enabled" ]] &&
         [[ "$(cat "$BACKUP_DIR/$name.was-enabled")" == yes ]]; then
        systemctl --user enable "$name.service" >/dev/null 2>&1 || true
      fi
    done

    echo "Rollback attempted. Previous unit files are in: $BACKUP_DIR" >&2
  fi

  exit "$status"
}

trap rollback EXIT

[[ -n "$NODE_BIN" && -x "$NODE_BIN" ]] || fail "Node.js is required."
[[ -n "$NPM_BIN" && -x "$NPM_BIN" ]] || fail "npm is required."
command -v systemctl >/dev/null || fail "systemctl is required."
[[ -f "$ROOT/package.json" ]] || fail "package.json not found."
[[ -x "$ELECTRON" ]] || fail "Electron is missing. Install root dependencies."
[[ -x "$ROOT/node_modules/.bin/tsx" ]] || fail "tsx is missing."
[[ -s "$ROOT/ui/dist/index.html" ]] || fail "Build the UI first with npm run build."
[[ -f "$ROOT/src/server.ts" && -f "$ROOT/src/cli.ts" ]] || fail "Horizon source files are missing."

for path in "$ROOT" "$HOME_DIR" "$NODE_BIN" "$NPM_BIN" "$ELECTRON"; do
  [[ "$path" != *[[:space:]]* ]] ||
    fail "Paths containing whitespace are not yet supported: $path"
done

NODE_VERSION="$("$NODE_BIN" -p 'process.versions.node')"
IFS=. read -r NODE_MAJOR NODE_MINOR NODE_PATCH <<< "$NODE_VERSION"

[[ "$NODE_MAJOR" =~ ^[0-9]+$ &&
   "$NODE_MINOR" =~ ^[0-9]+$ &&
   "$NODE_PATCH" =~ ^[0-9]+$ ]] ||
  fail "Could not determine a valid Node.js version."

if (( NODE_MAJOR < 22 || (NODE_MAJOR == 22 && NODE_MINOR < 12) )); then
  fail "Node.js 22.12.0 or newer is required. Detected: $NODE_VERSION"
fi

systemctl --user show graphical-session.target >/dev/null 2>&1 ||
  fail "Cannot inspect graphical-session.target."

write_unit() {
  local description="$1"
  local exec_start="$2"
  local restart="$3"
  local restart_sec="$4"
  local kill_mode="$5"
  local extra="${6:-}"

  cat <<UNIT
[Unit]
Description=$description
PartOf=graphical-session.target
$extra

[Service]
Type=simple
WorkingDirectory=$ROOT
Environment=HOME=$HOME_DIR
Environment=PATH=$(dirname "$NODE_BIN"):$HOME_DIR/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=$exec_start
Restart=$restart
RestartSec=$restart_sec
KillMode=$kill_mode
TimeoutStopSec=10

[Install]
WantedBy=graphical-session.target
UNIT
}

SERVER_UNIT="$(write_unit \
  'Horizon Wallpaper Studio API' \
  "$NPM_BIN run server" \
  on-failure 3 control-group)"

ROTATION_UNIT="$(write_unit \
  'Horizon Panoramic Wallpaper Rotation' \
  "$NPM_BIN run horizon -- rotate" \
  on-failure 10 control-group)"

DESKTOP_UNIT="$(write_unit \
  'Horizon Wallpaper Studio Desktop' \
  "$ELECTRON ." \
  no 3 mixed \
  $'Requires=horizon-server.service\nAfter=horizon-server.service')"

printf 'Horizon installer%s\n' "$([[ $DRY_RUN -eq 1 ]] && echo ' [DRY RUN]' || true)"
printf 'Project: %s\nNode: %s\n' "$ROOT" "$NODE_BIN"

printf '\n========== GENERATED UNITS ==========\n'
for name in "${NAMES[@]}"; do
  case "$name" in
    horizon-server) unit="$SERVER_UNIT" ;;
    horizon-rotation) unit="$ROTATION_UNIT" ;;
    horizon-desktop) unit="$DESKTOP_UNIT" ;;
  esac
  printf '\n--- %s.service ---\n%s\n' "$name" "$unit"
done

ACTIVE=0
printf '\n========== CURRENT SERVICES ==========\n'
for name in "${NAMES[@]}"; do
  if systemctl --user is-active --quiet "$name.service"; then
    echo "$name: ACTIVE"
    ACTIVE=1
  else
    echo "$name: inactive"
  fi
done

if (( DRY_RUN == 1 )); then
  echo
  echo "Dry run complete. No files or services changed."
  exit 0
fi

(( ACTIVE == 0 )) ||
  fail "A Horizon service is active. Stop it deliberately before migration."

mkdir -p "$SERVICE_DIR" "$STATE_DIR"
BACKUP_DIR="$(mktemp -d "$STATE_DIR/install-$(date +%Y%m%d-%H%M%S)-XXXXXX")"

# Record existing unit files and enablement state.
for name in "${NAMES[@]}"; do
  file="$SERVICE_DIR/$name.service"

  if [[ -f "$file" ]]; then
    cp -a "$file" "$BACKUP_DIR/"
  fi

  if systemctl --user is-enabled --quiet "$name.service"; then
    echo yes > "$BACKUP_DIR/$name.was-enabled"
  else
    echo no > "$BACKUP_DIR/$name.was-enabled"
  fi

  # Preserve existing custom drop-ins for audit and recovery.
  if [[ -d "$SERVICE_DIR/$name.service.d" ]]; then
    cp -a "$SERVICE_DIR/$name.service.d" "$BACKUP_DIR/"
  fi
done

TRANSACTION_STARTED=1

# Remove old enablement links only for units that already exist.
# Fresh installations have nothing to disable.
for name in "${NAMES[@]}"; do
  if [[ -f "$SERVICE_DIR/$name.service" ]] ||
     systemctl --user is-enabled --quiet "$name.service"; then
    systemctl --user disable "$name.service"
  fi
done

# Write each new unit through a temporary file, then rename atomically.
for name in "${NAMES[@]}"; do
  case "$name" in
    horizon-server) unit="$SERVER_UNIT" ;;
    horizon-rotation) unit="$ROTATION_UNIT" ;;
    horizon-desktop) unit="$DESKTOP_UNIT" ;;
  esac

  tmp="$(mktemp "$SERVICE_DIR/.${name}.XXXXXX")"
  printf '%s\n' "$unit" > "$tmp"
  chmod 0644 "$tmp"
  mv -f "$tmp" "$SERVICE_DIR/$name.service"
done

systemctl --user daemon-reload
systemctl --user enable "${NAMES[@]}"

COMMITTED=1
trap - EXIT

echo
echo "Horizon service files installed."
echo "Backup: $BACKUP_DIR"
echo "Existing drop-ins were preserved."
echo "Services have NOT been started."
echo "Start manually with:"
echo "systemctl --user start horizon-server horizon-rotation horizon-desktop"
