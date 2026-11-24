#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

FAKE_BIN="$TMP/bin"
FAKE_HOME="$TMP/home"
LOG="$TMP/systemctl.log"
ENABLED="$FAKE_HOME/.fake-enabled"
FAIL_ONCE="$TMP/fail-enable-once"

mkdir -p "$FAKE_BIN" "$FAKE_HOME" "$ENABLED"

export HOME="$FAKE_HOME"
export SYSTEMCTL_LOG="$LOG"
export FAKE_ENABLED="$ENABLED"
export PATH="$FAKE_BIN:$PATH"

cat > "$FAKE_BIN/systemctl" <<'MOCK'
#!/usr/bin/env bash
set -Eeuo pipefail

[[ "${1:-}" == "--user" ]] && shift

command="${1:-}"
shift || true

printf '%s %s\n' "$command" "$*" >> "$SYSTEMCTL_LOG"

case "$command" in
  show|daemon-reload)
    exit 0
    ;;
  is-active)
    exit 1
    ;;
  is-enabled)
    unit="${@: -1}"
    [[ -f "$FAKE_ENABLED/${unit%.service}" ]]
    ;;
  enable)
    if [[ -n "${FAIL_ENABLE_ONCE:-}" &&
          ! -e "$FAIL_ENABLE_ONCE" ]]; then
      touch "$FAIL_ENABLE_ONCE"
      echo "Simulated enable failure" >&2
      exit 1
    fi
    for unit in "$@"; do
      [[ "$unit" == --* ]] && continue
      touch "$FAKE_ENABLED/${unit%.service}"
    done
    ;;
  disable)
    for unit in "$@"; do
      [[ "$unit" == --* ]] && continue
      rm -f "$FAKE_ENABLED/${unit%.service}"
    done
    ;;
  *)
    echo "Unexpected systemctl command: $command $*" >&2
    exit 1
    ;;
esac
MOCK

chmod +x "$FAKE_BIN/systemctl"

cat > "$FAKE_BIN/node" <<'MOCK'
#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\n' "${FAKE_NODE_VERSION:-24.18.0}"
MOCK
chmod +x "$FAKE_BIN/node"

pass() { echo "[PASS] $1"; }
fail() { echo "[FAIL] $1" >&2; exit 1; }

SERVICE_DIR="$HOME/.config/systemd/user"

echo "========== NODE VERSION TESTS =========="

export FAKE_NODE_VERSION="22.11.9"
if bash "$ROOT/scripts/install-user.sh" --dry-run > "$TMP/node-old.log" 2>&1; then
  fail "Installer accepted Node.js 22.11.9."
fi

grep -q "Node.js 22.12.0 or newer is required" "$TMP/node-old.log" ||
  fail "Old Node.js version produced the wrong error."

pass "Rejects Node.js versions below 22.12.0"

export FAKE_NODE_VERSION="22.12.0"
bash "$ROOT/scripts/install-user.sh" --dry-run > "$TMP/node-minimum.log" ||
  fail "Installer rejected Node.js 22.12.0."

pass "Accepts the minimum supported Node.js version"

export FAKE_NODE_VERSION="24.18.0"

echo
echo "========== FRESH INSTALL TESTS =========="

bash "$ROOT/scripts/install-user.sh" --dry-run > "$TMP/dry-run.log"

[[ ! -e "$SERVICE_DIR/horizon-server.service" ]] ||
  fail "Dry run created service files."

pass "Dry run leaves filesystem unchanged"

bash "$ROOT/scripts/install-user.sh" > "$TMP/install.log"

for name in horizon-server horizon-rotation horizon-desktop; do
  [[ -s "$SERVICE_DIR/$name.service" ]] ||
    fail "$name.service missing."

  grep -q 'WantedBy=graphical-session.target' \
    "$SERVICE_DIR/$name.service" ||
    fail "$name graphical target missing."

  grep -q 'PartOf=graphical-session.target' \
    "$SERVICE_DIR/$name.service" ||
    fail "$name lifecycle dependency missing."

  [[ -f "$ENABLED/$name" ]] ||
    fail "$name was not enabled."
done

pass "Fresh installation creates and enables all services"

grep -q 'Requires=horizon-server.service' \
  "$SERVICE_DIR/horizon-desktop.service" ||
  fail "Desktop server dependency missing."

grep -q 'After=horizon-server.service' \
  "$SERVICE_DIR/horizon-desktop.service" ||
  fail "Desktop ordering missing."

pass "Desktop dependency is correct"

if grep -Eq '^(start|restart) ' "$LOG"; then
  fail "Installer unexpectedly started services."
fi

pass "Installer does not start services"

echo
echo "========== UPGRADE AND ROLLBACK TESTS =========="

# Arm the simulated failure only for the upgrade test.
export FAIL_ENABLE_ONCE="$FAIL_ONCE"

# Simulate an older installation with mixed enablement.
for name in horizon-server horizon-rotation horizon-desktop; do
  printf 'OLD CONFIGURATION: %s\n' "$name" \
    > "$SERVICE_DIR/$name.service"
done

mkdir -p "$SERVICE_DIR/horizon-server.service.d"
echo 'CUSTOM DROP-IN' \
  > "$SERVICE_DIR/horizon-server.service.d/custom.conf"

# Server and rotation were enabled; desktop was disabled.
rm -f "$ENABLED/horizon-desktop"

# Force the next enable operation to fail once.
if bash "$ROOT/scripts/install-user.sh" > "$TMP/rollback.log" 2>&1; then
  fail "Simulated installation failure was not detected."
fi

for name in horizon-server horizon-rotation horizon-desktop; do
  grep -q "^OLD CONFIGURATION: $name$" \
    "$SERVICE_DIR/$name.service" ||
    fail "$name was not restored."
done

pass "Failed upgrade restores all previous unit files"

[[ -f "$ENABLED/horizon-server" ]] ||
  fail "Previously enabled server was not re-enabled."

[[ -f "$ENABLED/horizon-rotation" ]] ||
  fail "Previously enabled rotation was not re-enabled."

[[ ! -f "$ENABLED/horizon-desktop" ]] ||
  fail "Previously disabled desktop was incorrectly enabled."

pass "Rollback restores previous enablement states"

[[ -f "$SERVICE_DIR/horizon-server.service.d/custom.conf" ]] ||
  fail "Custom drop-in was lost."

pass "Custom systemd drop-in survives failed upgrade"

echo
echo "All fresh-install and rollback tests passed."
echo "Only the temporary test HOME was modified."
