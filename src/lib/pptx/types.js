/**
 * @typedef {Object} OptimizationOptions
 * @property {boolean} [removeHiddenSlides]
 * @property {ImageOptimizationOptions} [compressImages]
 */

/**
 * @typedef {Object} ImageOptimizationOptions
 * @property {number} [quality]
 * @property {number} [maxWidth]
 * @property {number} [maxHeight]
 */

export const MEDIA_TYPES = {
  PNG: 'image/png',
  JPEG: 'image/jpeg',
  GIF: 'image/gif',
  BMP: 'image/bmp',
  WEBP: 'image/webp'
};