// File: image.js

import { COMPRESSION_SETTINGS } from '../pptx/constants.js';
import { imageCache } from './cache';
import { 
  hashCode, 
  ImageType, 
  analyzeImageType, 
  checkAlphaChannel, 
  analyzeImage, 
  calculateOptimalDimensions, 
  detectFormat,
  processImage
} from './imageCompressionUtils';

async function getImageData(canvas) {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get 2D context for image data');
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

async function resizeImage(bitmap, targetWidth, targetHeight) {
  const canvas = new OffscreenCanvas(targetWidth, targetHeight);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get 2D context for resizing');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
  return canvas;
}

// 使用Web Worker进行图像压缩
async function compressImageInWorker(data, quality, format) {
  return new Promise((resolve, reject) => {
    try {
      console.log(`[compressImageInWorker] Starting worker compression: size=${data.byteLength}, quality=${quality}, format=${format || 'auto'}`);
      
      // 创建Worker
      const workerPath = new URL('../workers/imageCompression.worker.js', import.meta.url).href;
      const worker = new Worker(workerPath);
      
      // 设置超时
      const timeoutId = setTimeout(() => {
        console.warn('[compressImageInWorker] Worker compression timed out after 30s');
        worker.terminate();
        reject(new Error('Worker compression timed out'));
      }, 30000); // 30秒超时
      
      // 监听Worker消息
      worker.onmessage = (event) => {
        clearTimeout(timeoutId);
        const { success, result, error } = event.data;
        
        if (success && result) {
          console.log(`[compressImageInWorker] Worker compression successful: originalSize=${result.originalSize}, compressedSize=${result.compressedSize}, method=${result.compressionMethod}`);
          resolve(result);
        } else {
          console.error(`[compressImageInWorker] Worker compression failed: ${error}`);
          reject(new Error(error || 'Worker compression failed'));
        }
        
        // 终止Worker
        worker.terminate();
      };
      
      // 监听Worker错误
      worker.onerror = (error) => {
        clearTimeout(timeoutId);
        console.error(`[compressImageInWorker] Worker error: ${error.message}`);
        worker.terminate();
        reject(new Error(`Worker error: ${error.message}`));
      };
      
      // 创建可传输的数据副本
      const dataClone = new Uint8Array(data);
      
      // 发送数据到Worker
      worker.postMessage({
        data: dataClone,
        quality,
        format
      }, [dataClone.buffer]); // 使用Transferable Objects提高性能
    } catch (error) {
      console.error(`[compressImageInWorker] Failed to initialize worker: ${error.message}`);
      reject(new Error(`Failed to initialize worker: ${error.message}`));
    }
  });
}

export async function compressImage(data, quality = COMPRESSION_SETTINGS.DEFAULT_QUALITY) {
  if (!(data instanceof Uint8Array)) {
    throw new TypeError('compressImage: data must be a Uint8Array');
  }
  if (typeof quality !== 'number' || quality < 0 || quality > 1) {
    throw new RangeError('compressImage: quality must be a number between 0 and 1');
  }
  
  const originalSize = data.byteLength;
  
  try {
    // 添加缓存检查以避免重复压缩
    const cacheKey = `${originalSize}-${quality}-${hashCode(data)}`;
    let cached = null;
    try {
      cached = imageCache.get(cacheKey);
      if (cached) {
        return cached;
      }
    } catch (e) {
      // 缓存错误处理，继续执行压缩
      console.warn('Image cache error:', e.message);
    }
    
    // 使用Web Worker进行图像压缩以避免阻塞主线程
    if (typeof Worker !== 'undefined' && originalSize > COMPRESSION_SETTINGS.WORKER_THRESHOLD_SIZE) {
      try {
        const result = await compressImageInWorker(data, quality);
        
        // 缓存结果
        try {
          imageCache.set(cacheKey, result);
        } catch (e) {
          console.warn('Failed to cache image:', e.message);
        }
        
        return result;
      } catch (workerError) {
        console.warn('Worker compression failed, falling back to main thread:', workerError.message);
        // 继续使用主线程压缩
      }
    }
    
    // 如果Worker不可用或失败，在主线程中处理
    const format = await detectFormat(data);
    if (format === 'unknown' || format === 'tiff') {
      return {
        data: data,
        format: format || 'original',
        compressionMethod: 'original',
        originalSize: originalSize,
        compressedSize: originalSize,
        originalDimensions: { width: 0, height: 0 },
        finalDimensions: { width: 0, height: 0 },
        error: `Unsupported format: ${format}`
      };
    }
    
    // 使用共享的处理函数
    const result = await processImage(data, quality, format);
    
    // 缓存结果
    try {
      imageCache.set(cacheKey, result);
    } catch (e) {
      console.warn('Failed to cache image:', e.message);
    }
    
    return result;
  } catch (error) {
    console.error(`[compressImage] General error compressing image:`, error.message);
    return {
      data: data,
      format: 'original',
      compressionMethod: 'original',
      originalSize: originalSize,
      compressedSize: originalSize,
      originalDimensions: { width: 0, height: 0 },
      finalDimensions: { width: 0, height: 0 },
      error: error.message
    };
  }
}

// 导出其他需要的函数
export { 
  ImageType, 
  analyzeImageType, 
  checkAlphaChannel, 
  analyzeImage, 
  calculateOptimalDimensions, 
  detectFormat 
};
