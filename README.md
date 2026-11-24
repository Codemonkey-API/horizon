# Horizon 🌅

**Horizon is a Linux desktop wallpaper manager and panoramic multi-monitor rotation engine designed for the COSMIC desktop environment.**

It combines panoramic image rendering, wallpaper collection management, automatic rotation, a local API and an Electron-based desktop interface.

Horizon is currently developed and tested on Pop!_OS with COSMIC. Other Linux distributions and desktop environments have not yet been verified.

## Features

- **Panoramic rendering:** Calculate a combined canvas and render correctly positioned wallpaper sections for multiple displays.
- **Multi-monitor support:** Discover enabled displays and account for their resolutions and positions.
- **Wallpaper library:** Manage a wallpaper collection and configured wallpaper folders.
- **Automatic rotation:** Apply wallpapers at a configurable interval and discover new images automatically.
- **Desktop interface:** Manage Horizon through a React interface packaged with Electron.
- **Local API:** Serve the production interface and wallpaper API over localhost.
- **COSMIC integration:** Synchronize wallpaper configuration across Base, Light and Dark COSMIC desktop themes.
- **User-level services:** Integrate the server, rotation engine and desktop interface with systemd.

## Requirements

- Linux with the COSMIC desktop environment.
- Node.js 22.12.0 or newer.
- npm.
- Git.
- systemd user services with `graphical-session.target`.
- A working graphical desktop session.
- Sufficient system libraries and graphics support to run Electron.

Horizon has been tested in a Pop!_OS/COSMIC environment with Node.js 24.

## Installation

### 1. Obtain the source

Clone the Horizon repository:

```bash
git clone <repository-url> horizon
cd horizon
```

Replace `<repository-url>` with the actual repository address.

### 2. Install dependencies

```bash
npm ci
npm ci --prefix ui
```

### 3. Build the production interface

```bash
npm run build
```

The production interface is generated in `ui/dist/`. Keep this directory inside the project because the Horizon server serves the production interface from this path.

### 4. Validate the installation

```bash
npm run check
```

This performs TypeScript validation, automated tests and a production UI build.

### 5. Install Horizon services

```bash
bash scripts/install-user.sh
```

The installer checks required dependencies, generates three Horizon systemd user units, backs up existing service definitions and existing custom drop-ins, and enables the services under `graphical-session.target`.

**The installer does not automatically start the services.**

Preview the installation plan without changing anything:

```bash
bash scripts/install-user.sh --dry-run
```

### 6. Start Horizon

```bash
systemctl --user start \
  horizon-server.service \
  horizon-rotation.service \
  horizon-desktop.service
```

Check their status:

```bash
systemctl --user status horizon-server.service
systemctl --user status horizon-rotation.service
systemctl --user status horizon-desktop.service
```

The desktop service depends on the Horizon server.

## Managing Horizon

Horizon uses three systemd user services:

| Service | Responsibility |
|---|---|
| `horizon-server.service` | Local API and production interface |
| `horizon-rotation.service` | Automatic wallpaper rotation |
| `horizon-desktop.service` | Electron desktop interface |

### Check service status

```bash
systemctl --user is-active \
  horizon-server.service \
  horizon-rotation.service \
  horizon-desktop.service
```

### Restart Horizon

```bash
systemctl --user restart \
  horizon-server.service \
  horizon-rotation.service \
  horizon-desktop.service
```

### Stop Horizon

Stop dependants before the server:

```bash
systemctl --user stop horizon-desktop.service
systemctl --user stop horizon-rotation.service
systemctl --user stop horizon-server.service
```

### View logs

```bash
journalctl --user -u horizon-server.service -f
```

```bash
journalctl --user -u horizon-rotation.service -f
```

```bash
journalctl --user -u horizon-desktop.service -f
```

## Command-line interface

Show CLI usage:

```bash
npm run horizon -- --help
```

Available commands:

| Command | Description |
|---|---|
| `add <image>` | Add an image |
| `list` | List wallpapers |
| `status` | Display rotation status |
| `pause` | Pause rotation |
| `resume` | Resume rotation |
| `interval <minutes>` | Configure the rotation interval |
| `rotate [interval-minutes]` | Start wallpaper rotation |
| `render <image> [output-directory]` | Render a panoramic wallpaper |
| `apply <image>` | Apply a wallpaper |

Examples:

```bash
npm run horizon -- list
npm run horizon -- status
npm run horizon -- interval 10
```

## Local interface and API

The production interface and local API are served at:

- UI: `http://127.0.0.1:4179/`
- Wallpaper API: `http://127.0.0.1:4179/api/wallpapers`

The server binds to the loopback interface. These endpoints are intended for local access on the same machine.

## Storage and configuration

Horizon uses the following locations:

| Purpose | Location |
|---|---|
| Application settings | `~/.config/horizon/settings.json` |
| Wallpaper library | `~/.local/share/horizon/wallpapers` |
| Rendered wallpaper output | `~/.local/share/horizon/renders/` |
| Application state and backups | `~/.local/state/horizon/` |

Horizon also interacts with COSMIC wallpaper configuration under `~/.config/cosmic/`.

Back up important desktop configuration before experimenting with wallpaper application or display changes.

## Uninstallation

Preview the removal plan:

```bash
bash scripts/uninstall-user.sh --dry-run
```

Run the interactive uninstaller:

```bash
bash scripts/uninstall-user.sh
```

Or explicitly confirm removal:

```bash
bash scripts/uninstall-user.sh --yes
```

The uninstaller removes Horizon's systemd service integration and preserves:

- Horizon project files.
- Wallpapers and the wallpaper library.
- Horizon settings.
- Installation backups.
- Custom systemd drop-ins.

It creates a backup of the service definitions and their previous states before making changes.

**Uninstallation does not delete the Horizon project, application dependencies, wallpaper library or personal settings.**

## Manual development

For development without the systemd-managed services, first build the interface:

```bash
npm run build
```

Start the local server in one terminal:

```bash
npm run server
```

Start the Electron interface in another terminal:

```bash
npm run desktop
```

Stop manually launched processes with `Ctrl+C`.

Do not run manually launched server or desktop processes alongside the corresponding systemd-managed services. They may conflict over the local API port.

For UI development:

```bash
npm run dev --prefix ui
```

## Testing and validation

Run all primary application checks:

```bash
npm run check
```

Individual checks:

```bash
npm run typecheck
npm test
npm run build
```

The automated test suite includes multi-monitor geometry, panoramic cropping, monitor placement, invalid dimensions and COSMIC configuration synchronization.

Installer and uninstaller tests are available in `tests/installer/`:

```bash
bash tests/installer/run.sh
bash tests/installer/test-uninstall.sh
```

These installer tests use an isolated simulated systemd environment. They do not replace testing on a clean Linux installation.

## Troubleshooting

### The interface does not load

Check the server:

```bash
systemctl --user status horizon-server.service
curl -I http://127.0.0.1:4179/
```

Rebuild the interface if necessary:

```bash
npm run build
```

### Port 4179 is already occupied

Inspect the listener:

```bash
ss -ltnp '( sport = :4179 )'
```

Identify the process before attempting to stop it.

### Wallpaper application fails

Confirm that the COSMIC desktop session is active and the expected configuration exists.

Inspect rotation logs:

```bash
journalctl --user -u horizon-rotation.service -n 50 --no-pager
```

Inspect server logs:

```bash
journalctl --user -u horizon-server.service -n 50 --no-pager
```

### Electron displays a Wayland/Vulkan warning

A graphics-backend warning may appear even when the application launches successfully. Confirm whether the desktop actually fails before changing Electron's graphics configuration.

## Development status

Horizon is under active development.

The project currently targets Linux systems running COSMIC. Compatibility with other desktop environments and distributions requires additional testing.

The installation and uninstallation scripts provide user-level systemd integration with backup and rollback behaviour.

## Licensing

Horizon is released under the MIT License. See [LICENSE](LICENSE) for the full licence text.

## Contributing

Contribution guidelines, issue reporting instructions and release procedures will be added as the project prepares for public distribution.
