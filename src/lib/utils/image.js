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

// Use Web Worker for image compression
async function compressImageInWorker(data, quality, format) {
  return new Promise((resolve, reject) => {
    try {
      console.log(`[compressImageInWorker] Starting worker compression: size=${data.byteLength}, quality=${quality}, format=${format || 'auto'}`);
      
      // Create Worker
      const workerPath = new URL('../workers/imageCompression.worker.js', import.meta.url).href;
      const worker = new Worker(workerPath);
      
      // Set timeout
      const timeoutId = setTimeout(() => {
        console.warn('[compressImageInWorker] Worker compression timed out after 30s');
        worker.terminate();
        reject(new Error('Worker compression timed out'));
      }, 30000); // 30 seconds timeout
      
      // Listen for Worker messages
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
        
        // Terminate Worker
        worker.terminate();
      };
      
      // Listen for Worker errors
      worker.onerror = (error) => {
        clearTimeout(timeoutId);
        console.error(`[compressImageInWorker] Worker error: ${error.message}`);
        worker.terminate();
        reject(new Error(`Worker error: ${error.message}`));
      };
      
      // Create transferable data copy
      const dataClone = new Uint8Array(data);
      
      // Send data to Worker
      worker.postMessage({
        data: dataClone,
        quality,
        format
      }, [dataClone.buffer]); // Use Transferable Objects for better performance
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
    // Add cache check to avoid repeated compression
    const cacheKey = `${originalSize}-${quality}-${hashCode(data)}`;
    let cached = null;
    try {
      cached = imageCache.get(cacheKey);
      if (cached) {
        console.log(`[compressImage] Using cached result for ${cacheKey}`);
        return cached;
      }
    } catch (e) {
      console.warn('Image cache error:', e.message);
    }
    
    // Check file size, skip if too small
    if (originalSize <= COMPRESSION_SETTINGS.MIN_COMPRESSION_SIZE_BYTES) {
      console.log(`[compressImage] Skipping compression: image too small (${originalSize} bytes)`);
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
    
    // Detect format
    const format = await detectFormat(data);
    if (format === 'unknown' || format === 'tiff' || format === 'gif') {
      console.log(`[compressImage] Skipping compression: unsupported format (${format})`);
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
    
    // Use Web Worker for image compression to avoid blocking the main thread
    if (typeof Worker !== 'undefined' && originalSize > COMPRESSION_SETTINGS.WORKER_THRESHOLD_SIZE) {
      try {
        console.log(`[compressImage] Using worker for compression (size: ${originalSize} bytes)`);
        const result = await compressImageInWorker(data, quality, format);
        
        // Cache result
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
    
    // If Worker is unavailable or fails, process in main thread
    console.log(`[compressImage] Using main thread for compression (size: ${originalSize} bytes)`);
    const result = await processImage(data, quality, format);
    
    // Cache result
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
      compressionMethod: 'error',
      originalSize: originalSize,
      compressedSize: originalSize,
      originalDimensions: { width: 0, height: 0 },
      finalDimensions: { width: 0, height: 0 },
      error: error.message
    };
  }
}

// Export other needed functions
export { 
  ImageType, 
  analyzeImageType, 
  checkAlphaChannel, 
  analyzeImage, 
  calculateOptimalDimensions, 
  detectFormat 
};
