import { createServer } from "node:http";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { discoverDisplays } from "./displays.js";

const home = process.env.HOME ?? ".";
const collection = join(home, ".local/share/horizon/wallpapers");
const settingsPath = join(home, ".config/horizon/settings.json");
const port = 4179;

const serverDirectory = dirname(fileURLToPath(import.meta.url));
const sourceMode = extname(fileURLToPath(import.meta.url)) === ".ts";
const uiDist = resolve(
  process.env.HORIZON_UI_DIST ?? resolve(serverDirectory, "../ui/dist"),
);

function runHorizon(
  args: string[],
  options: {
    encoding: "utf8";
    timeout: number;
    maxBuffer: number;
  },
) {
  const cliEntry = resolve(serverDirectory, sourceMode ? "cli.ts" : "cli.js");

  const commandArgs = sourceMode
    ? [
        resolve(serverDirectory, "../node_modules/tsx/dist/cli.mjs"),
        cliEntry,
        ...args,
      ]
    : [cliEntry, ...args];

  return spawnSync(process.execPath, commandArgs, {
    ...options,
    env: {
      ...process.env,
      ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
    },
  });
}


const extensions = new Set([
  ".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff",
]);

function sendJson(res: import("node:http").ServerResponse, status: number, data: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}

type HorizonSettings = {
  intervalMinutes?: number;
  wallpaperFolders?: string[];
  rotationFolder?: string;
  lastAppliedWallpaper?: string;
};

function readSettings(): HorizonSettings {
  try {
    return JSON.parse(readFileSync(settingsPath, "utf8")) as HorizonSettings;
  } catch {
    return {};
  }
}

function saveSettings(settings: HorizonSettings) {
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
}

function registeredFolders(): string[] {
  const settings = readSettings();
  const candidates = [
    collection,
    ...(Array.isArray(settings.wallpaperFolders) ? settings.wallpaperFolders : []),
  ];
  const folders: string[] = [];

  for (const candidate of candidates) {
    if (typeof candidate !== "string" || !candidate) continue;
    try {
      const canonical = realpathSync(resolve(candidate));
      if (statSync(canonical).isDirectory() && !folders.includes(canonical)) {
        folders.push(canonical);
      }
    } catch {
      // Missing folders are skipped until they exist again.
    }
  }

  return folders;
}

function isRegisteredWallpaper(candidate: string): string | null {
  if (!candidate || !extensions.has(extname(candidate).toLowerCase())) return null;

  try {
    const canonical = realpathSync(resolve(candidate));
    if (!statSync(canonical).isFile()) return null;
    const parent = dirname(canonical);
    if (!registeredFolders().includes(parent)) return null;
    return canonical;
  } catch {
    return null;
  }
}

function getWallpapers() {
  const wallpapers: Array<{
    id: string;
    name: string;
    path: string;
    width: number | null;
    height: number | null;
    url: string;
  }> = [];

  for (const folder of registeredFolders()) {
    let entries;
    try {
      entries = readdirSync(folder, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isFile() || !extensions.has(extname(entry.name).toLowerCase())) continue;

      const candidate = join(folder, entry.name);
      const path = isRegisteredWallpaper(candidate);
      if (!path) continue;

      let width: number | null = null;
      let height: number | null = null;

      try {
        const dimensions = execFileSync(
          "identify",
          ["-ping", "-format", "%w %h", path],
          { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] },
        ).trim().split(/\s+/);

        width = Number(dimensions[0]);
        height = Number(dimensions[1]);

        if (!Number.isFinite(width) || !Number.isFinite(height)) {
          width = null;
          height = null;
        }
      } catch {
        // Keep the file visible even if its metadata cannot be read.
      }

      wallpapers.push({
        id: path,
        name: entry.name,
        path,
        width,
        height,
        url: `/api/wallpapers/file?path=${encodeURIComponent(path)}`,
      });
    }
  }

  return wallpapers.sort((a, b) =>
    a.name.localeCompare(b.name) || a.path.localeCompare(b.path),
  );
}
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);

  try {
    if (req.method === "GET" && url.pathname === "/api/wallpapers") {
      sendJson(res, 200, { wallpapers: getWallpapers() });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/wallpapers/current") {
      const settings = readSettings();
      const path = settings.lastAppliedWallpaper;

      sendJson(res, 200, {
        path: typeof path === "string" && existsSync(path) ? path : null,
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/wallpaper-folders") {
      const settings = readSettings();
      sendJson(res, 200, {
        folders: registeredFolders().filter((folder) => folder !== resolve(collection)),
        defaultFolder: resolve(collection),
        configuredFolders: Array.isArray(settings.wallpaperFolders)
          ? settings.wallpaperFolders
          : [],
      });
      return;
    }

    if (
      (req.method === "POST" || req.method === "DELETE")
      && url.pathname === "/api/wallpaper-folders"
    ) {
      let body = "";
      for await (const chunk of req) {
        body += chunk.toString();
        if (body.length > 8192) {
          sendJson(res, 413, { error: "Request body too large." });
          return;
        }
      }

      let requested: unknown;
      try {
        requested = (JSON.parse(body) as { path?: unknown }).path;
      } catch {
        sendJson(res, 400, { error: "Invalid JSON request." });
        return;
      }

      if (typeof requested !== "string" || !requested.trim()) {
        sendJson(res, 400, { error: "Enter a folder path." });
        return;
      }

      const expanded = requested.trim().startsWith("~/")
        ? join(home, requested.trim().slice(2))
        : requested.trim();

      let folder: string;
      try {
        folder = realpathSync(resolve(expanded));
        if (!statSync(folder).isDirectory()) throw new Error("Not a directory.");
      } catch {
        sendJson(res, 400, { error: "That folder does not exist or is not accessible." });
        return;
      }

      if (folder === resolve(collection)) {
        sendJson(res, 400, { error: "The default Horizon collection is always included." });
        return;
      }

      const settings = readSettings();
      const configured = Array.isArray(settings.wallpaperFolders)
        ? settings.wallpaperFolders.filter((item): item is string => typeof item === "string")
        : [];

      if (req.method === "POST") {
        if (!configured.includes(folder)) configured.push(folder);
        saveSettings({ ...settings, wallpaperFolders: configured });
        sendJson(res, 200, {
          success: true,
          folders: registeredFolders().filter((item) => item !== resolve(collection)),
          message: "Wallpaper folder registered. New images will be discovered automatically.",
        });
      } else {
        saveSettings({
          ...settings,
          wallpaperFolders: configured.filter((item) => {
            try {
              return realpathSync(resolve(item)) !== folder;
            } catch {
              return resolve(item) !== folder;
            }
          }),
        });
        sendJson(res, 200, {
          success: true,
          folders: registeredFolders().filter((item) => item !== resolve(collection)),
          message: "Folder removed from Horizon. Your files were not changed.",
        });
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/wallpapers/file") {
      const requested = url.searchParams.get("path") ?? "";
      const path = isRegisteredWallpaper(requested);

      if (!path) {
        sendJson(res, 404, { error: "Wallpaper not found in a registered folder." });
        return;
      }

      const types: Record<string, string> = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".bmp": "image/bmp",
        ".tif": "image/tiff",
        ".tiff": "image/tiff",
      };

      res.writeHead(200, {
        "Content-Type": types[extname(path).toLowerCase()] ?? "application/octet-stream",
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
      });
      createReadStream(path).pipe(res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/displays") {
      sendJson(res, 200, { displays: discoverDisplays() });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/rotation/status") {
      const result = spawnSync(
        "systemctl",
        ["--user", "is-active", "horizon-rotation.service"],
        { encoding: "utf8", timeout: 5000 },
      );

      const status = result.status === 0
        ? "active"
        : (result.stdout?.trim() || "inactive");

      let intervalMinutes = 1;
      try {
        const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as {
          intervalMinutes?: number;
        };
        if (
          Number.isInteger(settings.intervalMinutes)
          && settings.intervalMinutes! >= 1
          && settings.intervalMinutes! <= 1440
        ) {
          intervalMinutes = settings.intervalMinutes!;
        }
      } catch {
        // The CLI's default interval is one minute if no setting is saved.
      }

      const settings = readSettings();
      sendJson(res, 200, {
        status,
        intervalMinutes,
        folders: registeredFolders(),
        defaultFolder: resolve(collection),
        rotationFolder: settings.rotationFolder || resolve(collection),
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/rotation/folder") {
      let body = "";
      for await (const chunk of req) {
        body += chunk.toString();
        if (body.length > 8192) {
          sendJson(res, 413, { error: "Request body too large." });
          return;
        }
      }

      let requested: unknown;
      try {
        requested = (JSON.parse(body) as { folder?: unknown }).folder;
      } catch {
        sendJson(res, 400, { error: "Invalid JSON request." });
        return;
      }

      if (typeof requested !== "string") {
        sendJson(res, 400, { error: "Choose a registered folder." });
        return;
      }

      const folder = resolve(requested);
      const allowed = registeredFolders().some((item) => resolve(item) === folder);
      if (!allowed) {
        sendJson(res, 400, { error: "That folder is not registered with Horizon." });
        return;
      }

      const settings = readSettings();
      saveSettings({ ...settings, rotationFolder: folder });

      const active = spawnSync(
        "systemctl",
        ["--user", "is-active", "--quiet", "horizon-rotation.service"],
        { encoding: "utf8", timeout: 5000 },
      );

      if (active.status === 0) {
        const restarted = spawnSync(
          "systemctl",
          ["--user", "restart", "horizon-rotation.service"],
          { encoding: "utf8", timeout: 30000 },
        );
        if (restarted.error || restarted.status !== 0) {
          sendJson(res, 500, {
            error: "Folder saved, but rotation could not restart. Try resuming rotation.",
          });
          return;
        }
      }

      sendJson(res, 200, {
        success: true,
        rotationFolder: folder,
        message: "Rotation folder saved.",
      });
      return;
    }

    if (
      req.method === "POST"
      && url.pathname === "/api/rotation/interval"
    ) {
      let body = "";
      for await (const chunk of req) {
        body += chunk.toString();
        if (body.length > 8192) {
          sendJson(res, 413, { error: "Request body too large." });
          return;
        }
      }

      let minutes: unknown;
      try {
        minutes = (JSON.parse(body) as { minutes?: unknown }).minutes;
      } catch {
        sendJson(res, 400, { error: "Invalid JSON request." });
        return;
      }

      if (
        typeof minutes !== "number"
        || !Number.isInteger(minutes)
        || minutes < 1
        || minutes > 1440
      ) {
        sendJson(res, 400, {
          error: "Choose a whole-number interval from 1 to 1440 minutes.",
        });
        return;
      }

      const result = runHorizon(
        ["interval", String(minutes)],
        { encoding: "utf8", timeout: 120000, maxBuffer: 1024 * 1024 },
      );

      if (result.error || result.status !== 0) {
        sendJson(res, 500, {
          error: "Could not save the rotation interval.",
          details: (result.stderr || result.error?.message || result.stdout || "").slice(-3000),
        });
        return;
      }

      sendJson(res, 200, {
        success: true,
        intervalMinutes: minutes,
        message: `Rotation interval saved: ${minutes} minute(s).`,
      });
      return;
    }

    if (
      req.method === "POST"
      && (
        url.pathname === "/api/rotation/pause"
        || url.pathname === "/api/rotation/resume"
      )
    ) {
      const action = url.pathname.endsWith("/pause") ? "pause" : "resume";
      const result = runHorizon(
        [action],
        { encoding: "utf8", timeout: 30000, maxBuffer: 1024 * 1024 },
      );

      if (result.error || result.status !== 0) {
        sendJson(res, 500, {
          error: `Could not ${action} Horizon rotation.`,
          details: (result.stderr || result.error?.message || result.stdout || "").slice(-3000),
        });
        return;
      }

      sendJson(res, 200, {
        success: true,
        status: action === "pause" ? "inactive" : "active",
        message: action === "pause"
          ? "Horizon rotation paused."
          : "Horizon rotation resumed.",
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/wallpapers/apply") {
      let body = "";

      for await (const chunk of req) {
        body += chunk.toString();
        if (body.length > 8192) {
          sendJson(res, 413, { error: "Request body too large." });
          return;
        }
      }

      let requestedPath: unknown;
      try {
        requestedPath = (JSON.parse(body) as { path?: unknown }).path;
      } catch {
        sendJson(res, 400, { error: "Invalid JSON request." });
        return;
      }

      if (typeof requestedPath !== "string" || !requestedPath) {
        sendJson(res, 400, { error: "Choose a valid wallpaper." });
        return;
      }

      const path = isRegisteredWallpaper(requestedPath);
      if (!path) {
        sendJson(res, 404, { error: "That wallpaper is not in a registered Horizon folder." });
        return;
      }

      const result = runHorizon(
        ["apply", path],
        { encoding: "utf8", timeout: 120000, maxBuffer: 4 * 1024 * 1024 },
      );

      if (result.error || result.status !== 0) {
        sendJson(res, 500, {
          error: "Horizon could not apply this wallpaper. Your engine reported a failure.",
          details: (result.stderr || result.error?.message || result.stdout || "").slice(-5000),
        });
        return;
      }

      saveSettings({
        ...readSettings(),
        lastAppliedWallpaper: path,
      });

      sendJson(res, 200, {
        success: true,
        message: "Wallpaper applied successfully.",
        details: (result.stdout ?? "").slice(-5000),
      });
      return;
    }

    // Serve the built React UI from ui/dist in production.
    if (req.method === "GET" && !url.pathname.startsWith("/api/")) {

      const mimeTypes: Record<string, string> = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".mjs": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".ico": "image/x-icon",
        ".woff": "font/woff",
        ".woff2": "font/woff2",
      };

      let decodedPath: string;
      try {
        decodedPath = decodeURIComponent(url.pathname);
      } catch {
        sendJson(res, 400, { error: "Invalid URL path." });
        return;
      }

      const relativePath = decodedPath.replace(/^\/+/, "");
      let filePath = resolve(uiDist, relativePath || "index.html");

      // Never allow a URL to escape the production UI directory.
      if (filePath !== uiDist && !filePath.startsWith(uiDist + sep)) {
        sendJson(res, 403, { error: "Forbidden path." });
        return;
      }

      if (existsSync(filePath) && statSync(filePath).isDirectory()) {
        filePath = join(filePath, "index.html");
      }

      // Frontend routes fall back to index.html; missing assets do not.
      if (!existsSync(filePath) || !statSync(filePath).isFile()) {
        if (extname(relativePath)) {
          sendJson(res, 404, { error: "UI asset not found." });
          return;
        }
        filePath = join(uiDist, "index.html");
      }

      if (!existsSync(filePath) || !statSync(filePath).isFile()) {
        sendJson(res, 503, {
          error: "Production UI not built. Run the UI build first.",
        });
        return;
      }

      res.writeHead(200, {
        "Content-Type": mimeTypes[extname(filePath).toLowerCase()]
          ?? "application/octet-stream",
        "Cache-Control": filePath.endsWith("index.html")
          ? "no-cache"
          : "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      });
      createReadStream(filePath).pipe(res);
      return;
    }

    sendJson(res, 404, { error: "Horizon API route not found." });
  } catch (error) {
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : "Unexpected Horizon API error.",
    });
  }
});

export function startServer(): Promise<void> {
  return new Promise((resolveStart, rejectStart) => {
    server.once("error", rejectStart);

    server.listen(port, "127.0.0.1", () => {
      server.off("error", rejectStart);
      console.log(`Horizon local API listening on http://127.0.0.1:${port}`);
      console.log(`Wallpaper library: ${collection}`);
      resolveStart();
    });
  });
}

export function stopServer(): Promise<void> {
  return new Promise((resolveStop, rejectStop) => {
    if (!server.listening) {
      resolveStop();
      return;
    }

    server.close((error) => {
      if (error) {
        rejectStop(error);
      } else {
        resolveStop();
      }
    });
  });
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isDirectExecution) {
  void startServer().catch((error: unknown) => {
    console.error("Horizon API failed to start:", error);
    process.exitCode = 1;
  });
}
