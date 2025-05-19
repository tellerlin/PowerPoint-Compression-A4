import { COMPRESSION_SETTINGS } from '../pptx/constants.js';
import { imageCache } from './cache';
import { 
  ImageType, 
  analyzeImageType, 
  analyzeImage, 
  calculateOptimalDimensions, 
  detectFormat,
  processImage
} from './imageCompressionUtils';
import imageCompression from 'browser-image-compression';

// 压缩实例管理
let compressionProcessedCount = 0;
const COMPRESSION_RESET_THRESHOLD = 10;
const COMPRESSION_TIMEOUT = 30000; // 30秒超时
const BATCH_SIZE = 2; // 每批2个文件
const MAX_QUALITY = 0.8; // 统一最高质量80%
const MAX_WIDTH = 1600;
const MAX_HEIGHT = 900;

// 使用 Canvas 作为降级方案
async function compressWithCanvas(data, format, quality) {
  const startTime = performance.now();
  try {
    const blob = new Blob([data], { type: `image/${format}` });
    const bitmap = await createImageBitmap(blob);
    
    // 计算目标尺寸
    let targetWidth = bitmap.width;
    let targetHeight = bitmap.height;
    
    // 如果图片太大，进行等比例缩放
    if (targetWidth > MAX_WIDTH || targetHeight > MAX_HEIGHT) {
      if (targetWidth > MAX_WIDTH) {
        const ratio = MAX_WIDTH / targetWidth;
        targetWidth = MAX_WIDTH;
        targetHeight = Math.round(targetHeight * ratio);
      }
      if (targetHeight > MAX_HEIGHT) {
        const ratio = MAX_HEIGHT / targetHeight;
        targetHeight = MAX_HEIGHT;
        targetWidth = Math.round(targetWidth * ratio);
      }
    }

    // 创建 canvas 并绘制图片
    const canvas = new OffscreenCanvas(targetWidth, targetHeight);
    const ctx = canvas.getContext('2d', { alpha: format === 'png' });
    if (!ctx) {
      throw new Error('Failed to get 2D context');
    }

    // 设置高质量缩放
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
    bitmap.close && bitmap.close();

    // 根据格式选择压缩选项
    let compressionOptions = {};
    if (format === 'png') {
      compressionOptions = { type: 'image/png' };
    } else if (format === 'jpeg' || format === 'jpg') {
      compressionOptions = { type: 'image/jpeg', quality: Math.min(MAX_QUALITY, quality) };
    } else if (format === 'webp') {
      compressionOptions = { type: 'image/webp', quality: Math.min(MAX_QUALITY, quality) };
    } else {
      compressionOptions = { type: `image/${format}` };
    }

    const compressedBlob = await canvas.convertToBlob(compressionOptions);
    const compressedData = new Uint8Array(await compressedBlob.arrayBuffer());
    
    const endTime = performance.now();
    console.log(`[compressWithCanvas] Processed file in ${(endTime - startTime).toFixed(2)}ms`);
    
    return compressedData;
  } catch (error) {
    console.warn('[compressWithCanvas] Error:', error);
    throw error;
  }
}

// 使用 browser-image-compression 压缩图片
async function compressWithBrowserCompression(data, format, quality) {
  const startTime = performance.now();
  try {
    const blob = new Blob([data], { type: `image/${format}` });
    const file = new File([blob], 'image.' + format, { type: `image/${format}` });

    // 设置压缩选项
    const options = {
      maxSizeMB: 1,
      maxWidthOrHeight: MAX_WIDTH,
      useWebWorker: true,
      fileType: `image/${format}`,
      initialQuality: Math.min(MAX_QUALITY, quality),
      alwaysKeepResolution: true,
      // 优化性能
      maxIteration: 3, // 减少迭代次数
      exifOrientation: 1, // 禁用 EXIF 处理
      strict: false, // 允许非严格模式
      checkOrientation: false, // 禁用方向检查
      preserveHeaders: false // 不保留元数据
    };

    // 处理图片
    const compressedFile = await imageCompression(file, options);
    const compressedData = new Uint8Array(await compressedFile.arrayBuffer());

    compressionProcessedCount++;
    const endTime = performance.now();
    console.log(`[compressWithBrowserCompression] Processed file in ${(endTime - startTime).toFixed(2)}ms`);

    return compressedData;
  } catch (error) {
    console.warn('[compressWithBrowserCompression] Error:', error);
    throw error;
  }
}

// 并行压缩函数
export async function compressImagesInParallel(images, options, onProgress) {
  const results = new Array(images.length);
  const startTime = performance.now();
  const quality = Math.min(MAX_QUALITY, options.quality || MAX_QUALITY);

  // 分批处理图片
  for (let i = 0; i < images.length; i += BATCH_SIZE) {
    const batch = images.slice(i, i + BATCH_SIZE);
    const batchPromises = batch.map(async (image, batchIndex) => {
      const index = i + batchIndex;
      const fileStartTime = performance.now();
      
      try {
        const format = await detectFormat(image.data);
        const originalSize = image.data.byteLength;
        
        // 首先尝试使用 browser-image-compression
        try {
          const compressedData = await Promise.race([
            compressWithBrowserCompression(image.data, format, quality),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Compression timeout')), COMPRESSION_TIMEOUT)
            )
          ]);

          if (compressedData.length < image.data.length) {
            results[index] = {
              data: compressedData,
              format,
              compressionMethod: 'browser-compression',
              originalSize,
              compressedSize: compressedData.length,
              path: image.path
            };
            return;
          }
        } catch (error) {
          console.warn(`[compressImagesInParallel] Browser compression failed for file ${index + 1}/${images.length}:`, error.message);
        }

        // 如果 browser-image-compression 失败或压缩效果不理想，使用 Canvas
        try {
          const compressedData = await compressWithCanvas(image.data, format, quality);
          if (compressedData.length < image.data.length) {
            results[index] = {
              data: compressedData,
              format,
              compressionMethod: 'canvas',
              originalSize,
              compressedSize: compressedData.length,
              path: image.path
            };
            return;
          }
        } catch (error) {
          console.warn(`[compressImagesInParallel] Canvas compression failed for file ${index + 1}/${images.length}:`, error.message);
        }

        // 如果两种压缩方法都失败，保持原图
        results[index] = {
          data: image.data,
          format,
          compressionMethod: 'original',
          originalSize,
          compressedSize: image.data.length,
          path: image.path
        };
      } catch (error) {
        console.warn(`[compressImagesInParallel] Failed for file ${index + 1}/${images.length}:`, error.message);
        results[index] = {
          data: image.data,
          format: await detectFormat(image.data),
          compressionMethod: 'failed',
          originalSize: image.data.length,
          compressedSize: image.data.length,
          path: image.path,
          error: error.message
        };
      }

      const fileEndTime = performance.now();
      console.log(`[compressImagesInParallel] File ${index + 1}/${images.length} processed in ${(fileEndTime - fileStartTime).toFixed(2)}ms`);

      if (onProgress) {
        onProgress({
          current: index + 1,
          total: images.length,
          stats: results[index]
            ? {
                originalSize: results[index].originalSize,
                compressedSize: results[index].compressedSize,
                ratio: results[index].compressedSize / results[index].originalSize,
                method: results[index].compressionMethod
              }
            : { originalSize: image.data.length, compressedSize: image.data.length, ratio: 1, method: 'failed' }
        });
      }
    });

    // 等待当前批次完成
    await Promise.all(batchPromises);

    // 检查是否需要重置计数器
    if (compressionProcessedCount >= COMPRESSION_RESET_THRESHOLD) {
      console.log('[compressImagesInParallel] Resetting compression counter after processing', compressionProcessedCount, 'files');
      compressionProcessedCount = 0;
    }
  }

  const endTime = performance.now();
  console.log(`[compressImagesInParallel] Total processing time: ${(endTime - startTime).toFixed(2)}ms`);
  
  // 统计压缩结果
  const stats = results.reduce((acc, result) => {
    if (result.compressionMethod === 'browser-compression') acc.browserSuccess++;
    else if (result.compressionMethod === 'canvas') acc.canvasSuccess++;
    else if (result.compressionMethod === 'original') acc.unchanged++;
    else acc.failed++;
    return acc;
  }, { browserSuccess: 0, canvasSuccess: 0, unchanged: 0, failed: 0 });
  
  console.log(`[compressImagesInParallel] Browser compression: ${stats.browserSuccess}, Canvas: ${stats.canvasSuccess}, Unchanged: ${stats.unchanged}, Failed: ${stats.failed}`);

  return results;
}

// 检查图片是否包含透明通道
export async function checkAlphaChannel(data) {
  try {
    // 如果输入是 ImageData 对象
    if (data instanceof ImageData) {
      for (let i = 3; i < data.data.length; i += 4) {
        if (data.data[i] < 255) return true;
      }
      return false;
    }
    
    // 如果输入是 Uint8Array
    if (data instanceof Uint8Array) {
      const format = await detectFormat(data);
      if (format !== 'png') return false;
      
      const blob = new Blob([data], { type: 'image/png' });
      const bitmap = await createImageBitmap(blob);
      
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        bitmap.close && bitmap.close();
        return true; // 保守处理，假设有透明通道
      }
      
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close && bitmap.close();
      
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      
      // 检查透明度通道
      for (let i = 3; i < imageData.data.length; i += 4) {
        if (imageData.data[i] < 255) return true;
      }
      
      return false;
    }
    
    throw new TypeError('checkAlphaChannel: data must be ImageData or Uint8Array');
  } catch (error) {
    console.warn('[checkAlphaChannel] Error:', error);
    return true; // 出错时保守处理，假设有透明通道
  }
}

// 导出其他必要的函数
export { 
  ImageType, 
  analyzeImageType, 
  analyzeImage, 
  calculateOptimalDimensions, 
  detectFormat
};