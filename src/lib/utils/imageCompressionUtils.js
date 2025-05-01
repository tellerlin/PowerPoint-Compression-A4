// 共享的图像压缩工具函数

export function hashCode(data) {
  let hash = 0;
  const step = Math.max(1, Math.floor(data.length / 100));
  for (let i = 0; i < data.length; i += step) {
    hash = ((hash << 5) - hash) + data[i];
    hash |= 0;
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
  const data = imageData.data;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true;
  }
  return false;
}

export function analyzeImage(imageData) {
  return { hasAlpha: checkAlphaChannel(imageData), isAnimated: false };
}

export function calculateOptimalDimensions(originalWidth, originalHeight, maxSize = 1920) {
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

export async function detectFormat(data) {
  if (data.length < 12) return 'unknown';
  const bytes = data.slice(0, 12);
  const header = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  
  if (header.startsWith('89504e470d0a1a0a')) return 'png';
  if (header.startsWith('ffd8ff')) return 'jpeg';
  if (header.startsWith('474946383761') || header.startsWith('474946383961')) return 'gif';
  if (header.startsWith('424d')) return 'bmp';
  if (header.startsWith('52494646') && header.endsWith('57454250')) return 'webp';
  if (header.startsWith('49492a00') || header.startsWith('4d4d002a')) return 'tiff';
  
  return 'unknown';
}

export async function processImage(data, quality, originalFormat) {
  if (!(data instanceof Uint8Array)) {
    throw new TypeError('processImage: data must be a Uint8Array');
  }
  
  console.log(`[processImage] Starting compression: size=${data.byteLength}, quality=${quality}, format=${originalFormat || 'auto'}`);
  
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
    console.log(`[processImage] Detected format: ${format}`);
    const blob = new Blob([data], { type: `image/${format}` });
    const bitmap = await createImageBitmap(blob).catch(err => {
      console.error(`[processImage] Failed to create image bitmap: ${err.message}`);
      throw new Error(`Failed to create image bitmap: ${err.message}`);
    });
    
    originalWidth = bitmap.width;
    originalHeight = bitmap.height;
    console.log(`[processImage] Image dimensions: ${originalWidth}x${originalHeight}`);
    
    // 分析图像类型和特性
    const canvas = new OffscreenCanvas(originalWidth, originalHeight);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D context for canvas');
    }
    
    ctx.drawImage(bitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, originalWidth, originalHeight);
    
    // 检查透明通道
    const hasAlpha = checkAlphaChannel(imageData);
    console.log(`[processImage] Image has alpha channel: ${hasAlpha}`);
    
    // 计算最佳尺寸
    const dimensions = calculateOptimalDimensions(originalWidth, originalHeight);
    targetWidth = dimensions.width;
    targetHeight = dimensions.height;
    console.log(`[processImage] Target dimensions: ${targetWidth}x${targetHeight}`);
    
    // 尝试不同格式并选择最小的
    const blobs = [];
    
    // 总是尝试WebP
    try {
      const webpBlob = await canvas.convertToBlob({ type: 'image/webp', quality });
      console.log(`[processImage] WebP compression result: ${webpBlob.size} bytes`);
      blobs.push({
        type: 'webp',
        blob: webpBlob
      });
    } catch (err) {
      console.error(`[processImage] WebP compression failed: ${err.message}`);
    }
    
    // 如果没有透明通道，尝试JPEG
    if (!hasAlpha) {
      try {
        const jpegBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
        console.log(`[processImage] JPEG compression result: ${jpegBlob.size} bytes`);
        blobs.push({
          type: 'jpeg',
          blob: jpegBlob
        });
      } catch (err) {
        console.error(`[processImage] JPEG compression failed: ${err.message}`);
      }
    }
    
    // 如果有透明通道，尝试PNG（但质量较低）
    if (hasAlpha) {
      try {
        const pngBlob = await canvas.convertToBlob({ type: 'image/png' });
        console.log(`[processImage] PNG compression result: ${pngBlob.size} bytes`);
        blobs.push({
          type: 'png',
          blob: pngBlob
        });
      } catch (err) {
        console.error(`[processImage] PNG compression failed: ${err.message}`);
      }
    }
    
    // 选择最小的blob
    if (blobs.length > 0) {
      let best = blobs[0];
      for (const candidate of blobs) {
        if (candidate.blob && candidate.blob.size < best.blob.size) {
          best = candidate;
        }
      }
      
      console.log(`[processImage] Best compression: ${best.type}, size: ${best.blob.size} bytes (${((1 - best.blob.size/originalSize) * 100).toFixed(1)}% reduction)`);
      
      // 如果压缩后的大小小于原始大小的阈值，使用压缩后的数据
      if (best.blob.size < originalSize * 0.95) {
        compressedData = new Uint8Array(await best.blob.arrayBuffer());
        outputFormat = best.type;
        method = best.type;
      } else {
        console.log(`[processImage] Compression not effective enough, keeping original`);
      }
    } else {
      console.warn(`[processImage] No compression formats succeeded, keeping original`);
    }
    
    // 如果需要调整大小且上面的压缩不够有效
    if ((targetWidth !== originalWidth || targetHeight !== originalHeight) && method === 'original') {
      console.log(`[processImage] Trying resize from ${originalWidth}x${originalHeight} to ${targetWidth}x${targetHeight}`);
      const resizedCanvas = new OffscreenCanvas(targetWidth, targetHeight);
      const resizedCtx = resizedCanvas.getContext('2d');
      if (!resizedCtx) {
        throw new Error('Failed to get 2D context for resized canvas');
      }
      
      resizedCtx.imageSmoothingQuality = 'high';
      resizedCtx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
      
      // 尝试不同格式并选择最小的
      const resizedBlobs = [];
      
      // 总是尝试WebP
      try {
        const webpBlob = await resizedCanvas.convertToBlob({ type: 'image/webp', quality });
        console.log(`[processImage] Resized WebP result: ${webpBlob.size} bytes`);
        resizedBlobs.push({
          type: 'webp',
          blob: webpBlob
        });
      } catch (err) {
        console.error(`[processImage] Resized WebP failed: ${err.message}`);
      }
      
      // 如果没有透明通道，尝试JPEG
      if (!hasAlpha) {
        try {
          const jpegBlob = await resizedCanvas.convertToBlob({ type: 'image/jpeg', quality });
          console.log(`[processImage] Resized JPEG result: ${jpegBlob.size} bytes`);
          resizedBlobs.push({
            type: 'jpeg',
            blob: jpegBlob
          });
        } catch (err) {
          console.error(`[processImage] Resized JPEG failed: ${err.message}`);
        }
      }
      
      // 如果有透明通道，尝试PNG
      if (hasAlpha) {
        try {
          const pngBlob = await resizedCanvas.convertToBlob({ type: 'image/png' });
          console.log(`[processImage] Resized PNG result: ${pngBlob.size} bytes`);
          resizedBlobs.push({
            type: 'png',
            blob: pngBlob
          });
        } catch (err) {
          console.error(`[processImage] Resized PNG failed: ${err.message}`);
        }
      }
      
      // 选择最小的blob
      if (resizedBlobs.length > 0) {
        let best = resizedBlobs[0];
        for (const candidate of resizedBlobs) {
          if (candidate.blob && candidate.blob.size < best.blob.size) {
            best = candidate;
          }
        }
        
        console.log(`[processImage] Best resized compression: ${best.type}, size: ${best.blob.size} bytes (${((1 - best.blob.size/originalSize) * 100).toFixed(1)}% reduction)`);
        
        // 如果压缩后的大小小于原始大小的阈值，使用压缩后的数据
        if (best.blob.size < originalSize * 0.95) {
          compressedData = new Uint8Array(await best.blob.arrayBuffer());
          outputFormat = best.type;
          method = `resized-${best.type}`;
        } else {
          console.log(`[processImage] Resized compression not effective enough, keeping original`);
        }
      }
    }
  } catch (error) {
    console.error(`[processImage] Error during compression: ${error.message}`);
    // 出错时返回原始数据
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
  
  console.log(`[processImage] Compression complete: originalSize=${result.originalSize}, compressedSize=${result.compressedSize}, method=${result.compressionMethod}`);
  return result;
}