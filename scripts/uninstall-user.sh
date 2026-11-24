#!/usr/bin/env bash
set -Eeuo pipefail

DRY_RUN=0
YES=0

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --yes|-y) YES=1 ;;
    --help|-h)
      echo "Usage: $0 [--dry-run] [--yes]"
      exit 0
      ;;
    *)
      echo "Usage: $0 [--dry-run] [--yes]" >&2
      exit 2
      ;;
  esac
done

command -v systemctl >/dev/null ||
  { echo "systemctl is required." >&2; exit 1; }

HOME_DIR="${HOME:?HOME must be set}"
SERVICE_DIR="$HOME_DIR/.config/systemd/user"
STATE_DIR="$HOME_DIR/.local/state/horizon/uninstall-backups"

# Stop dependants before dependencies.
NAMES=(horizon-desktop horizon-rotation horizon-server)
START_ORDER=(horizon-server horizon-rotation horizon-desktop)

BACKUP_DIR=""
TRANSACTION_STARTED=0
COMMITTED=0

fail() {
  echo "Horizon uninstaller: ERROR: $*" >&2
  exit 1
}

rollback() {
  local status=$?
  trap - EXIT

  if (( TRANSACTION_STARTED == 1 && COMMITTED == 0 )); then
    echo "Removal failed. Attempting restoration..." >&2

    # Restore unit files first.
    for name in "${NAMES[@]}"; do
      saved="$BACKUP_DIR/$name.service"
      target="$SERVICE_DIR/$name.service"

      if [[ -e "$saved" || -L "$saved" ]]; then
        cp -a "$saved" "$target"
      fi
    done

    systemctl --user daemon-reload >/dev/null 2>&1 || true

    # Restore enablement state.
    for name in "${NAMES[@]}"; do
      if [[ -f "$BACKUP_DIR/$name.was-enabled" ]]; then
        if [[ "$(cat "$BACKUP_DIR/$name.was-enabled")" == yes ]]; then
          systemctl --user enable "$name.service" >/dev/null 2>&1 || true
        else
          systemctl --user disable "$name.service" >/dev/null 2>&1 || true
        fi
      fi
    done

    # Restore previously active services in dependency order.
    for name in "${START_ORDER[@]}"; do
      if [[ -f "$BACKUP_DIR/$name.was-active" ]] &&
         [[ "$(cat "$BACKUP_DIR/$name.was-active")" == yes ]]; then
        systemctl --user start "$name.service" >/dev/null 2>&1 || true
      fi
    done

    echo "Restoration attempted. Backup: $BACKUP_DIR" >&2
  fi

  exit "$status"
}

trap rollback EXIT

mkdir -p "$SERVICE_DIR"

echo "Horizon user-service uninstaller"
echo "Service directory: $SERVICE_DIR"

FOUND=0

for name in "${NAMES[@]}"; do
  if [[ -e "$SERVICE_DIR/$name.service" ||
        -L "$SERVICE_DIR/$name.service" ]]; then
    FOUND=1
  fi
done

if (( FOUND == 0 )); then
  echo "No Horizon service files found in $SERVICE_DIR."
  exit 0
fi

echo
echo "========== PLANNED REMOVAL =========="

for name in "${NAMES[@]}"; do
  file="$SERVICE_DIR/$name.service"

  [[ -e "$file" || -L "$file" ]] || continue

  echo "Remove $file"

  if systemctl --user is-active --quiet "$name.service"; then
    echo "  Stop $name.service"
  fi

  if systemctl --user is-enabled --quiet "$name.service"; then
    echo "  Disable $name.service"
  fi
done

echo
echo "The following will be preserved:"
echo "  - Horizon project files"
echo "  - Wallpapers and wallpaper library"
echo "  - Horizon settings"
echo "  - Installation backups"
echo "  - Custom systemd drop-ins"

if (( DRY_RUN == 1 )); then
  echo
  echo "Dry run complete. Nothing was changed."
  exit 0
fi

if (( YES == 0 )); then
  read -r -p "Remove Horizon service integration? [y/N] " answer
  [[ "$answer" =~ ^[Yy]$ ]] || {
    echo "Uninstallation cancelled."
    exit 0
  }
fi

mkdir -p "$STATE_DIR"
BACKUP_DIR="$(mktemp -d "$STATE_DIR/remove-$(date +%Y%m%d-%H%M%S)-XXXXXX")"

# Record files and current states before changing anything.
for name in "${NAMES[@]}"; do
  file="$SERVICE_DIR/$name.service"

  if [[ -e "$file" || -L "$file" ]]; then
    cp -a "$file" "$BACKUP_DIR/"
    echo yes > "$BACKUP_DIR/$name.was-present"
  else
    echo no > "$BACKUP_DIR/$name.was-present"
  fi

  if systemctl --user is-active --quiet "$name.service"; then
    echo yes > "$BACKUP_DIR/$name.was-active"
  else
    echo no > "$BACKUP_DIR/$name.was-active"
  fi

  if systemctl --user is-enabled --quiet "$name.service"; then
    echo yes > "$BACKUP_DIR/$name.was-enabled"
  else
    echo no > "$BACKUP_DIR/$name.was-enabled"
  fi
done

TRANSACTION_STARTED=1

# Stop active services in dependency order.
for name in "${NAMES[@]}"; do
  if [[ -f "$BACKUP_DIR/$name.was-present" ]] &&
     [[ "$(cat "$BACKUP_DIR/$name.was-present")" == yes ]] &&
     systemctl --user is-active --quiet "$name.service"; then
    systemctl --user stop "$name.service"
  fi
done

# Disable and remove only service unit files.
for name in "${NAMES[@]}"; do
  file="$SERVICE_DIR/$name.service"

  [[ -e "$file" || -L "$file" ]] || continue

  if systemctl --user is-enabled --quiet "$name.service"; then
    systemctl --user disable "$name.service"
  fi

  rm -- "$file"
done

systemctl --user daemon-reload

COMMITTED=1
trap - EXIT

echo
echo "Horizon service integration removed."
echo "Backup: $BACKUP_DIR"
echo "Project files and personal data were preserved."
