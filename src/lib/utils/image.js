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

function calculateOptimalDimensions(originalWidth, originalHeight, maxWidth = COMPRESSION_SETTINGS.MAX_IMAGE_SIZE, maxHeight = COMPRESSION_SETTINGS.MAX_IMAGE_SIZE, imageType = ImageType.UNKNOWN) {
  // 根据图片内容类型动态调整最大尺寸
  let adjustedMaxWidth = maxWidth;
  let adjustedMaxHeight = maxHeight;
  
  if (imageType === ImageType.DIAGRAM) {
    // 图表类型使用更大的尺寸以保持清晰度
    adjustedMaxWidth = Math.min(maxWidth, 1600); // 从1200提高到1600
    adjustedMaxHeight = Math.min(maxHeight, 1600); // 从1200提高到1600
  } else if (imageType === ImageType.ICON) {
    // 图标类型也适当提高尺寸
    adjustedMaxWidth = Math.min(maxWidth, 384); // 从256提高到384
    adjustedMaxHeight = Math.min(maxHeight, 384); // 从256提高到384
  } else if (imageType === ImageType.PHOTO) {
    // 对于照片，保留更多细节
    adjustedMaxWidth = Math.min(maxWidth, 2000); // 新增照片类型的专门处理
    adjustedMaxHeight = Math.min(maxHeight, 2000);
  }
  
  // 如果图像已经足够小，保持原始尺寸
  if (originalWidth <= adjustedMaxWidth && originalHeight <= adjustedMaxHeight) {
    return { width: originalWidth, height: originalHeight };
  }
  
  let width = originalWidth, height = originalHeight;
  if (width > adjustedMaxWidth) { 
    height = Math.round((height * adjustedMaxWidth) / width); 
    width = adjustedMaxWidth; 
  }
  if (height > adjustedMaxHeight) { 
    width = Math.round((width * adjustedMaxHeight) / height); 
    height = adjustedMaxHeight; 
  }
  return { width, height };
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

// Replace the Squoosh compression function with a browser-native approach
async function compressWithAdvancedTechniques(canvas, options = {}) {
  const { quality, imageType, hasAlpha } = options;
  
  // Create results array to store all compression attempts
  const results = [];
  
  // Try different formats with optimized settings
  try {
    // For images with transparency, prioritize WebP
    if (hasAlpha) {
      const webpBlob = await canvas.convertToBlob({ 
        type: 'image/webp', 
        quality: Math.min(0.99, quality + 0.1)
      });
      const webpBuffer = await webpBlob.arrayBuffer();
      results.push({
        data: new Uint8Array(webpBuffer),
        format: 'webp',
        size: webpBuffer.byteLength
      });
      
      // Also try PNG for transparent images
      const pngBlob = await canvas.convertToBlob({ type: 'image/png' });
      const pngBuffer = await pngBlob.arrayBuffer();
      results.push({
        data: new Uint8Array(pngBuffer),
        format: 'png',
        size: pngBuffer.byteLength
      });
    } else {
      // For non-transparent images, try all formats
      
      // Try WebP with high effort compression
      const webpBlob = await canvas.convertToBlob({ 
        type: 'image/webp', 
        quality: quality
      });
      const webpBuffer = await webpBlob.arrayBuffer();
      results.push({
        data: new Uint8Array(webpBuffer),
        format: 'webp',
        size: webpBuffer.byteLength
      });
      
      // Try JPEG with progressive option for diagrams and photos
      if (imageType !== ImageType.ICON) {
        // Use higher quality for diagrams
        const jpegQuality = imageType === ImageType.DIAGRAM ? 
          Math.min(0.99, quality + 0.15) : quality;
          
        const jpegBlob = await canvas.convertToBlob({ 
          type: 'image/jpeg', 
          quality: jpegQuality 
        });
        const jpegBuffer = await jpegBlob.arrayBuffer();
        results.push({
          data: new Uint8Array(jpegBuffer),
          format: 'jpeg',
          size: jpegBuffer.byteLength
        });
      }
      
      // Always try PNG, especially important for diagrams and icons
      const pngBlob = await canvas.convertToBlob({ type: 'image/png' });
      const pngBuffer = await pngBlob.arrayBuffer();
      results.push({
        data: new Uint8Array(pngBuffer),
        format: 'png',
        size: pngBuffer.byteLength
      });
    }
    
    // Find the smallest result
    let bestResult = results[0];
    for (let i = 1; i < results.length; i++) {
      if (results[i].size < bestResult.size) {
        bestResult = results[i];
      }
    }
    
    return bestResult;
    
  } catch (error) {
    console.error('Advanced compression failed:', error);
    return null;
  }
}

export async function compressImage(data, quality = COMPRESSION_SETTINGS.DEFAULT_QUALITY) {
  try {
    // Use cache as before
    const cacheKey = `${data.byteLength}-${quality}-${hashCode(data)}`;
    if (imageCache.get(cacheKey)) {
      return imageCache.get(cacheKey);
    }

    validateImageData(data);
    const blob = new Blob([data]);

    if (quality < 0 || quality > 1) {
      console.warn('Invalid quality value, using default quality');
      quality = COMPRESSION_SETTINGS.DEFAULT_QUALITY;
    }

    try {
      const bitmap = await createImageBitmap(blob);
      const originalSize = data.byteLength;
      const originalFormat = await detectFormat(data);
      
      // Create temporary canvas for analysis
      const tempCanvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const tempCtx = tempCanvas.getContext('2d');
      tempCtx.drawImage(bitmap, 0, 0);
      const imageData = tempCtx.getImageData(0, 0, bitmap.width, bitmap.height);
      
      // Analyze image type
      const imageType = analyzeImageType(imageData);
      
      // Calculate optimal dimensions
      const { width, height } = calculateOptimalDimensions(
        bitmap.width, bitmap.height, 
        COMPRESSION_SETTINGS.MAX_IMAGE_SIZE, 
        COMPRESSION_SETTINGS.MAX_IMAGE_SIZE,
        imageType
      );
      
      // Skip small images
      if (width === bitmap.width && height === bitmap.height && originalSize < 400 * 1024) {
        return { data, format: originalFormat || 'original' };
      }
      
      // Resize image
      const canvas = await resizeImage(bitmap, width, height);
      const analysis = analyzeImage(imageData);

      // Adjust quality based on image characteristics
      let adjustedQuality = quality;
      if (data.byteLength < 300 * 1024) {
        adjustedQuality = Math.min(0.99, quality + 0.1);
      } else if (imageType === ImageType.DIAGRAM || imageType === ImageType.ICON) {
        adjustedQuality = Math.min(0.99, quality + 0.15);
      }
      
      // Use our advanced compression technique instead of Squoosh
      const advancedResult = await compressWithAdvancedTechniques(canvas, {
        quality: adjustedQuality,
        imageType: imageType,
        hasAlpha: analysis.hasAlpha,
        width,
        height
      });
      
      // If advanced compression worked and is better than original, use it
      if (advancedResult && advancedResult.size < originalSize * 0.9) {
        const result = {
          data: advancedResult.data,
          format: advancedResult.format,
          originalSize,
          compressedSize: advancedResult.size,
          compressionRatio: (advancedResult.size / originalSize).toFixed(2),
          imageType
        };
        imageCache.set(cacheKey, result);
        return result;
      }
      
      // Fall back to original compression logic
      let compressedBlob;
      // 透明图片使用WebP格式并提高质量
      if (analysis.hasAlpha) {
        compressedBlob = await canvas.convertToBlob({ 
          type: 'image/webp', 
          quality: Math.min(0.99, adjustedQuality + 0.1)
        });
      } else {
        // 对于不透明图片，尝试多种格式并选择最佳结果
        // 为PNG添加压缩选项
        const pngOptions = { type: 'image/png' };
        
        // 对于图表和图标，优先考虑PNG格式以保持清晰度
        if (imageType === ImageType.DIAGRAM || imageType === ImageType.ICON) {
          const pngBlob = await canvas.convertToBlob(pngOptions);
          const pngBuffer = await pngBlob.arrayBuffer();
          
          // 如果PNG大小在可接受范围内，直接使用PNG
          if (pngBuffer.byteLength < originalSize * 1.2 || pngBuffer.byteLength < 500 * 1024) {
            compressedBlob = pngBlob;
          } else {
            // 否则尝试其他格式
            const [webpBlob, jpegBlob] = await Promise.all([
              canvas.convertToBlob({ type: 'image/webp', quality: adjustedQuality }),
              canvas.convertToBlob({ type: 'image/jpeg', quality: adjustedQuality })
            ]);
            
            const webpBuffer = await webpBlob.arrayBuffer();
            const jpegBuffer = await jpegBlob.arrayBuffer();
            
            compressedBlob = webpBuffer.byteLength <= jpegBuffer.byteLength ? webpBlob : jpegBlob;
          }
        } else {
          // 对于照片类型，比较所有格式
          const [webpBlob, jpegBlob, pngBlob] = await Promise.all([
            canvas.convertToBlob({ type: 'image/webp', quality: adjustedQuality }),
            canvas.convertToBlob({ type: 'image/jpeg', quality: adjustedQuality }),
            canvas.convertToBlob(pngOptions)
          ]);
          
          const webpBuffer = await webpBlob.arrayBuffer();
          const jpegBuffer = await jpegBlob.arrayBuffer();
          const pngBuffer = await pngBlob.arrayBuffer();

          // 选择最小的格式，但如果压缩后大小接近原始大小，则保留原始图片
          const minSize = Math.min(webpBuffer.byteLength, jpegBuffer.byteLength, pngBuffer.byteLength);
          
          if (minSize > originalSize * 0.7) {
            return { data, format: originalFormat || 'original' };
          }
          
          if (minSize === webpBuffer.byteLength) {
            compressedBlob = webpBlob;
          } else if (minSize === jpegBuffer.byteLength) {
            compressedBlob = jpegBlob;
          } else {
            compressedBlob = pngBlob;
          }
        }
      }

      // 如果压缩后大小大于原始大小的90%，保留原始图片
      const compressedSize = compressedBlob.size;
      if (compressedSize > originalSize * 0.9) {
        return { data, format: originalFormat || 'original' };
      }

      // 确保返回Uint8Array而不是Blob
      const compressedData = new Uint8Array(await compressedBlob.arrayBuffer());
      const result = { 
        data: compressedData, 
        format: compressedBlob.type.split('/').pop(),
        originalSize,
        compressedSize: compressedData.byteLength,
        compressionRatio: (compressedData.byteLength / originalSize).toFixed(2),
        imageType
      };
      imageCache.set(cacheKey, result);
      return result;
    } catch (error) {
      console.error('Image processing failed:', error);
      return { data, format: 'original' }; // 出错时返回原始数据
    }
  } catch (error) {
    console.error('Image compression failed:', error);
    return { data, format: 'original' }; // 出错时返回原始数据
  }
}