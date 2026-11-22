export interface DecodedImage {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

// Any image format the browser can draw works, not only PNG.
export async function decodeImage(blob: Blob): Promise<DecodedImage> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser can't read images.");
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    return { width: bitmap.width, height: bitmap.height, rgba: data };
  } finally {
    bitmap.close();
  }
}
