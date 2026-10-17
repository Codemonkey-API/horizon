export type Display = {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ImageSize = {
  width: number;
  height: number;
};

export type ImageSlice = {
  display: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type WallpaperLayout = {
  canvas: ImageSize;
  slices: ImageSlice[];
};

export function calculateLayout(
  image: ImageSize,
  displays: Display[],
): WallpaperLayout {
  if (
    !Number.isFinite(image.width) ||
    !Number.isFinite(image.height) ||
    image.width <= 0 ||
    image.height <= 0
  ) {
    throw new Error("Image dimensions must be positive.");
  }

  if (displays.length === 0) {
    throw new Error("At least one display is required.");
  }

  const names = new Set<string>();

  for (const display of displays) {
    if (
      !display.name.trim() ||
      names.has(display.name) ||
      !Number.isInteger(display.x) ||
      !Number.isInteger(display.y) ||
      !Number.isSafeInteger(display.width) ||
      !Number.isSafeInteger(display.height) ||
      display.width <= 0 ||
      display.height <= 0
    ) {
      throw new Error(`Invalid geometry for ${display.name}.`);
    }

    names.add(display.name);
  }

  const minX = Math.min(...displays.map((d) => d.x));
  const minY = Math.min(...displays.map((d) => d.y));
  const maxX = Math.max(...displays.map((d) => d.x + d.width));
  const maxY = Math.max(...displays.map((d) => d.y + d.height));

  const canvas = {
    width: maxX - minX,
    height: maxY - minY,
  };

  const slices = displays.map((display) => ({
    display: display.name,
    x: display.x - minX,
    y: display.y - minY,
    width: display.width,
    height: display.height,
  }));

  return { canvas, slices };
}

export function calculateSlices(
  image: ImageSize,
  displays: Display[],
): ImageSlice[] {
  const layout = calculateLayout(image, displays);

  const scale = Math.max(
    layout.canvas.width / image.width,
    layout.canvas.height / image.height,
  );

  const offsetX =
    (image.width * scale - layout.canvas.width) / 2;
  const offsetY =
    (image.height * scale - layout.canvas.height) / 2;

  return layout.slices.map((slice) => ({
    ...slice,
    x: Math.round((slice.x + offsetX) / scale),
    y: Math.round((slice.y + offsetY) / scale),
    width: Math.round(slice.width / scale),
    height: Math.round(slice.height / scale),
  }));
}
