import test from "node:test";
import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyCosmicWallpaperConfig,
  buildOutputConfig,
} from "./cosmic-config.js";

const targets = [
  ".config/cosmic/com.system76.CosmicBackground/v1",
  ".config/cosmic/com.system76.CosmicBackground.Light/v1",
  ".config/cosmic/com.system76.CosmicBackground.Dark/v1",
];

const requiredFiles = [
  "all",
  "backgrounds",
  "same-on-all",
  "output.HDMI-A-1",
  "output.HDMI-A-2",
];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "horizon-cosmic-test-"));
  const home = join(root, "home");
  const backupRoot = join(root, "backup");
  const left = join(root, "HDMI-A-1.png");
  const right = join(root, "HDMI-A-2.png");

  writeFileSync(left, "left-render");
  writeFileSync(right, "right-render");

  for (const target of targets) {
    const directory = join(home, target);
    mkdirSync(directory, { recursive: true });

    for (const file of requiredFiles) {
      writeFileSync(join(directory, file), `original-${file}\n`);
    }
  }

  return { root, home, backupRoot, left, right };
}

test("builds output configuration for the requested monitor", () => {
  const config = buildOutputConfig("HDMI-A-1", "/tmp/left.png");

  assert.match(config, /output: "HDMI-A-1"/);
  assert.match(config, /source: Path\("\/tmp\/left\.png"\)/);
  assert.match(config, /scaling_mode: Stretch/);
});

test("synchronizes Base, Light and Dark with both fresh renders", () => {
  const f = fixture();

  try {
    applyCosmicWallpaperConfig(f);

    for (const target of targets) {
      const directory = join(f.home, target);

      assert.match(
        readFileSync(join(directory, "output.HDMI-A-1"), "utf8"),
        new RegExp(f.left.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      );

      assert.match(
        readFileSync(join(directory, "output.HDMI-A-2"), "utf8"),
        new RegExp(f.right.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      );

      assert.equal(
        readFileSync(join(directory, "same-on-all"), "utf8"),
        "false\n",
      );

      assert.equal(
        readFileSync(join(directory, "backgrounds"), "utf8"),
        '["HDMI-A-1", "HDMI-A-2"]\n',
      );

      for (const file of requiredFiles) {
        assert.ok(
          existsSync(join(f.backupRoot, "config", target.split("/").at(-2) === "v1"
            ? target.includes(".Light/") ? "light"
              : target.includes(".Dark/") ? "dark" : "base"
            : "base", file)),
        );
      }
    }
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("backs up every original configuration before replacing it", () => {
  const f = fixture();

  try {
    const originals = targets.map((target) =>
      requiredFiles.map((file) =>
        readFileSync(join(f.home, target, file), "utf8"),
      ),
    );

    applyCosmicWallpaperConfig(f);

    for (let index = 0; index < targets.length; index++) {
      const name = index === 0 ? "base" : index === 1 ? "light" : "dark";

      requiredFiles.forEach((file, fileIndex) => {
        assert.equal(
          readFileSync(join(f.backupRoot, "config", name, file), "utf8"),
          originals[index]?.[fileIndex],
        );
      });
    }
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("rejects missing renders without changing any configuration", () => {
  const f = fixture();

  try {
    const before = targets.map((target) =>
      requiredFiles.map((file) =>
        readFileSync(join(f.home, target, file), "utf8"),
      ),
    );

    assert.throws(
      () => applyCosmicWallpaperConfig({ ...f, right: join(f.root, "missing.png") }),
      /Both rendered monitor images must exist/,
    );

    targets.forEach((target, index) => {
      requiredFiles.forEach((file, fileIndex) => {
        assert.equal(
          readFileSync(join(f.home, target, file), "utf8"),
          before[index]?.[fileIndex],
        );
      });
    });
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("rejects an incomplete theme configuration before modifying Base", () => {
  const f = fixture();

  try {
    rmSync(join(f.home, targets[2]!, "output.HDMI-A-2"));

    const baseBefore = requiredFiles.map((file) =>
      readFileSync(join(f.home, targets[0]!, file), "utf8"),
    );

    assert.throws(
      () => applyCosmicWallpaperConfig(f),
      /Required COSMIC setting is missing/,
    );

    requiredFiles.forEach((file, index) => {
      assert.equal(
        readFileSync(join(f.home, targets[0]!, file), "utf8"),
        baseBefore[index],
      );
    });
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
