#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

BIN="$TMP/bin"
mkdir -p "$BIN"

export PATH="$BIN:$PATH"

cat > "$BIN/systemctl" <<'MOCK'
#!/usr/bin/env bash
set -Eeuo pipefail

[[ "${1:-}" == "--user" ]] && shift
cmd="${1:-}"
shift || true
unit="${@: -1}"

case "$cmd" in
  is-active)
    [[ -f "$FAKE_ACTIVE/${unit%.service}" ]]
    ;;
  is-enabled)
    [[ -f "$FAKE_ENABLED/${unit%.service}" ]]
    ;;
  stop)
    rm -f "$FAKE_ACTIVE/${unit%.service}"
    ;;
  start)
    touch "$FAKE_ACTIVE/${unit%.service}"
    ;;
  disable)
    if [[ "${FAIL_DISABLE_UNIT:-}" == "$unit" &&
          ! -e "$FAIL_ONCE" ]]; then
      touch "$FAIL_ONCE"
      echo "Simulated disable failure" >&2
      exit 1
    fi
    rm -f "$FAKE_ENABLED/${unit%.service}"
    ;;
  enable)
    touch "$FAKE_ENABLED/${unit%.service}"
    ;;
  daemon-reload|reset-failed)
    ;;
  *)
    echo "Unexpected systemctl command: $cmd $*" >&2
    exit 1
    ;;
esac
MOCK

chmod +x "$BIN/systemctl"

pass() { echo "[PASS] $1"; }
fail() { echo "[FAIL] $1" >&2; exit 1; }

setup_home() {
  export HOME="$TMP/$1"
  export FAKE_ACTIVE="$HOME/.fake-active"
  export FAKE_ENABLED="$HOME/.fake-enabled"
  export FAIL_ONCE="$HOME/.fail-once"
  export FAIL_DISABLE_UNIT="${2:-}"

  mkdir -p "$HOME/.config/systemd/user" "$FAKE_ACTIVE" "$FAKE_ENABLED"

  for name in horizon-server horizon-rotation horizon-desktop; do
    echo "Original $name" > "$HOME/.config/systemd/user/$name.service"
    touch "$FAKE_ACTIVE/$name" "$FAKE_ENABLED/$name"
  done

  mkdir -p "$HOME/.config/systemd/user/horizon-server.service.d"
  echo "Custom configuration" \
    > "$HOME/.config/systemd/user/horizon-server.service.d/custom.conf"

  mkdir -p "$HOME/.local/share/horizon/wallpapers"
  echo "Personal wallpaper" \
    > "$HOME/.local/share/horizon/wallpapers/keep.txt"

  mkdir -p "$HOME/.config/horizon"
  echo "Personal settings" > "$HOME/.config/horizon/settings.json"
}

echo "========== SUCCESSFUL UNINSTALL TEST =========="

setup_home success

bash "$ROOT/scripts/uninstall-user.sh" --yes

for name in horizon-server horizon-rotation horizon-desktop; do
  [[ ! -e "$HOME/.config/systemd/user/$name.service" ]] ||
    fail "$name service file remains."

  [[ ! -e "$FAKE_ACTIVE/$name" ]] ||
    fail "$name is still active."

  [[ ! -e "$FAKE_ENABLED/$name" ]] ||
    fail "$name is still enabled."
done

pass "All three services removed, stopped and disabled"

[[ -f "$HOME/.config/systemd/user/horizon-server.service.d/custom.conf" ]] ||
  fail "Custom drop-in was deleted."

[[ -f "$HOME/.local/share/horizon/wallpapers/keep.txt" ]] ||
  fail "Wallpaper data was deleted."

[[ -f "$HOME/.config/horizon/settings.json" ]] ||
  fail "Settings were deleted."

pass "Drop-ins, wallpapers and settings preserved"

echo
echo "========== FAILED UNINSTALL ROLLBACK TEST =========="

setup_home rollback horizon-rotation.service

if bash "$ROOT/scripts/uninstall-user.sh" --yes; then
  fail "Simulated removal failure was not detected."
fi

for name in horizon-server horizon-rotation horizon-desktop; do
  [[ -f "$HOME/.config/systemd/user/$name.service" ]] ||
    fail "$name service file was not restored."

  [[ -f "$FAKE_ACTIVE/$name" ]] ||
    fail "$name active state was not restored."

  [[ -f "$FAKE_ENABLED/$name" ]] ||
    fail "$name enabled state was not restored."
done

pass "Failed removal restores service files and states"

[[ -f "$HOME/.config/systemd/user/horizon-server.service.d/custom.conf" ]] ||
  fail "Drop-in was lost during rollback."

pass "Custom drop-in survives rollback"

echo
echo "All uninstaller tests passed."
echo "Only temporary test homes were modified."
