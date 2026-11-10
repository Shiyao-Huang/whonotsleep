import { AlphaType, ColorType, Skia, SkImage } from '@shopify/react-native-skia';
import type { RGBAFrame } from '../shared';

/** Turn a raw RGBA frame from shared/scene.js into an SkImage (unpremultiplied RGBA_8888). */
export function rgbaToImage(frame: RGBAFrame | null | undefined): SkImage | null {
  if (!frame || !frame.width || !frame.height || !frame.data) return null;
  try {
    const d = frame.data;
    const bytes = d instanceof Uint8Array ? d : new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
    const data = Skia.Data.fromBytes(bytes);
    return Skia.Image.MakeImage(
      { width: frame.width, height: frame.height, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul },
      data,
      frame.width * 4,
    );
  } catch {
    return null;
  }
}

/** A solid-colour frame used when the renderer is missing or throws. */
export function solidFrame(width: number, height: number, rgb: [number, number, number] = [11, 13, 26]): RGBAFrame {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgb[0];
    data[i + 1] = rgb[1];
    data[i + 2] = rgb[2];
    data[i + 3] = 255;
  }
  // a few "stars" so it reads as a night room, not a broken view
  for (let k = 0; k < 24; k++) {
    const x = (k * 37 + 11) % width;
    const y = (k * 53 + 7) % Math.floor(height * 0.5);
    const i = (y * width + x) * 4;
    data[i] = data[i + 1] = 200;
    data[i + 2] = 255;
  }
  return { width, height, data };
}
