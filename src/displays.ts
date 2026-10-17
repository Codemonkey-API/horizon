import { execFileSync } from "node:child_process";
import type { Display } from "./geometry.js";

export function discoverDisplays(): Display[] {
  const raw = execFileSync("cosmic-randr", ["list"], {
    encoding: "utf8",
  });

  // Remove ANSI terminal styling before parsing display information.
  const result = raw.replace(
    /\x1B(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g,
    "",
  );

  const displays: Display[] = [];
  let current:
    | (Partial<Display> & { name: string; enabled: boolean })
    | undefined;

  const finishDisplay = () => {
    if (!current?.enabled) return;

    const { name, x, y, width, height } = current;

    if (
      x === undefined ||
      y === undefined ||
      width === undefined ||
      height === undefined ||
      width <= 0 ||
      height <= 0
    ) {
      throw new Error(`Incomplete display information for ${name}.`);
    }

    displays.push({ name, x, y, width, height });
  };

  for (const line of result.split(/\r?\n/)) {
    const header = line.match(/^(\S+) \((enabled|disabled)\)$/);

    if (header) {
      finishDisplay();

      const name = header[1];
      const status = header[2];

      if (!name || !status) {
        throw new Error(`Could not parse display header: ${line}`);
      }

      current = {
        name,
        enabled: status === "enabled",
      };
      continue;
    }

    if (!current?.enabled) continue;

    const position = line.match(/^\s+Position:\s*(-?\d+),\s*(-?\d+)/);

    if (position) {
      current.x = Number(position[1]);
      current.y = Number(position[2]);
      continue;
    }

    const mode = line.match(/^\s+(\d+)x(\d+)\s+@.*\(current\)/);

    if (mode) {
      current.width = Number(mode[1]);
      current.height = Number(mode[2]);
    }
  }

  finishDisplay();

  if (displays.length === 0) {
    throw new Error("No enabled displays with current modes were found.");
  }

  const names = new Set(displays.map((display) => display.name));

  if (names.size !== displays.length) {
    throw new Error("Duplicate display names were detected.");
  }

  return displays;
}
