# Horizon Installer Tests

Installation tests must verify:

1. Fresh installation.
2. Existing installation migration.
3. Backup creation and restoration.
4. Correct graphical-session target enablement.
5. Desktop dependency on the Horizon server.
6. Preservation of custom systemd drop-ins.
7. Safe uninstallation.
8. Preservation of user settings and wallpaper libraries.
9. Failure recovery without partial installation.
10. Dry-run operations make no system changes.

Tests must use an isolated temporary HOME and must not modify
the user's active Horizon services.
