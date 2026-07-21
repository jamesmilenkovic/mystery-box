// Pure module: geometry/decision logic for photo capture processing, kept
// separate from the DOM-driven canvas/createImageBitmap pipeline (which
// isn't unit-testable) so the downscale math and orientation-option
// decision can be tested directly. See src/photo-capture.js for the
// browser-facing code that calls into this.

// Long-edge cap and JPEG quality per SPEC.md workstream A2: downscale to
// <=1280px long edge, ~0.8 quality, targeting ~300KB/photo.
export const MAX_LONG_EDGE = 1280;
export const JPEG_QUALITY = 0.8;

/**
 * Computes the output width/height for downscaling an image so its long
 * edge is at most maxLongEdge, preserving aspect ratio. Images already at
 * or under the limit are returned untouched — this never upscales.
 *
 * @param {number} width - source width in pixels.
 * @param {number} height - source height in pixels.
 * @param {number} [maxLongEdge] - cap for the longer of width/height.
 * @returns {{width: number, height: number}}
 */
export function computeDownscaledSize(width, height, maxLongEdge = MAX_LONG_EDGE) {
  const longEdge = Math.max(width, height);
  if (!(longEdge > maxLongEdge)) {
    return { width, height };
  }
  const scale = maxLongEdge / longEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Decides the options object to pass to createImageBitmap for EXIF
 * orientation handling. When the caller has established the browser
 * supports the `imageOrientation` option, request 'from-image' so a photo
 * taken in portrait doesn't render sideways; otherwise return an empty
 * options object (the documented fallback — orientation may be visibly
 * wrong on those engines, since there's no other zero-dependency way to
 * read EXIF orientation).
 *
 * @param {boolean} supportsImageOrientation
 * @returns {{imageOrientation?: 'from-image'}}
 */
export function pickImageBitmapOptions(supportsImageOrientation) {
  return supportsImageOrientation ? { imageOrientation: 'from-image' } : {};
}
