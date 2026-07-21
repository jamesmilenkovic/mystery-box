// DOM-driven photo capture pipeline: takes a File from the entry row's
// camera/library input and produces a downscaled JPEG Blob ready for
// photo-store.js. Not unit-tested — canvas and createImageBitmap are
// browser APIs, same as app.js's other DOM-driven code (see its header
// comment). The geometry/quality decisions it calls into live in
// photo-processing.js, which is unit-tested.

import { computeDownscaledSize, pickImageBitmapOptions, JPEG_QUALITY } from './photo-processing.js';

// 1x1 transparent PNG, decoded straight from a base64 constant (no
// fetch()/network involved — this is a local decode, not an asset load,
// so it stays outside sw.js's precache-completeness bookkeeping).
const PROBE_PIXEL_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function probePixelBlob() {
  const binary = atob(PROBE_PIXEL_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: 'image/png' });
}

// Feature probe for createImageBitmap's EXIF-orientation option. Some
// older engines throw on an options object with an unrecognised member
// rather than silently ignoring it, so this is checked once (not per
// photo) and the result is cached for the rest of the session.
let orientationSupport = null;

async function probeImageOrientationSupport() {
  if (orientationSupport !== null) return orientationSupport;
  try {
    await createImageBitmap(probePixelBlob(), { imageOrientation: 'from-image' });
    orientationSupport = true;
  } catch {
    orientationSupport = false;
  }
  return orientationSupport;
}

async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    const supportsOrientation = await probeImageOrientationSupport();
    try {
      return await createImageBitmap(file, pickImageBitmapOptions(supportsOrientation));
    } catch {
      // Documented fallback: retry without orientation options. EXIF
      // orientation may be visibly wrong on whatever engine hit this.
      return await createImageBitmap(file);
    }
  }
  // Very old engines without createImageBitmap: decode via an
  // HTMLImageElement + object URL. No EXIF correction available this way
  // — documented fallback, orientation may be wrong.
  return await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}

/**
 * Downscales and re-encodes a captured/picked photo File into a JPEG Blob
 * per SPEC.md workstream A2 (<=1280px long edge, ~0.8 quality).
 *
 * @param {File} file
 * @returns {Promise<Blob>}
 */
export async function processPhotoFile(file) {
  const image = await decodeImage(file);
  const sourceWidth = image.width;
  const sourceHeight = image.height;
  const { width, height } = computeDownscaledSize(sourceWidth, sourceHeight);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, width, height);
  if (typeof image.close === 'function') image.close();

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('photo-capture: canvas.toBlob produced no blob'));
      },
      'image/jpeg',
      JPEG_QUALITY
    );
  });
}
