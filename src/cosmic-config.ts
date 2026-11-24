import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const requiredFiles = [
  "all",
  "backgrounds",
  "same-on-all",
  "output.HDMI-A-1",
  "output.HDMI-A-2",
];

const targets = [
  {
    name: "base",
    path: ".config/cosmic/com.system76.CosmicBackground/v1",
  },
  {
    name: "light",
    path: ".config/cosmic/com.system76.CosmicBackground.Light/v1",
  },
  {
    name: "dark",
    path: ".config/cosmic/com.system76.CosmicBackground.Dark/v1",
  },
] as const;

export interface CosmicApplyOptions {
  home: string;
  left: string;
  right: string;
  backupRoot: string;
}

export function buildOutputConfig(name: string, path: string): string {
  return `(
    output: "${name}",
    source: Path("${path}"),
    filter_by_theme: false,
    rotation_frequency: 300,
    filter_method: Lanczos,
    scaling_mode: Stretch,
    sampling_method: Alphanumeric,
)
`;
}

function atomicWrite(target: string, content: string): void {
  const temporary = `${target}.horizon-tmp`;

  try {
    writeFileSync(temporary, content);
    renameSync(temporary, target);

    if (readFileSync(target, "utf8") !== content) {
      throw new Error(`Configuration verification failed: ${target}`);
    }
  } catch (error) {
    throw new Error(
      `Could not safely write ${target}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export function applyCosmicWallpaperConfig(
  options: CosmicApplyOptions,
): void {
  const { home, left, right, backupRoot } = options;

  if (!existsSync(left) || !existsSync(right)) {
    throw new Error("Both rendered monitor images must exist before applying.");
  }

  const configurations = targets.map((target) => ({
    ...target,
    directory: join(home, target.path),
  }));

  // Validate every target before changing any configuration.
  for (const target of configurations) {
    if (!existsSync(target.directory)) {
      throw new Error(`COSMIC configuration not found: ${target.directory}`);
    }

    for (const file of requiredFiles) {
      if (!existsSync(join(target.directory, file))) {
        throw new Error(
          `Required COSMIC setting is missing: ${join(target.directory, file)}`,
        );
      }
    }
  }

  const backupConfig = join(backupRoot, "config");
  mkdirSync(backupConfig, { recursive: true });

  // Back up and verify all three configurations before writing anything.
  for (const target of configurations) {
    const saved = join(backupConfig, target.name);
    cpSync(target.directory, saved, { recursive: true });

    for (const file of requiredFiles) {
      const original = readFileSync(join(target.directory, file));
      const copy = readFileSync(join(saved, file));

      if (!original.equals(copy)) {
        throw new Error(
          `Backup verification failed for ${target.name}/${file}. Nothing was applied.`,
        );
      }
    }
  }

  console.log(`Verified all COSMIC configuration backups: ${backupConfig}`);

  const updates: Record<string, string> = {
    "same-on-all": "true\n",
    "output.HDMI-A-1": buildOutputConfig("HDMI-A-1", left),
    "output.HDMI-A-2": buildOutputConfig("HDMI-A-2", right),
    backgrounds: '["HDMI-A-1", "HDMI-A-2"]\n',
  };

  try {
    for (const target of configurations) {
      for (const [file, content] of Object.entries(updates)) {
        atomicWrite(join(target.directory, file), content);
      }

      // Enable independent monitor outputs after both are configured.
      atomicWrite(join(target.directory, "same-on-all"), "false\n");
    }

    console.log("All three COSMIC configurations synchronized.");
  } catch (error) {
    console.error("Configuration update failed. Restoring all configurations.");

    const rollbackErrors: string[] = [];

    for (const target of configurations) {
      try {
        cpSync(
          join(backupConfig, target.name),
          target.directory,
          { recursive: true },
        );
      } catch (rollbackError) {
        rollbackErrors.push(
          `${target.name}: ${
            rollbackError instanceof Error
              ? rollbackError.message
              : String(rollbackError)
          }`,
        );
      }
    }

    if (rollbackErrors.length > 0) {
      throw new Error(
        `Apply failed and rollback was incomplete: ${rollbackErrors.join("; ")}`,
        { cause: error },
      );
    }

    throw new Error("Apply failed. All COSMIC configurations were restored.", {
      cause: error,
    });
  }
}
