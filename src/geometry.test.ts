import test from "node:test";
import assert from "node:assert/strict";
import { calculateLayout, calculateSlices } from "./geometry.js";
import type { Display } from "./geometry.js";

const monitors: Display[] = [
  { name: "LEFT", x: 0, y: 0, width: 1920, height: 1080 },
  { name: "RIGHT", x: 1920, y: 0, width: 1920, height: 1080 },
];

test("creates the correct two-monitor canvas", () => {
  const layout = calculateLayout(
    { width: 2560, height: 1080 },
    monitors,
  );

  assert.deepEqual(layout.canvas, { width: 3840, height: 1080 });
  assert.deepEqual(layout.slices, [
    { display: "LEFT", x: 0, y: 0, width: 1920, height: 1080 },
    { display: "RIGHT", x: 1920, y: 0, width: 1920, height: 1080 },
  ]);
});

test("calculates source-image crops for a panoramic wallpaper", () => {
  const slices = calculateSlices(
    { width: 2560, height: 1080 },
    monitors,
  );

  assert.deepEqual(slices, [
    { display: "LEFT", x: 0, y: 180, width: 1280, height: 720 },
    { display: "RIGHT", x: 1280, y: 180, width: 1280, height: 720 },
  ]);
});

test("handles a monitor positioned left of the origin", () => {
  const layout = calculateLayout(
    { width: 3840, height: 1080 },
    [
      { name: "LEFT", x: -1920, y: 0, width: 1920, height: 1080 },
      { name: "RIGHT", x: 0, y: 0, width: 1920, height: 1080 },
    ],
  );

  assert.deepEqual(layout.canvas, { width: 3840, height: 1080 });
  assert.equal(layout.slices[0]?.x, 0);
  assert.equal(layout.slices[1]?.x, 1920);
});

test("rejects an empty display list", () => {
  assert.throws(
    () => calculateLayout({ width: 100, height: 100 }, []),
    /At least one display/,
  );
});

test("rejects invalid image dimensions", () => {
  assert.throws(
    () => calculateLayout({ width: 0, height: 100 }, monitors),
    /Image dimensions/,
  );
});

test("rejects invalid display dimensions", () => {
  assert.throws(
    () =>
      calculateLayout(
        { width: 100, height: 100 },
        [{ name: "BROKEN", x: 0, y: 0, width: -1, height: 100 }],
      ),
    /Invalid geometry/,
  );
});
