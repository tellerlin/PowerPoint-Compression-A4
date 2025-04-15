import { COMPRESSION_SETTINGS } from '../pptx/constants';
import { validateImageData } from './validation';
import { imageCache } from './cache';

// 添加hashCode函数用于缓存键生成
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
    // 图表类型可以使用较小的尺寸
    adjustedMaxWidth = Math.min(maxWidth, 800);
    adjustedMaxHeight = Math.min(maxHeight, 800);
  } else if (imageType === ImageType.ICON) {
    // 图标类型保持较小尺寸
    adjustedMaxWidth = Math.min(maxWidth, 128);
    adjustedMaxHeight = Math.min(maxHeight, 128);
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

export async function compressImage(data, quality = COMPRESSION_SETTINGS.DEFAULT_QUALITY) {
  try {
    // 使用更精确的缓存键
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
      
      // 创建临时画布用于分析图像类型
      const tempCanvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const tempCtx = tempCanvas.getContext('2d');
      tempCtx.drawImage(bitmap, 0, 0);
      const imageData = tempCtx.getImageData(0, 0, bitmap.width, bitmap.height);
      
      // 分析图像类型
      const imageType = analyzeImageType(imageData);
      
      // 只有当图片尺寸超过阈值时才调整大小
      const { width, height } = calculateOptimalDimensions(bitmap.width, bitmap.height, 
                                                          COMPRESSION_SETTINGS.MAX_IMAGE_SIZE, 
                                                          COMPRESSION_SETTINGS.MAX_IMAGE_SIZE,
                                                          imageType);
      
      // 如果尺寸没有变化且原始大小较小，直接返回原图
      if (width === bitmap.width && height === bitmap.height && originalSize < 100 * 1024) {
        return { data, format: originalFormat || 'original' };
      }
      
      const canvas = await resizeImage(bitmap, width, height);
      const analysis = analyzeImage(imageData);

      // 提高小图片和透明图片的质量
      let adjustedQuality = quality;
      if (data.byteLength < 100 * 1024) { // 小于100KB的图片
        adjustedQuality = Math.min(0.95, quality + 0.05);
      }
      
      let compressedBlob;
      // 透明图片使用WebP格式并提高质量
      if (analysis.hasAlpha) {
        compressedBlob = await canvas.convertToBlob({ 
          type: 'image/webp', 
          quality: Math.min(0.95, adjustedQuality + 0.05) 
        });
      } else {
        // 对于不透明图片，尝试多种格式并选择最佳结果
        const [webpBlob, jpegBlob, pngBlob] = await Promise.all([
          canvas.convertToBlob({ type: 'image/webp', quality: adjustedQuality }),
          canvas.convertToBlob({ type: 'image/jpeg', quality: adjustedQuality }),
          canvas.convertToBlob({ type: 'image/png' })
        ]);
        
        const webpBuffer = await webpBlob.arrayBuffer();
        const jpegBuffer = await jpegBlob.arrayBuffer();
        const pngBuffer = await pngBlob.arrayBuffer();

        // 选择最小的格式，但如果压缩后大小接近原始大小，则保留原始图片
        const minSize = Math.min(webpBuffer.byteLength, jpegBuffer.byteLength, pngBuffer.byteLength);
        
        if (minSize > originalSize * 0.9) { // 如果压缩后仍然接近原始大小的90%
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

      // 如果压缩后大小大于原始大小，保留原始图片
      const compressedSize = compressedBlob.size;
      if (compressedSize > originalSize) {
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