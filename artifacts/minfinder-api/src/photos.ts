import sharp from "sharp";

// Every upload is decoded and re-encoded. That does three jobs at once: it proves the bytes
// really are an image (whatever the Content-Type claimed), it caps the size, and it drops ALL
// metadata — sharp writes none unless asked — so camera GPS, serial numbers and timestamps
// never reach the public. rotate() first bakes in the EXIF orientation we're about to strip.

export interface Processed {
  full: Buffer;
  thumb: Buffer;
  dhash: bigint;
}

// Only what phone cameras produce. libvips will otherwise happily parse SVG, TIFF, PDF and more
// from untrusted bytes — every extra decoder is extra attack surface for nothing.
const CAMERA_FORMATS = new Set(["jpeg", "png", "heif", "webp"]);
const OPTS = { limitInputPixels: 60_000_000 } as const; // ~60 MP; flagship phones top out near 50

export async function processPhoto(input: Uint8Array): Promise<Processed> {
  const { format } = await sharp(input, OPTS).metadata();
  if (!format || !CAMERA_FORMATS.has(format)) throw new Error(`unsupported format ${format}`);
  const full = await sharp(input, OPTS)
    .rotate()
    .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  const thumb = await sharp(full).resize({ width: 480, height: 480, fit: "inside" }).jpeg({ quality: 75 }).toBuffer();
  return { full, thumb, dhash: await dhash(full) };
}

// Difference hash: shrink to 9x8 grey, one bit per "is this pixel darker than its right
// neighbour". Survives re-compression and resizing, so the same photo uploaded twice (or lifted
// from someone else's submission) lands within a few bits of itself.
export async function dhash(img: Uint8Array): Promise<bigint> {
  const px = await sharp(img).grayscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
  let h = 0n;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) h = (h << 1n) | (px[r * 9 + c] < px[r * 9 + c + 1] ? 1n : 0n);
  }
  return h;
}
