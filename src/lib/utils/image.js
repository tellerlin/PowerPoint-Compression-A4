// File: image.js

import { COMPRESSION_SETTINGS } from '../pptx/constants.js';
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
  if (header.startsWith('49492a00') || header.startsWith('4d4d002a')) return 'tiff'; // 支持 TIFF 格式
  console.warn('[ImageCompress] Unknown image format, header:', header);
  return 'unknown';
}

export async function compressImage(data, quality = COMPRESSION_SETTINGS.DEFAULT_QUALITY) {
  if (!(data instanceof Uint8Array)) {
    throw new TypeError('compressImage: data must be a Uint8Array');
  }
  if (typeof quality !== 'number' || quality < 0 || quality > 1) {
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
    } catch (e) {}
    if (cached) {
      return cached;
    }
    originalFormat = await detectFormat(data);
    if (originalFormat === 'unknown' || originalFormat === 'tiff') {
      return {
        data: data,
        format: originalFormat || 'original',
        compressionMethod: 'original',
        originalSize: originalSize,
        compressedSize: originalSize,
        originalDimensions: { width: originalWidth || 0, height: originalHeight || 0 },
        finalDimensions: { width: originalWidth || 0, height: originalHeight || 0 },
        error: `Unsupported format: ${originalFormat}`
      };
    }
    const blob = new Blob([data]);
    let bitmap;
    try {
      bitmap = await createImageBitmap(blob);
      if (!bitmap) throw new Error('Created bitmap is null');
      originalWidth = bitmap.width;
      originalHeight = bitmap.height;
    } catch (e) {
      throw new Error(`Invalid or unsupported image data (format: ${originalFormat}, size: ${originalSize}B)`);
    }
    if (originalSize < COMPRESSION_SETTINGS.MIN_COMPRESSION_SIZE_BYTES) {
      resultFormat = originalFormat;
    } else {
      let tempCanvas, tempCtx, imageData;
      try {
        tempCanvas = new OffscreenCanvas(originalWidth, originalHeight);
        tempCtx = tempCanvas.getContext('2d');
        if (!tempCtx) throw new Error('Failed to get 2d context for analysis');
        tempCtx.drawImage(bitmap, 0, 0);
        imageData = await getImageData(tempCanvas);
      } catch (e) {
        console.error(`[compressImage] Error creating canvas or getting image data for ${originalFormat}:`, e.message);
        return {
          data: data,
          format: originalFormat || 'original',
          compressionMethod: 'original',
          originalSize: originalSize,
          compressedSize: originalSize,
          originalDimensions: { width: originalWidth || 0, height: originalHeight || 0 },
          finalDimensions: { width: originalWidth || 0, height: originalHeight || 0 },
          error: e.message
        };
      }
      let imageType = ImageType.UNKNOWN;
      let analysis = { hasAlpha: false, isAnimated: false };
      try {
        imageType = analyzeImageType(imageData);
        analysis = analyzeImage(imageData);
      } catch (e) {
        console.error(`[compressImage] Error analyzing image type for ${originalFormat}:`, e.message);
      }
      let targetWidth = originalWidth;
      let targetHeight = originalHeight;
      try {
        const dimensions = calculateOptimalDimensions(originalWidth, originalHeight, COMPRESSION_SETTINGS.MAX_IMAGE_SIZE);
        targetWidth = dimensions.width;
        targetHeight = dimensions.height;
      } catch (e) {
        console.error(`[compressImage] Error calculating optimal dimensions for ${originalFormat}:`, e.message);
        targetWidth = originalWidth;
        targetHeight = originalHeight;
      }
      const needsResize = targetWidth !== originalWidth || targetHeight !== originalHeight;
      if (!needsResize && originalSize < COMPRESSION_SETTINGS.MIN_RECOMPRESSION_SIZE_BYTES) {
        resultFormat = originalFormat;
      } else {
        let sourceBitmap = bitmap;
        let currentWidth = originalWidth;
        let currentHeight = originalHeight;
        if (needsResize) {
          try {
            const resizedCanvas = await resizeImage(bitmap, targetWidth, targetHeight);
            sourceBitmap = await createImageBitmap(resizedCanvas);
            currentWidth = targetWidth;
            currentHeight = targetHeight;
          } catch (e) {
            console.error(`[compressImage] Error resizing image for ${originalFormat}:`, e.message);
            // Keep original bitmap if resize fails
          }
        }
        const conversionCanvas = new OffscreenCanvas(currentWidth, currentHeight);
        const conversionCtx = conversionCanvas.getContext('2d');
        if (!conversionCtx) throw new Error('Failed to get 2D context for conversion');
        conversionCtx.drawImage(sourceBitmap, 0, 0);
        const blobs = [];
        try {
          blobs.push({
            type: 'webp',
            blob: await conversionCanvas.convertToBlob({ type: 'image/webp', quality: quality })
          });
          if (!analysis.hasAlpha) {
            blobs.push({
              type: 'jpeg',
              blob: await conversionCanvas.convertToBlob({ type: 'image/jpeg', quality: quality })
            });
          }
          if (imageType === ImageType.DIAGRAM || imageType === ImageType.ICON) {
            blobs.push({
              type: 'png',
              blob: await conversionCanvas.convertToBlob({ type: 'image/png' })
            });
          }
        } catch (e) {
          console.error(`[compressImage] Error converting to blob for ${originalFormat}:`, e.message);
          return {
            data: data,
            format: originalFormat || 'original',
            compressionMethod: 'original',
            originalSize: originalSize,
            compressedSize: originalSize,
            originalDimensions: { width: originalWidth, height: originalHeight },
            finalDimensions: { width: originalWidth, height: originalHeight },
            error: e.message
          };
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
          resultFormat = originalFormat;
        } else {
          try {
            resultData = new Uint8Array(await best.blob.arrayBuffer());
            resultFormat = best.type;
            resultMethod = best.type;
          } catch (e) {
            console.error(`[compressImage] Error converting blob to array buffer for ${originalFormat}:`, e.message);
            return {
              data: data,
              format: originalFormat || 'original',
              compressionMethod: 'original',
              originalSize: originalSize,
              compressedSize: originalSize,
              originalDimensions: { width: originalWidth, height: originalHeight },
              finalDimensions: { width: originalWidth, height: originalHeight },
              error: e.message
            };
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
        finalDimensions: resultMethod === 'original' ? { width: originalWidth, height: originalHeight } : { width: targetWidth, height: targetHeight },
        error: null
      };
      try {
        imageCache.set(cacheKey, finalResult);
      } catch (e) {}
      return finalResult;
    }
  } catch (error) {
    errorMsg = error.message;
    console.error(`[compressImage] General error compressing image of format ${originalFormat || 'unknown'}:`, error.message);
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
