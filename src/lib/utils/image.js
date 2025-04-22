import { COMPRESSION_SETTINGS } from '../pptx/constants.js';
import { validateImageData } from './validation';
import { imageCache } from './cache';

function hashCode(data) {
	let hash = 0;
	const step = Math.max(1, Math.floor(data.length / 100));
	for (let i = 0; i < data.length; i += step) {
		hash = ((hash << 5) - hash) + data[i];
		hash |= 0;
	}
	return hash.toString(16);
}

const ImageType = {
	PHOTO: 'photo',
	DIAGRAM: 'diagram',
	ICON: 'icon',
	UNKNOWN: 'unknown'
};

function analyzeImageType(imageData) {
	const { width, height, data } = imageData;

	if (width < 128 && height < 128) {
		return ImageType.ICON;
	}

	let colorCount = 0;
	const colorMap = new Map();
	const sampleStep = Math.max(1, Math.floor((data.length / 4) / 1000));

	for (let i = 0; i < data.length; i += sampleStep * 4) {
		const r = data[i];
		const g = data[i + 1];
		const b = data[i + 2];
		const colorKey = `${r},${g},${b}`;

		if (!colorMap.has(colorKey)) {
			colorMap.set(colorKey, 1);
			colorCount++;
			if (colorCount > 50) break;
		}
	}

	if (colorCount < 50) {
		return ImageType.DIAGRAM;
	}

	return ImageType.PHOTO;
}

async function getImageData(canvas) {
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Failed to get 2D context for image data');
	return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function checkAlphaChannel(imageData) {
	const data = imageData.data;
	for (let i = 3; i < data.length; i += 4) {
		if (data[i] < 255) return true;
	}
	return false;
}

function analyzeImage(imageData) {
	return { hasAlpha: checkAlphaChannel(imageData), isAnimated: false };
}

function calculateOptimalDimensions(originalWidth, originalHeight, maxSize = COMPRESSION_SETTINGS.MAX_IMAGE_SIZE) {
	if (originalWidth <= maxSize && originalHeight <= maxSize) {
		return { width: originalWidth, height: originalHeight };
	}

	const aspectRatio = originalWidth / originalHeight;
	let targetWidth, targetHeight;

	if (originalWidth > originalHeight) {
		targetWidth = maxSize;
		targetHeight = Math.round(targetWidth / aspectRatio);
	} else {
		targetHeight = maxSize;
		targetWidth = Math.round(targetHeight * aspectRatio);
	}

	if (targetWidth > maxSize) {
		targetWidth = maxSize;
		targetHeight = Math.round(targetWidth / aspectRatio);
	}
	if (targetHeight > maxSize) {
		targetHeight = maxSize;
		targetWidth = Math.round(targetHeight * aspectRatio);
	}

	if (targetWidth >= originalWidth || targetHeight >= originalHeight) {
	    return { width: originalWidth, height: originalHeight };
	}


	return { width: targetWidth, height: targetHeight };
}


async function resizeImage(bitmap, targetWidth, targetHeight) {
	const canvas = new OffscreenCanvas(targetWidth, targetHeight);
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Failed to get 2D context for resizing');
	ctx.imageSmoothingQuality = 'high';
	ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
	return canvas;
}

async function detectFormat(data) {
	if (data.length < 12) return 'unknown';
	const bytes = data.slice(0, 12);
	const header = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');

	if (header.startsWith('89504e470d0a1a0a')) return 'png';
	if (header.startsWith('ffd8ff')) return 'jpeg';
	if (header.startsWith('474946383761') || header.startsWith('474946383961')) return 'gif';
	if (header.startsWith('424d')) return 'bmp';
	if (header.startsWith('52494646') && header.endsWith('57454250')) return 'webp';

	console.warn('[ImageCompress] Unknown image format, header:', header);
	return 'unknown';
}

export async function compressImage(data, quality = COMPRESSION_SETTINGS.DEFAULT_QUALITY) {
	if (!(data instanceof Uint8Array)) {
		console.error('[ImageCompress] Invalid input: data must be a Uint8Array.');
		throw new TypeError('compressImage: data must be a Uint8Array');
	}
	if (typeof quality !== 'number' || quality < 0 || quality > 1) {
		console.error(`[ImageCompress] Invalid quality: ${quality}. Must be between 0 and 1.`);
		throw new RangeError('compressImage: quality must be a number between 0 and 1');
	}

	const originalSize = data.byteLength;
	let originalFormat = 'unknown';
	let originalWidth = 0;
	let originalHeight = 0;
	let resultData = data;
	let resultFormat = 'original';
	let resultMethod = 'original';
	let errorMsg = null;

	try {
		const cacheKey = `${originalSize}-${quality}-${hashCode(data)}`;
		let cached = null;
		try {
			cached = imageCache.get(cacheKey);
		} catch (e) {
			console.warn('[ImageCompress] Cache get failed:', e?.message);
		}

		if (cached) {
			console.log(`[ImageCompress] Cache hit for key: ${cacheKey.substring(0, 20)}...`);
			return cached;
		}

		try {
			validateImageData(data);
		} catch (e) {
			console.error('[ImageCompress] Image data validation failed:', e.message);
			throw e;
		}

		originalFormat = await detectFormat(data);

		let blob;
		try {
			blob = new Blob([data]);
		} catch (e) {
			console.error('[ImageCompress] Failed to create Blob:', e.message);
			throw e;
		}

		let bitmap;
		try {
			bitmap = await createImageBitmap(blob);
			if (!bitmap) throw new Error('Created bitmap is null');
			originalWidth = bitmap.width;
			originalHeight = bitmap.height;
		} catch (e) {
			console.error('[ImageCompress] Failed to create image bitmap:', e.message);
			if (originalFormat === 'webp' && !('createImageBitmap' in window && createImageBitmap.toString().includes('native code'))) {
                 console.warn('[ImageCompress] Browser might lack native WebP support for createImageBitmap.');
            }
			throw new Error(`Invalid or unsupported image data (format: ${originalFormat}, size: ${originalSize}B)`);
		}

		if (originalSize < COMPRESSION_SETTINGS.MIN_COMPRESSION_SIZE_BYTES) {
			console.log(`[ImageCompress] ${originalFormat} -> original | method: original | size: ${originalSize}B -> ${originalSize}B | dimension: ${originalWidth}x${originalHeight} (size below threshold)`);
			resultFormat = originalFormat;
			// No need to change other result variables
		} else {
			let tempCanvas, tempCtx, imageData;
			try {
				tempCanvas = new OffscreenCanvas(originalWidth, originalHeight);
				tempCtx = tempCanvas.getContext('2d');
				if (!tempCtx) throw new Error('Failed to get 2d context for analysis');
				tempCtx.drawImage(bitmap, 0, 0);
				imageData = await getImageData(tempCanvas);
			} catch (e) {
				console.error('[ImageCompress] Failed to analyze image for type/alpha:', e.message);
				throw e; // Rethrow analysis failure
			}

			let imageType = ImageType.UNKNOWN;
			let analysis = { hasAlpha: false, isAnimated: false };
			try {
				imageType = analyzeImageType(imageData);
				analysis = analyzeImage(imageData);
			} catch (e) {
				console.warn('[ImageCompress] Image analysis failed:', e.message);
			}

			let targetQuality = quality;
			if (imageType === ImageType.DIAGRAM || imageType === ImageType.ICON) {
				targetQuality = Math.min(quality, COMPRESSION_SETTINGS.DIAGRAM_ICON_QUALITY_FACTOR);
			}

			let targetWidth, targetHeight;
			try {
				({ width: targetWidth, height: targetHeight } = calculateOptimalDimensions(
					originalWidth, originalHeight,
					COMPRESSION_SETTINGS.MAX_IMAGE_SIZE
				));
			} catch (e) {
				console.error('[ImageCompress] Dimension calculation failed:', e.message);
				targetWidth = originalWidth;
				targetHeight = originalHeight;
			}

			const needsResize = targetWidth !== originalWidth || targetHeight !== originalHeight;

			if (!needsResize && originalSize < COMPRESSION_SETTINGS.MIN_RECOMPRESSION_SIZE_BYTES) {
				console.log(`[ImageCompress] ${originalFormat} -> original | method: original | size: ${originalSize}B -> ${originalSize}B | dimension: ${originalWidth}x${originalHeight} (no resize, size below recompress threshold)`);
				resultFormat = originalFormat;
			} else {
				let sourceBitmap = bitmap;
				let currentWidth = originalWidth;
				let currentHeight = originalHeight;

				if (needsResize) {
					try {
						const resizedCanvas = await resizeImage(bitmap, targetWidth, targetHeight);
						sourceBitmap = await createImageBitmap(resizedCanvas); // Use the resized bitmap for conversion
						currentWidth = targetWidth;
						currentHeight = targetHeight;
						// No need for getContext or convertToBlob here, just need the bitmap
					} catch (e) {
						console.error('[ImageCompress] Image resize failed:', e.message);
						throw e; // Stop if resize fails
					}
				}

                // Create canvas from the sourceBitmap (original or resized)
                const conversionCanvas = new OffscreenCanvas(currentWidth, currentHeight);
                const conversionCtx = conversionCanvas.getContext('2d');
                if (!conversionCtx) throw new Error('Failed to get 2D context for conversion');
                conversionCtx.drawImage(sourceBitmap, 0, 0);


				const blobs = [];
				try {
					blobs.push({
						type: 'webp',
						blob: await conversionCanvas.convertToBlob({ type: 'image/webp', quality: targetQuality })
					});
					if (!analysis.hasAlpha) {
						blobs.push({
							type: 'jpeg',
							blob: await conversionCanvas.convertToBlob({ type: 'image/jpeg', quality: targetQuality })
						});
					}
					if (imageType === ImageType.DIAGRAM || imageType === ImageType.ICON) {
						blobs.push({
							type: 'png',
							blob: await conversionCanvas.convertToBlob({ type: 'image/png' })
						});
					}
				} catch (e) {
					console.error('[ImageCompress] Blob conversion failed:', e.message);
					throw e;
				}

				let best = blobs[0];
				for (const candidate of blobs) {
					if (candidate.blob && candidate.blob.size < best.blob.size) {
						best = candidate;
					}
				}

				if (!best.blob) {
                     throw new Error("No valid compressed blob generated.");
                }

				if (best.blob.size >= originalSize * COMPRESSION_SETTINGS.MIN_SAVING_PERCENTAGE_THRESHOLD) {
					console.log(`[ImageCompress] ${originalFormat} -> original | method: original | size: ${originalSize}B -> ${originalSize}B | dimension: ${originalWidth}x${originalHeight} (no significant saving)`);
					resultFormat = originalFormat;
				} else {
					try {
						resultData = new Uint8Array(await best.blob.arrayBuffer());
						resultFormat = best.type;
						resultMethod = best.type;
						console.log(`[ImageCompress] ${originalFormat} -> ${best.type} | method: ${best.type} | quality: ${targetQuality.toFixed(2)} | size: ${originalSize}B -> ${resultData.byteLength}B | dimension: ${originalWidth}x${originalHeight} -> ${currentWidth}x${currentHeight}`);
					} catch (e) {
						console.error('[ImageCompress] Failed to read compressed blob:', e.message);
						throw e;
					}
				}
			}
		}

		const finalResult = {
			data: resultData,
			format: resultFormat,
			compressionMethod: resultMethod,
			originalSize: originalSize,
			compressedSize: resultData.byteLength,
			originalDimensions: { width: originalWidth, height: originalHeight },
			finalDimensions: resultMethod === 'original' ? { width: originalWidth, height: originalHeight } : { width: targetWidth || originalWidth, height: targetHeight || originalHeight },
			error: null
		};

		try {
			imageCache.set(cacheKey, finalResult);
		} catch (e) {
			console.warn('[ImageCompress] Failed to cache result:', e?.message);
		}
		return finalResult;

	} catch (error) {
		console.error('[ImageCompress] Image compression failed:', error.message, error.stack);
		errorMsg = error.message;
		// Return original data on failure
		return {
			data: data,
			format: originalFormat || 'original',
			compressionMethod: 'original',
			originalSize: originalSize,
			compressedSize: originalSize,
			originalDimensions: { width: originalWidth || 0, height: originalHeight || 0 },
			finalDimensions: { width: originalWidth || 0, height: originalHeight || 0 },
			error: errorMsg
		};
	}
}
