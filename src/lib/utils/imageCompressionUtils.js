// Shared image compression utility functions

export function hashCode(data) {
  // 优化：使用更高效的采样方法
  let hash = 0;
  const length = data.length;
  // 对于大文件，采样更少的点以提高性能
  const step = length > 1000000 ? Math.floor(length / 50) : 
               length > 100000 ? Math.floor(length / 100) : 
               Math.max(1, Math.floor(length / 200));
  
  for (let i = 0; i < length; i += step) {
    hash = ((hash << 5) - hash) + data[i];
    hash |= 0;  // 转换为32位整数
  }
  return hash.toString(16);
}

export const ImageType = {
  PHOTO: 'photo',
  DIAGRAM: 'diagram',
  ICON: 'icon',
  UNKNOWN: 'unknown'
};

export function analyzeImageType(imageData) {
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

export function checkAlphaChannel(imageData) {
  // 添加健壮性检查
  if (!imageData || !imageData.data) {
    console.warn('[checkAlphaChannel] Invalid imageData received');
    return false; // 默认认为没有透明度通道
  }
  
  try {
    const data = imageData.data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 255) return true;
    }
    return false;
  } catch (error) {
    console.error('[checkAlphaChannel] Error checking alpha channel:', error);
    return false; // 出错时安全地返回无透明通道
  }
}

export function analyzeImage(imageData) {
  return { hasAlpha: checkAlphaChannel(imageData), isAnimated: false };
}

export function calculateOptimalDimensions(originalWidth, originalHeight, maxSize = 1920) {
  if (originalWidth <= maxSize && originalHeight <= maxSize) {
    return { width: originalWidth, height: originalHeight };
  }
  
  // 优化：使用一次性计算而不是多次条件判断
  const aspectRatio = originalWidth / originalHeight;
  let targetWidth, targetHeight;
  
  if (originalWidth > originalHeight) {
    targetWidth = Math.min(maxSize, originalWidth);
    targetHeight = Math.round(targetWidth / aspectRatio);
  } else {
    targetHeight = Math.min(maxSize, originalHeight);
    targetWidth = Math.round(targetHeight * aspectRatio);
  }
  
  // 确保两个维度都不超过maxSize
  if (targetWidth > maxSize) {
    targetWidth = maxSize;
    targetHeight = Math.round(targetWidth / aspectRatio);
  }
  
  // 避免放大小图像
  return {
    width: Math.min(targetWidth, originalWidth),
    height: Math.min(targetHeight, originalHeight)
  };
}

export function getExtensionFromPath(path) {
  if (!path) return '';
  const parts = path.split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : '';
}

export async function detectFormat(data) {
  if (data.length < 12) return 'unknown';
  const bytes = data.slice(0, 12);
  const header = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  
  if (header.startsWith('89504e470d0a1a0a')) return 'png';
  if (header.startsWith('ffd8ff')) return 'jpeg';
  if (header.startsWith('474946383761') || header.startsWith('474946383961')) return 'gif';
  if (header.startsWith('424d')) return 'bmp';
  if (header.startsWith('52494646') && header.indexOf('57454250') > 0) return 'webp';
  if (header.startsWith('49492a00') || header.startsWith('4d4d002a')) return 'tiff';
  
  const extension = getExtensionFromPath(data.path || '');
  if (extension && ['png', 'jpeg', 'jpg', 'gif', 'bmp', 'webp', 'tiff'].includes(extension)) {
    return extension === 'jpg' ? 'jpeg' : extension;
  }
  
  return 'unknown';
}

export async function processImage(data, quality, originalFormat) {
  if (!(data instanceof Uint8Array)) {
    throw new TypeError('processImage: data must be a Uint8Array');
  }
  
  const originalSize = data.byteLength;
  let format = originalFormat || await detectFormat(data);
  let compressedData = data;
  let outputFormat = format;
  let method = 'original';
  let originalWidth = 0;
  let originalHeight = 0;
  let targetWidth = 0;
  let targetHeight = 0;
  
  try {
    const blob = new Blob([data], { type: `image/${format}` });
    const bitmap = await createImageBitmap(blob).catch(err => {
      console.error(`[processImage] Failed to create image bitmap: ${err.message}`);
      throw new Error(`Failed to create image bitmap: ${err.message}`);
    });
    
    originalWidth = bitmap.width;
    originalHeight = bitmap.height;
    
    const canvas = new OffscreenCanvas(originalWidth, originalHeight);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D context for canvas');
    }
    
    ctx.drawImage(bitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, originalWidth, originalHeight);
    
    const hasAlpha = checkAlphaChannel(imageData);
    
    const dimensions = calculateOptimalDimensions(originalWidth, originalHeight);
    targetWidth = dimensions.width;
    targetHeight = dimensions.height;
    
    // 提取重复的图像格式转换逻辑为单独函数
    async function convertCanvasToOptimalFormat(canvas, quality, hasAlpha) {
      const blobs = [];
      
      try {
        const webpBlob = await canvas.convertToBlob({ type: 'image/webp', quality });
        blobs.push({ type: 'webp', blob: webpBlob });
      } catch (err) {
        console.error(`WebP compression failed: ${err.message}`);
      }
      
      if (!hasAlpha) {
        try {
          const jpegBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
          blobs.push({ type: 'jpeg', blob: jpegBlob });
        } catch (err) {
          console.error(`JPEG compression failed: ${err.message}`);
        }
      }
      
      if (hasAlpha) {
        try {
          const pngBlob = await canvas.convertToBlob({ 
            type: 'image/png',
            compressionLevel: 9,  // 最高压缩级别
            quality: 1.0  // PNG是无损格式，quality参数不影响大小
          });
          console.log(`[ImageCompressionWorker] PNG compression result: ${pngBlob.size} bytes`);
          blobs.push({
            type: 'png',
            blob: pngBlob
          });
        } catch (err) {
          console.error(`[ImageCompressionWorker] PNG compression failed: ${err.message}`);
          // 尝试使用更保守的设置
          try {
            const pngBlob = await canvas.convertToBlob({ 
              type: 'image/png',
              compressionLevel: 6
            });
            console.log(`[ImageCompressionWorker] PNG fallback compression result: ${pngBlob.size} bytes`);
            blobs.push({
              type: 'png',
              blob: pngBlob
            });
          } catch (fallbackErr) {
            console.error(`[ImageCompressionWorker] PNG fallback compression failed: ${fallbackErr.message}`);
          }
        }
      }
      
      if (blobs.length === 0) return null;
      
      // 找出最小的blob
      return blobs.reduce((best, current) => 
        (current.blob && current.blob.size < best.blob.size) ? current : best, blobs[0]);
    }
    
    // 在processImage函数中使用
    const bestResult = await convertCanvasToOptimalFormat(canvas, quality, hasAlpha);
    
    if (bestResult && bestResult.blob.size < originalSize * 0.95) {
      compressedData = new Uint8Array(await bestResult.blob.arrayBuffer());
      outputFormat = bestResult.type;
      method = bestResult.type;
    }
    
    if ((targetWidth !== originalWidth || targetHeight !== originalHeight) && method === 'original') {
      console.log(`[processImage] Trying resize from ${originalWidth}x${originalHeight} to ${targetWidth}x${targetHeight}`);
      const resizedCanvas = new OffscreenCanvas(targetWidth, targetHeight);
      const resizedCtx = resizedCanvas.getContext('2d');
      if (!resizedCtx) {
        throw new Error('Failed to get 2D context for resized canvas');
      }
      
      resizedCtx.imageSmoothingQuality = 'high';
      resizedCtx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
      
      const resizedBestResult = await convertCanvasToOptimalFormat(resizedCanvas, quality, hasAlpha);
      
      if (resizedBestResult && resizedBestResult.blob.size < originalSize * 0.95) {
        compressedData = new Uint8Array(await resizedBestResult.blob.arrayBuffer());
        outputFormat = resizedBestResult.type;
        method = `resized-${resizedBestResult.type}`;
      }
    }
  } catch (error) {
    console.error(`[processImage] Error during compression: ${error.message}`);
    compressedData = data;
    method = 'original';
  }
  
  const result = {
    data: compressedData,
    format: outputFormat,
    compressionMethod: method,
    originalSize: originalSize,
    compressedSize: compressedData.byteLength,
    originalDimensions: { width: originalWidth, height: originalHeight },
    finalDimensions: { width: targetWidth, height: targetHeight }
  };
  
  return result;
}