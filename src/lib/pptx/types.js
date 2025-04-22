/**
 * @typedef {Object} OptimizationOptions
 * @property {boolean} [removeHiddenSlides=true] - Whether to remove slides marked as hidden.
 * @property {boolean|ImageCompressionOptions} [compressImages=true] - Whether to compress images. Set to false to disable, or provide an object for specific settings.
 * @property {boolean} [removeUnusedLayouts=true] - Whether to remove unused slide layouts and masters.
 * @property {boolean} [cleanMediaInUnusedLayouts=true] - If removing unused layouts, also remove media referenced *only* by those layouts.
 * @property {boolean} [preprocessImages=false] - Placeholder for future image preprocessing steps.
 * @property {function} [onProgress] - Callback function for progress updates. `onProgress(type, payload)`
 */

/**
 * @typedef {Object} ImageCompressionOptions
 * @property {number} [quality=0.90] - Target quality for lossy compression (0.0 to 1.0).
 * @property {number} [maxWidth=1000] - Maximum width for images after resizing.
 * @property {number} [maxHeight=1000] - Maximum height for images after resizing.
 */

/**
 * @typedef {Object} ProgressPayload
 * @property {number} percentage - Overall progress percentage (0-100).
 * @property {string} status - Current status message.
 * @property {string|null} error - Error message if an error occurred.
 * @property {Object|null} fileInfo - Information about the input file { name, size }.
 * @property {number} mediaCount - Total number of media files detected.
 * @property {number} processedMediaCount - Number of media files processed so far.
 * @property {number|null} estimatedTimeRemaining - Estimated remaining time in seconds.
 * @property {OptimizationStats} stats - Statistics about the optimization process.
 */

/**
 * @typedef {Object} OptimizationStats
 * @property {number} originalSize - Original file size in bytes.
 * @property {number|null} compressedSize - Final compressed file size in bytes.
 * @property {number} savedSize - Bytes saved (originalSize - compressedSize).
 * @property {number|string} savedPercentage - Percentage saved ((savedSize / originalSize) * 100).
 * @property {number} originalMediaSize - Total original size of processed media files.
 * @property {number} compressedMediaSize - Total final size of processed media files.
 * @property {number} savedMediaSize - Bytes saved from media processing.
 * @property {number|string} savedMediaPercentage - Percentage saved from media processing.
 * @property {number} processingTime - Total processing time in seconds.
 * @property {string|null} error - Final error message if optimization failed.
 */

export const MEDIA_TYPES = {
	PNG: 'image/png',
	JPEG: 'image/jpeg',
	GIF: 'image/gif',
	BMP: 'image/bmp',
	WEBP: 'image/webp',
    TIFF: 'image/tiff'
};
