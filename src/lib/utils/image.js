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

async function compressImageInWorker(data, quality, format) {
  return new Promise((resolve, reject) => {
    try {
      const workerPath = new URL('../workers/imageCompression.worker.js', import.meta.url).href;
      const worker = new Worker(workerPath);
      
      const timeoutId = setTimeout(() => {
        worker.terminate();
        reject(new Error('Worker compression timed out'));
      }, 30000);
      
      worker.onmessage = (event) => {
        clearTimeout(timeoutId);
        const { success, result, error } = event.data;
        
        if (success && result) {
          resolve(result);
        } else {
          reject(new Error(error || 'Worker compression failed'));
        }
        
        worker.terminate();
      };
      
      worker.onerror = (error) => {
        clearTimeout(timeoutId);
        worker.terminate();
        reject(new Error(`Worker error: ${error.message}`));
      };
      
      const dataClone = new Uint8Array(data);
      
      worker.postMessage({
        data: dataClone,
        quality,
        format
      }, [dataClone.buffer]);
    } catch (error) {
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
    const cacheKey = `${originalSize}-${quality}-${hashCode(data)}`;
    let cached = null;
    try {
      cached = imageCache.get(cacheKey);
      if (cached) {
        return cached;
      }
    } catch (e) {
      console.warn('Image cache error:', e.message);
    }
    
    if (originalSize <= COMPRESSION_SETTINGS.MIN_COMPRESSION_SIZE_BYTES) {
      const result = {
        data: data,
        format: 'original',
        compressionMethod: 'skipped-small',
        originalSize: originalSize,
        compressedSize: originalSize,
        originalDimensions: { width: 0, height: 0 },
        finalDimensions: { width: 0, height: 0 }
      };
      return result;
    }
    
    const format = await detectFormat(data);
    if (format === 'unknown' || format === 'tiff' || format === 'gif') {
      return {
        data: data,
        format: format || 'original',
        compressionMethod: 'skipped-format',
        originalSize: originalSize,
        compressedSize: originalSize,
        originalDimensions: { width: 0, height: 0 },
        finalDimensions: { width: 0, height: 0 }
      };
    }
    
    if (typeof Worker !== 'undefined' && originalSize > COMPRESSION_SETTINGS.WORKER_THRESHOLD_SIZE) {
      try {
        const result = await compressImageInWorker(data, quality, format);
        
        try {
          imageCache.set(cacheKey, result);
        } catch (e) {
          console.warn('Failed to cache image:', e.message);
        }
        
        return result;
      } catch (workerError) {
        console.warn('Worker compression failed, falling back to main thread:', workerError.message);
      }
    }
    
    const result = await processImage(data, quality, format);
    
    try {
      imageCache.set(cacheKey, result);
    } catch (e) {
      console.warn('Failed to cache image:', e.message);
    }
    
    return result;
  } catch (error) {
    console.error(`[compressImage] Error:`, error.message);
    return {
      data: data,
      format: 'original',
      compressionMethod: 'error',
      originalSize: originalSize,
      compressedSize: originalSize,
      originalDimensions: { width: 0, height: 0 },
      finalDimensions: { width: 0, height: 0 },
      error: error.message
    };
  }
}

export { 
  ImageType, 
  analyzeImageType, 
  checkAlphaChannel, 
  analyzeImage, 
  calculateOptimalDimensions, 
  detectFormat 
};