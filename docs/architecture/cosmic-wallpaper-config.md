# COSMIC Wallpaper Configuration: Engineering Invariant

**Discovered:** 24 November 2026
**Status:** Root cause verified; regression protection added.

## Incident

Horizon generated new panoramic renders and updated its base COSMIC
configuration, but the desktop continued displaying an older wallpaper.

The machine's system default theme mode was Dark (`is_dark = true`).
COSMIC had separate Base, Light and Dark wallpaper configuration directories.

Horizon only wrote to:

`~/.config/cosmic/com.system76.CosmicBackground/v1`

The Dark configuration still referenced renders from 19 November.
The Light configuration was stale as well.

Manually copying the fresh Base output configuration into the Dark
configuration immediately changed the desktop wallpaper. This verified
the configuration mismatch as the cause of the observed failure.

## Permanent invariant

Every successful Horizon wallpaper application must synchronize all
three supported COSMIC configuration contexts:

- `com.system76.CosmicBackground`
- `com.system76.CosmicBackground.Light`
- `com.system76.CosmicBackground.Dark`

Both monitor output files must reference the same render generation.

## Reliability requirements

1. Render both monitor images before modifying live configuration.
2. Validate all render files and all three configuration directories first.
3. Back up all three configurations before writing.
4. Verify backups before applying changes.
5. Write each configuration file atomically.
6. Verify written values.
7. If any update fails, restore all three configurations.
8. Report success only after all three contexts are synchronized.
9. Keep preview state distinct from actual desktop application state.

## Regression protection

Automated tests must cover all three configuration targets, both monitor
outputs, missing renders, incomplete configuration directories and backup
preservation.

Do not reintroduce a Base-only configuration writer.
