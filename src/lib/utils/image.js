import { COMPRESSION_SETTINGS } from '../pptx/constants';
import { validateImageData } from './validation';
import { imageCache } from './cache';
// Remove Squoosh import as it's not compatible with SvelteKit
// import { ImagePool } from '@squoosh/lib';

// Keep existing hashCode function and other utility functions
function hashCode(data) {
  // 简化的哈希算法，仅使用数据的部分样本
  let hash = 0;
  const step = Math.max(1, Math.floor(data.length / 100)); // 采样以提高性能
  for (let i = 0; i < data.length; i += step) {
    hash = ((hash << 5) - hash) + data[i];
    hash |= 0; // 转换为32位整数
  }
  return hash.toString(16);
}

// 添加图像类型枚举
const ImageType = {
  PHOTO: 'photo',
  DIAGRAM: 'diagram',
  ICON: 'icon',
  UNKNOWN: 'unknown'
};

// 添加图像类型分析函数
function analyzeImageType(imageData) {
  // 简化的图像类型检测
  // 实际应用中可以使用更复杂的算法
  const { width, height, data } = imageData;
  
  // 检查是否为图标（小尺寸，通常有透明度）
  if (width < 128 && height < 128) {
    return ImageType.ICON;
  }
  
  // 检查是否为图表/图形（有限的颜色数量，清晰的边缘）
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
      if (colorCount > 50) break; // 如果颜色太多，可能是照片
    }
  }
  
  if (colorCount < 50) {
    return ImageType.DIAGRAM;
  }
  
  // 默认为照片
  return ImageType.PHOTO;
}

async function getImageData(canvas) {
  return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
}

function checkAlphaChannel(imageData) {
  const data = imageData.data;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
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
      // Wider image
      targetWidth = maxSize;
      targetHeight = Math.round(targetWidth / aspectRatio);
  } else {
      // Taller or square image
      targetHeight = maxSize;
      targetWidth = Math.round(targetHeight * aspectRatio);
  }

  // Ensure the *other* dimension doesn't exceed max size after rounding (edge case)
  if (targetWidth > maxSize) {
      targetWidth = maxSize;
      targetHeight = Math.round(targetWidth / aspectRatio);
  }
   if (targetHeight > maxSize) {
      targetHeight = maxSize;
      targetWidth = Math.round(targetHeight * aspectRatio);
  }


  // Prevent upscaling
  if (targetWidth > originalWidth || targetHeight > originalHeight) {
    return { width: originalWidth, height: originalHeight };
  }

  return { width: targetWidth, height: targetHeight };
}


async function resizeImage(bitmap, targetWidth, targetHeight) {
  const canvas = new OffscreenCanvas(targetWidth, targetHeight);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get canvas context');
  ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
  return canvas;
}

async function detectFormat(data) {
  try {
    const image = new Image();
    const url = URL.createObjectURL(new Blob([data]));
    image.src = url;
    await image.decode();
    URL.revokeObjectURL(url);
    return image.complete ? image.naturalWidth > 0 ? image.src.split('.').pop() : 'unknown' : 'unknown';
  } catch (error) {
    console.warn('Format detection failed:', error);
    return 'unknown';
  }
}

export async function compressImage(data, quality = COMPRESSION_SETTINGS.DEFAULT_QUALITY) {
  // 参数校验
  if (!(data instanceof Uint8Array)) {
    throw new TypeError('compressImage: data must be a Uint8Array');
  }
  if (typeof quality !== 'number' || quality < 0 || quality > 1) {
    throw new RangeError('compressImage: quality must be a number between 0 and 1');
  }

  try {
    const cacheKey = `${data.byteLength}-${quality}-${hashCode(data)}`;
    let cached;
    try {
      cached = imageCache.get(cacheKey);
    } catch (e) {
      console.error('[ImageCompress] Cache get failed:', e);
      cached = null;
    }
    if (cached) {
      console.log(`[ImageCompress] Cache hit for key: ${cacheKey}`);
      return cached;
    }

    try {
      validateImageData(data);
    } catch (e) {
      console.error('[ImageCompress] Image data validation failed:', e);
      throw e;
    }

    let blob;
    try {
      blob = new Blob([data]);
    } catch (e) {
      console.error('[ImageCompress] Failed to create Blob:', e);
      throw e;
    }

    let bitmap;
    try {
      bitmap = await createImageBitmap(blob);
      if (!bitmap) throw new Error('Bitmap is null');
    } catch (e) {
      console.error('[ImageCompress] Failed to create image bitmap:', e);
      throw new Error('Invalid image data');
    }

    const originalSize = data.byteLength;
    let originalFormat = 'unknown';
    try {
      originalFormat = await detectFormat(data);
    } catch (e) {
      console.warn('[ImageCompress] Format detection failed:', e);
    }
    const originalWidth = bitmap.width;
    const originalHeight = bitmap.height;

    if (originalSize < 20 * 1024) {
      console.log(`[ImageCompress] ${originalFormat || 'original'} -> original | method: original | size: ${originalSize}B -> ${originalSize}B | dimension: ${originalWidth}x${originalHeight} (no resize)`);
      return {
        data,
        format: originalFormat || 'original',
        compressionMethod: 'original',
        originalDimensions: { width: originalWidth, height: originalHeight },
        finalDimensions: { width: originalWidth, height: originalHeight }
      };
    }

    let tempCanvas, tempCtx, imageData;
    try {
      tempCanvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      tempCtx = tempCanvas.getContext('2d');
      if (!tempCtx) throw new Error('Failed to get 2d context');
      tempCtx.drawImage(bitmap, 0, 0);
      imageData = tempCtx.getImageData(0, 0, bitmap.width, bitmap.height);
    } catch (e) {
      console.error('[ImageCompress] Failed to analyze image:', e);
      throw e;
    }

    let imageType, analysis;
    try {
      imageType = analyzeImageType(imageData);
      analysis = analyzeImage(imageData);
    } catch (e) {
      console.error('[ImageCompress] Image analysis failed:', e);
      imageType = 'unknown';
      analysis = { hasAlpha: false, isAnimated: false };
    }

    let targetQuality = quality;
    if (imageType === 'diagram' || imageType === 'icon') {
      targetQuality = Math.min(quality, 0.75);
    }

    let width, height;
    try {
      ({ width, height } = calculateOptimalDimensions(
        bitmap.width, bitmap.height,
        COMPRESSION_SETTINGS.MAX_IMAGE_SIZE,
        COMPRESSION_SETTINGS.MAX_IMAGE_SIZE,
        imageType
      ));
    } catch (e) {
      console.error('[ImageCompress] Dimension calculation failed:', e);
      width = bitmap.width;
      height = bitmap.height;
    }

    if (width === bitmap.width && height === bitmap.height && originalSize < 100 * 1024) {
      console.log(`[ImageCompress] ${originalFormat || 'original'} -> original | method: original | size: ${originalSize}B -> ${originalSize}B | dimension: ${originalWidth}x${originalHeight} (no resize)`);
      return {
        data,
        format: originalFormat || 'original',
        compressionMethod: 'original',
        originalDimensions: { width: originalWidth, height: originalHeight },
        finalDimensions: { width: originalWidth, height: originalHeight }
      };
    }

    let canvas, ctx;
    try {
      canvas = await resizeImage(bitmap, width, height);
      ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Failed to get 2d context after resize');
    } catch (e) {
      console.error('[ImageCompress] Image resize failed:', e);
      throw e;
    }

    const blobs = [];
    try {
      blobs.push({
        type: 'webp',
        blob: await canvas.convertToBlob({ type: 'image/webp', quality: targetQuality })
      });
      if (!analysis.hasAlpha) {
        blobs.push({
          type: 'jpeg',
          blob: await canvas.convertToBlob({ type: 'image/jpeg', quality: targetQuality })
        });
      }
      if (imageType === 'diagram' || imageType === 'icon') {
        blobs.push({
          type: 'png',
          blob: await canvas.convertToBlob({ type: 'image/png' })
        });
      }
    } catch (e) {
      console.error('[ImageCompress] Blob conversion failed:', e);
      throw e;
    }

    let best = blobs[0];
    for (const candidate of blobs) {
      if (candidate.blob.size < best.blob.size) best = candidate;
    }

    if (best.blob.size > originalSize * 0.95) {
      console.log(`[ImageCompress] ${originalFormat || 'original'} -> original | method: original | size: ${originalSize}B -> ${originalSize}B`);
      return {
        data,
        format: originalFormat || 'original',
        compressionMethod: 'original'
      };
    }

    let compressedData;
    try {
      compressedData = new Uint8Array(await best.blob.arrayBuffer());
    } catch (e) {
      console.error('[ImageCompress] Failed to read compressed blob:', e);
      throw e;
    }

    console.log(`[ImageCompress] ${originalFormat || 'original'} -> ${best.type} | method: ${best.type} | quality: ${targetQuality} | size: ${originalSize}B -> ${compressedData.byteLength}B | dimension: ${originalWidth}x${originalHeight} -> ${width}x${height}`);

    const result = {
      data: compressedData,
      format: best.type,
      originalSize,
      compressedSize: compressedData.byteLength,
      compressionRatio: (compressedData.byteLength / originalSize).toFixed(2),
      imageType,
      compressionMethod: best.type,
      originalDimensions: { width: originalWidth, height: originalHeight },
      finalDimensions: { width, height }
    };
    try {
      imageCache.set(cacheKey, result);
    } catch (e) {
      console.warn('[ImageCompress] Failed to cache result:', e);
    }
    return result;

  } catch (error) {
    console.error('[ImageCompress] Image compression failed:', error);
    return {
      data,
      format: 'original',
      compressionMethod: 'original',
      error: error.message
    };
  }
}


function createCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      return new OffscreenCanvas(width, height);
    } catch (e) {
      // fallback
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function blobToArrayBuffer(blob) {
  if (blob.stream) {
    // Stream API for large blobs
    const reader = blob.stream().getReader();
    const chunks = [];
    let done, value;
    while ({ done, value } = await reader.read(), !done) {
      chunks.push(value);
    }
    let length = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
    let result = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result.buffer;
  } else {
    return await blob.arrayBuffer();
  }
}