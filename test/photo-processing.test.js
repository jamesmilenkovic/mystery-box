import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeDownscaledSize, pickImageBitmapOptions, MAX_LONG_EDGE, JPEG_QUALITY } from '../src/photo-processing.js';

describe('photo-processing: computeDownscaledSize', () => {
  test('leaves an image already under the long-edge cap untouched', () => {
    assert.deepEqual(computeDownscaledSize(800, 600), { width: 800, height: 600 });
  });

  test('leaves an image exactly at the cap untouched', () => {
    assert.deepEqual(computeDownscaledSize(MAX_LONG_EDGE, 900), { width: MAX_LONG_EDGE, height: 900 });
  });

  test('downscales a landscape image so the long (width) edge hits the cap', () => {
    const result = computeDownscaledSize(4000, 3000, 1280);
    assert.equal(result.width, 1280);
    assert.equal(result.height, 960);
  });

  test('downscales a portrait image so the long (height) edge hits the cap', () => {
    const result = computeDownscaledSize(3000, 4000, 1280);
    assert.equal(result.width, 960);
    assert.equal(result.height, 1280);
  });

  test('preserves aspect ratio (within a rounding pixel) for an odd ratio', () => {
    const result = computeDownscaledSize(4032, 3024, 1280);
    const sourceRatio = 4032 / 3024;
    const resultRatio = result.width / result.height;
    assert.ok(Math.abs(sourceRatio - resultRatio) < 0.01, `expected aspect ratio to be preserved, got ${resultRatio} vs ${sourceRatio}`);
  });

  test('never upscales a small image', () => {
    assert.deepEqual(computeDownscaledSize(100, 50), { width: 100, height: 50 });
  });

  test('respects a custom maxLongEdge override', () => {
    assert.deepEqual(computeDownscaledSize(1000, 500, 400), { width: 400, height: 200 });
  });
});

describe('photo-processing: pickImageBitmapOptions', () => {
  test('requests from-image orientation when supported', () => {
    assert.deepEqual(pickImageBitmapOptions(true), { imageOrientation: 'from-image' });
  });

  test('falls back to no options when unsupported (documented fallback)', () => {
    assert.deepEqual(pickImageBitmapOptions(false), {});
  });
});

describe('photo-processing: exported constants', () => {
  test('MAX_LONG_EDGE and JPEG_QUALITY match the spec targets', () => {
    assert.equal(MAX_LONG_EDGE, 1280);
    assert.equal(JPEG_QUALITY, 0.8);
  });
});
