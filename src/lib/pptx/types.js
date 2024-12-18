/**
 * @typedef {Object} OptimizationOptions
 * @property {boolean} [removeHiddenSlides]
 * @property {ImageOptimizationOptions} [compressImages]
 * @property {number} [concurrency] - 并发处理媒体文件的数量
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

export const DEFAULT_CONCURRENCY = 5; // 新增默认并发数