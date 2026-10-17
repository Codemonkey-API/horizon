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

export function calculateSlices(
  image: ImageSize,
  displays: Display[],
): ImageSlice[] {
  if (image.width <= 0 || image.height <= 0) {
    throw new Error("Image dimensions must be positive.");
  }

  if (displays.length === 0) {
    throw new Error("At least one display is required.");
  }

  for (const display of displays) {
    if (
      display.width <= 0 ||
      display.height <= 0 ||
      !Number.isInteger(display.x) ||
      !Number.isInteger(display.y)
    ) {
      throw new Error(`Invalid geometry for ${display.name}.`);
    }
  }

  const minX = Math.min(...displays.map((d) => d.x));
  const minY = Math.min(...displays.map((d) => d.y));
  const maxX = Math.max(...displays.map((d) => d.x + d.width));
  const maxY = Math.max(...displays.map((d) => d.y + d.height));

  const canvasWidth = maxX - minX;
  const canvasHeight = maxY - minY;

  // Scale the image to cover the entire combined desktop.
  const scale = Math.max(
    canvasWidth / image.width,
    canvasHeight / image.height,
  );

  const renderedWidth = image.width * scale;
  const renderedHeight = image.height * scale;

  // Center the image, cropping any excess edges.
  const offsetX = (renderedWidth - canvasWidth) / 2;
  const offsetY = (renderedHeight - canvasHeight) / 2;

  return displays.map((display) => ({
    display: display.name,
    x: Math.round((display.x - minX + offsetX) / scale),
    y: Math.round((display.y - minY + offsetY) / scale),
    width: Math.round(display.width / scale),
    height: Math.round(display.height / scale),
  }));
}
