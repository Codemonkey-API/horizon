import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { discoverDisplays } from "./displays.js";
import { calculateLayout } from "./geometry.js";

export function renderWallpaper(sourceArg: string, outputArg: string) {
  const source = resolve(sourceArg);
  const output = resolve(outputArg);

  if (!existsSync(source)) {
    throw new Error(`Wallpaper image not found: ${source}`);
  }

  const metadata = execFileSync(
    "identify",
    ["-format", "%w %h", source],
    { encoding: "utf8" },
  ).trim();

  const [widthText, heightText] = metadata.split(/\s+/);
  const imageWidth = Number(widthText);
  const imageHeight = Number(heightText);

  if (
    !Number.isSafeInteger(imageWidth) ||
    !Number.isSafeInteger(imageHeight) ||
    imageWidth <= 0 ||
    imageHeight <= 0
  ) {
    throw new Error(`Could not determine valid image dimensions: ${source}`);
  }

  const displays = discoverDisplays();

  const layout = calculateLayout(
    { width: imageWidth, height: imageHeight },
    displays,
  );

  const { width: canvasWidth, height: canvasHeight } = layout.canvas;

  const preview = join(output, "panorama-preview.png");

  mkdirSync(output, { recursive: true });

  console.log(`Wallpaper: ${imageWidth}x${imageHeight}`);
  console.log(`Enabled displays: ${displays.length}`);

  for (const display of displays) {
    console.log(
      `  ${display.name}: ${display.width}x${display.height} at ${display.x},${display.y}`,
    );
  }

  console.log(`Calculated canvas: ${canvasWidth}x${canvasHeight}`);

  execFileSync("convert", [
    source,
    "-auto-orient",
    "-resize",
    `${canvasWidth}x${canvasHeight}^`,
    "-gravity",
    "center",
    "-extent",
    `${canvasWidth}x${canvasHeight}`,
    preview,
  ]);

  for (const slice of layout.slices) {
    const destination = join(output, `${slice.display}.png`);

    execFileSync("convert", [
      preview,
      "-crop",
      `${slice.width}x${slice.height}+${slice.x}+${slice.y}`,
      "+repage",
      destination,
    ]);

    console.log(`Rendered ${slice.display}: ${destination}`);
  }

  console.log("Horizon rendering complete 🌅");
  console.log(`Output folder: ${output}`);
}

const invokedFile = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";

if (import.meta.url === invokedFile) {
  const source =
    process.argv[2] ??
    join(
      process.env.HOME ?? ".",
      "Pictures/ubuntu-neon-logo-2560x1080-23495.jpg",
    );

  const output =
    process.argv[3] ?? join(process.cwd(), "tmp/panorama-test-ts");

  renderWallpaper(source, output);
}
