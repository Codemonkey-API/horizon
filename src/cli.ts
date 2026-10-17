import { spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import {
  cpSync,
  existsSync,
  mkdirSync,
  renameSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { renderWallpaper } from "./render.js";

const home = process.env.HOME ?? ".";
const action = process.argv[2];
const source = process.argv[3];
const collection = join(home, ".local/share/horizon/wallpapers");
const settingsPath = join(home, ".config/horizon/settings.json");

const supportedExtensions = new Set([
  ".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff",
]);

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function usage(): never {
  console.log(`
Horizon 🌅

Commands:
  npm run horizon -- add <image>
  npm run horizon -- list
  npm run horizon -- status
  npm run horizon -- pause
  npm run horizon -- resume
  npm run horizon -- interval <minutes>
  npm run horizon -- rotate [interval-minutes]
  npm run horizon -- render <image> [output-directory]
  npm run horizon -- apply <image>
`);
  process.exit(1);
}

if (!action) usage();

if (action === "status") {
  spawnSync(
    "systemctl",
    ["--user", "status", "horizon-rotation.service", "--no-pager"],
    { stdio: "inherit" },
  );
  process.exit(0);
}

if (action === "pause" || action === "resume") {
  const operation = action === "pause" ? "stop" : "start";
  const result = spawnSync(
    "systemctl",
    ["--user", operation, "horizon-rotation.service"],
    { stdio: "inherit" },
  );

  if (result.status !== 0) {
    throw new Error(`Could not ${action} Horizon rotation.`);
  }

  console.log(action === "pause"
    ? "Horizon rotation paused."
    : "Horizon rotation resumed.");
  process.exit(0);
}

if (action === "interval") {
  const minutes = Number(source);

  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) {
    throw new Error("Choose an interval from 1 to 1440 minutes.");
  }

  mkdirSync(join(home, ".config/horizon"), { recursive: true });
  let existingSettings: Record<string, unknown> = {};
  try {
    existingSettings = JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
  } catch {
    // Start with defaults when no settings file exists yet.
  }
  writeFileSync(
    settingsPath,
    JSON.stringify({ ...existingSettings, intervalMinutes: minutes }, null, 2) + "\n",
  );

  const active = spawnSync(
    "systemctl",
    ["--user", "is-active", "--quiet", "horizon-rotation.service"],
  );

  if (active.status === 0) {
    const restarted = spawnSync(
      "systemctl",
      ["--user", "restart", "horizon-rotation.service"],
      { stdio: "inherit" },
    );

    if (restarted.status !== 0) {
      throw new Error("Saved the interval, but could not restart Horizon.");
    }
  }

  console.log(`Horizon interval set to ${minutes} minute(s).`);
  process.exit(0);
}

if (action === "list") {
  mkdirSync(collection, { recursive: true });

  const images = readdirSync(collection)
    .filter((name) => supportedExtensions.has(
      name.slice(name.lastIndexOf(".")).toLowerCase(),
    ))
    .sort((a, b) => a.localeCompare(b));

  if (images.length === 0) {
    console.log("Your Horizon collection is empty. Add a wallpaper with the add command.");
  } else {
    console.log(`Horizon collection: ${images.length} wallpaper(s)`);
    for (const [index, name] of images.entries()) {
      console.log(`  ${index + 1}. ${name}`);
    }
  }

  process.exit(0);
}

if (action === "add") {
  if (!source) usage();

  const image = resolve(source);

  if (!existsSync(image)) {
    throw new Error(`Image not found: ${image}`);
  }

  const extension = image.slice(image.lastIndexOf(".")).toLowerCase();

  if (!supportedExtensions.has(extension)) {
    throw new Error(`Unsupported image format: ${extension}`);
  }

  mkdirSync(collection, { recursive: true });

  const destination = join(collection, basename(image));

  if (existsSync(destination)) {
    throw new Error(
      `A file named "${basename(image)}" is already in the collection. Rename the new file before adding it.`,
    );
  }

  cpSync(image, destination);
  console.log(`Added to Horizon: ${destination}`);
  process.exit(0);
}

if (action === "rotate") {
  const settings = existsSync(settingsPath)
    ? JSON.parse(readFileSync(settingsPath, "utf8")) as {
        intervalMinutes?: number;
        wallpaperFolders?: string[];
        rotationFolder?: string;
        lastAppliedWallpaper?: string;
      }
    : {};

  const intervalMinutes = Number(
    process.argv[3] ?? settings.intervalMinutes ?? "1",
  );

  if (
    !Number.isFinite(intervalMinutes)
    || intervalMinutes < 1
    || intervalMinutes > 1440
  ) {
    throw new Error("Choose a rotation interval from 1 to 1440 minutes.");
  }

  mkdirSync(collection, { recursive: true });

  function discoverWallpapers(): string[] {
    const selectedFolder = typeof settings.rotationFolder === "string"
      ? resolve(settings.rotationFolder)
      : resolve(collection);
    const folders = [selectedFolder];
    const images = new Set<string>();

    for (const folder of folders) {
      try {
        for (const entry of readdirSync(folder, { withFileTypes: true })) {
          if (!entry.isFile()) continue;
          if (!supportedExtensions.has(entry.name.slice(entry.name.lastIndexOf(".")).toLowerCase())) continue;
          if (/^HDMI-A-\d+\.png$/i.test(entry.name)) continue;
          images.add(resolve(folder, entry.name));
        }
      } catch {
        // An unavailable registered folder does not stop rotation.
      }
    }

    return [...images].sort((a, b) => a.localeCompare(b));
  }

  console.log("Horizon live rotation started 🌅");
  console.log(`Rotation folder: ${typeof settings.rotationFolder === "string" ? settings.rotationFolder : resolve(collection)}`);
  console.log(`Interval: ${intervalMinutes} minute(s)`);
  console.log("New wallpapers are discovered automatically.\n");

  let lastAppliedPath: string | undefined =
    typeof settings.lastAppliedWallpaper === "string"
      ? settings.lastAppliedWallpaper
      : undefined;

  while (true) {
    // Pick up a wallpaper applied manually while rotation is running.
    let externallyAppliedPath: string | undefined;
    try {
      const latestSettings = existsSync(settingsPath)
        ? JSON.parse(readFileSync(settingsPath, "utf8")) as { lastAppliedWallpaper?: string }
        : {};
      if (typeof latestSettings.lastAppliedWallpaper === "string") {
        externallyAppliedPath = latestSettings.lastAppliedWallpaper;
      }
    } catch {
      // Keep the in-memory cursor if settings cannot be read.
    }

    // Refresh the list every cycle so new files are discovered.
    const images = discoverWallpapers();
    if (externallyAppliedPath && images.includes(externallyAppliedPath)) {
      lastAppliedPath = externallyAppliedPath;
    }

    if (images.length === 0) {
      console.log("No wallpapers found. Checking again after the interval.");
      await sleep(intervalMinutes * 60_000);
      continue;
    }

    const lastIndex = lastAppliedPath
      ? images.indexOf(lastAppliedPath)
      : -1;

    const nextIndex = lastIndex >= 0
      ? (lastIndex + 1) % images.length
      : 0;

    const wallpaper = images[nextIndex];

    if (wallpaper === undefined) {
      await sleep(intervalMinutes * 60_000);
      continue;
    }

    console.log(`\nApplying wallpaper: ${basename(wallpaper)}`);
    console.log(`Source: ${wallpaper}`);
    console.log(`Available wallpapers: ${images.length}`);

    const result = spawnSync(
      "npm",
      ["run", "horizon", "--", "apply", wallpaper],
      { stdio: "inherit" },
    );

    if (result.error) {
      console.error(`Could not launch wallpaper application: ${result.error.message}`);
    } else if (result.status === 0) {
      lastAppliedPath = wallpaper;
      try {
        const latest = existsSync(settingsPath)
          ? JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>
          : {};
        writeFileSync(
          settingsPath,
          JSON.stringify({ ...latest, lastAppliedWallpaper: wallpaper }, null, 2) + "\n",
        );
      } catch (error) {
        console.error("Wallpaper applied, but its rotation position could not be saved.");
      }
      console.log(`Successfully applied: ${basename(wallpaper)}`);
    } else {
      console.error(`Could not apply "${basename(wallpaper)}". The last successful wallpaper remains unchanged.`);
    }

    console.log(`Next scan and switch in ${intervalMinutes} minute(s).`);
    await sleep(intervalMinutes * 60_000);
  }
}

if (!source) usage();

const image = resolve(source);

if (!existsSync(image)) {
  throw new Error(`Image not found: ${image}`);
}

if (action === "render") {
  const output = resolve(
    process.argv[4] ?? join(process.cwd(), "tmp/horizon-render"),
  );

  renderWallpaper(image, output);
  process.exit(0);
}

if (action !== "apply") usage();

const config = join(
  home,
  ".config/cosmic/com.system76.CosmicBackground/v1",
);
const state = join(home, ".local/state/horizon");
const renderDir = join(
  home,
  ".local/share/horizon/renders",
  timestamp(),
);
const backup = join(state, "backups", `apply-${timestamp()}`);

if (!existsSync(config)) {
  throw new Error(`COSMIC configuration not found: ${config}`);
}

const requiredFiles = [
  "all",
  "backgrounds",
  "same-on-all",
  "output.HDMI-A-1",
  "output.HDMI-A-2",
];

for (const file of requiredFiles) {
  if (!existsSync(join(config, file))) {
    throw new Error(`Required COSMIC setting is missing: ${file}`);
  }
}

// Render before touching live desktop settings.
renderWallpaper(image, renderDir);

mkdirSync(backup, { recursive: true });

const backupConfig = join(backup, "config");
cpSync(config, backupConfig, { recursive: true });

// Verify every required setting was copied byte-for-byte.
for (const file of requiredFiles) {
  const original = join(config, file);
  const saved = join(backupConfig, file);

  if (
    !existsSync(saved) ||
    !readFileSync(original).equals(readFileSync(saved))
  ) {
    throw new Error(`Backup verification failed for ${file}. Nothing was applied.`);
  }
}

console.log(`Verified configuration backup: ${backupConfig}`);

const left = join(renderDir, "HDMI-A-1.png");
const right = join(renderDir, "HDMI-A-2.png");

const outputConfig = (name: string, path: string) => `(
    output: "${name}",
    source: Path("${path}"),
    filter_by_theme: false,
    rotation_frequency: 300,
    filter_method: Lanczos,
    scaling_mode: Stretch,
    sampling_method: Alphanumeric,
)
`;

function writeConfig(name: string, content: string) {
  const target = join(config, name);
  const temporary = `${target}.horizon-tmp`;

  writeFileSync(temporary, content);
  renameSync(temporary, target);
}

try {
  // Pause independent outputs while the new panels are configured.
  writeConfig("same-on-all", "true\n");

  writeConfig("output.HDMI-A-1", outputConfig("HDMI-A-1", left));
  writeConfig("output.HDMI-A-2", outputConfig("HDMI-A-2", right));
  writeConfig("backgrounds", '["HDMI-A-1", "HDMI-A-2"]\n');

  // Enable the two prepared panels together as the final configuration step.
  writeConfig("same-on-all", "false\n");

  console.log("\nHorizon applied successfully 🌅");
  console.log(`Backup: ${backup}`);
  console.log(`Rendered panels: ${renderDir}`);
} catch (error) {
  console.error("Apply failed. Restoring the saved COSMIC settings.");

  cpSync(backupConfig, config, { recursive: true });
  throw error;
}
