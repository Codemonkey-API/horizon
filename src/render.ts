import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const source = join(
  process.env.HOME ?? ".",
  "Pictures/ubuntu-neon-logo-2560x1080-23495.jpg",
);

const output = join(process.cwd(), "tmp/panorama-test-ts");
mkdirSync(output, { recursive: true });

const displays = [
  { name: "HDMI-A-1", x: 0, y: 0, width: 1920, height: 1080 },
  { name: "HDMI-A-2", x: 1920, y: 0, width: 1920, height: 1080 },
];

const minX = Math.min(...displays.map((d) => d.x));
const minY = Math.min(...displays.map((d) => d.y));
const maxX = Math.max(...displays.map((d) => d.x + d.width));
const maxY = Math.max(...displays.map((d) => d.y + d.height));

const canvasWidth = maxX - minX;
const canvasHeight = maxY - minY;
const preview = join(output, "panorama-preview.png");

// Create one shared canvas before splitting it.
// This keeps both panels aligned to the same image composition.
execFileSync("convert", [
  source,
  "-resize",
  `${canvasWidth}x${canvasHeight}^`,
  "-gravity",
  "center",
  "-extent",
  `${canvasWidth}x${canvasHeight}`,
  preview,
]);

for (const display of displays) {
  const x = display.x - minX;
  const y = display.y - minY;
  const destination = join(output, `${display.name}.png`);

  execFileSync("convert", [
    preview,
    "-crop",
    `${display.width}x${display.height}+${x}+${y}`,
    "+repage",
    destination,
  ]);

  console.log(
    `${display.name}: ${display.width}x${display.height} -> ${destination}`,
  );
}

console.log(`\nPanorama: ${canvasWidth}x${canvasHeight}`);
console.log(`Output folder: ${output}`);
