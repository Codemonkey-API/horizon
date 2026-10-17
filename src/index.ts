import { calculateSlices } from "./geometry.js";

const displays = [
  {
    name: "HDMI-A-1",
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
  },
  {
    name: "HDMI-A-2",
    x: 1920,
    y: 0,
    width: 1920,
    height: 1080,
  },
];

const slices = calculateSlices(
  { width: 2560, height: 1080 },
  displays,
);

console.log("Horizon 🌅");
console.log("Because two monitors deserve one horizon.");
console.log("\nCalculated image slices:");
console.table(slices);
