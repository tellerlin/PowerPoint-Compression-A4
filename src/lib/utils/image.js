import { COMPRESSION_SETTINGS } from '../pptx/constants.js';
import { imageCache } from './cache';
import { 
  hashCode, 
  ImageType, 
  analyzeImageType, 
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

// 添加FFmpeg实例缓存
let ffmpegInstance = null;

async function getFFmpegInstance() {
  if (!ffmpegInstance) {
    if (!window.FFmpeg) {
      throw new Error('FFmpeg not loaded');
    }
    ffmpegInstance = window.FFmpeg.createFFmpeg({
      log: true,
      corePath: '/ffmpeg/ffmpeg-core.js'
    });
    await ffmpegInstance.load();
  }
  return ffmpegInstance;
}

// 添加FFmpeg队列管理
let ffmpegQueue = Promise.resolve();

async function queueFFmpegTask(task) {
  return new Promise((resolve, reject) => {
    ffmpegQueue = ffmpegQueue
      .then(() => task())
      .then(resolve)
      .catch(reject)
      .finally(() => {
        // 清理可能的错误状态，确保队列继续执行
        if (ffmpegQueue._state === 'rejected') {
          ffmpegQueue = Promise.resolve();
        }
      });
  });
}

async function compressImageWithFFmpeg(data, quality, format) {
  if (format && format.toLowerCase() === 'png') {
    let hasAlpha = false;
    try {
      hasAlpha = await checkAlphaChannel(data);
    } catch (e) {
      hasAlpha = true;
    }
    if (hasAlpha) {
      const blob = new Blob([data], { type: 'image/png' });
      const bitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0);
      if (bitmap.close) bitmap.close();
      const outBlob = await canvas.convertToBlob({ type: 'image/png' });
      const outData = new Uint8Array(await outBlob.arrayBuffer());
      return outData;
    }
  }
  return queueFFmpegTask(async () => {
    if (!data || data.length === 0) {
      console.error('[compressImageWithFFmpeg] Invalid input data');
      return data;
    }
    const blob = new Blob([data], { type: `image/${format}` });
    const bitmap = await createImageBitmap(blob);
    const { width, height } = bitmap;
    if (bitmap.close) bitmap.close();
    if (width * height < 100) {
      console.log('[compressImageWithFFmpeg] Image too small, skipping compression');
      return data;
    }
    const ffmpeg = await getFFmpegInstance();
    const timestamp = Date.now();
    const inputFileName = `input_${timestamp}.${format}`;
    const outputFileName = `output_${timestamp}.${format}`;
    try {
      let preScaledData = data;
      if (width >= 1600 || height >= 900) {
        console.log('[compressImageWithFFmpeg] Pre-scaling image');
        let targetWidth = width;
        let targetHeight = height;
        if (width >= 1600) {
          const scale = 1600 / width;
          targetWidth = 1600;
          targetHeight = Math.round(height * scale);
        } else if (height >= 900) {
          const scale = 900 / height;
          targetWidth = Math.round(width * scale);
          targetHeight = 900;
        }
        const canvas = new OffscreenCanvas(targetWidth, targetHeight);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(await createImageBitmap(blob), 0, 0, targetWidth, targetHeight);
        const preScaledBlob = await canvas.convertToBlob({ type: `image/${format}` });
        preScaledData = new Uint8Array(await preScaledBlob.arrayBuffer());
      }
      const memoryLimit = Math.max(64, Math.min(256, Math.floor(data.length / 1024 / 1024 * 2)));
      console.log(`[compressImageWithFFmpeg] Using memory limit: ${memoryLimit}MB`);
      ffmpeg.FS('writeFile', inputFileName, preScaledData);
      const args = ['-i', inputFileName];
      args.push('-threads', '1');
      args.push('-max_muxing_queue_size', '1024');
      const maxAllocBytes = memoryLimit * 1024 * 1024;
      args.push('-max_alloc', maxAllocBytes.toString());
      switch (format.toLowerCase()) {
        case 'jpeg':
        case 'jpg': {
          const jpegQuality = Math.max(2, Math.min(31, Math.round(31 - (quality * 29))));
          args.push('-qmin', jpegQuality.toString());
          args.push('-qmax', jpegQuality.toString());
          args.push('-f', 'mjpeg');
          break;
        }
        case 'bmp':
          args.push('-f', 'bmp');
          break;
        case 'webp':
          args.push('-q:v', Math.round(quality * 100).toString());
          args.push('-f', 'webp');
          break;
        case 'png':
          args.push('-compression_level', Math.round((1 - quality) * 9).toString());
          args.push('-f', 'png');
          break;
        default:
          args.push('-f', format);
          break;
      }
      args.push(outputFileName);
      console.log(`[compressImageWithFFmpeg] Running FFmpeg for ${format} with args:`, args);
      await ffmpeg.run(...args);
      let out;
      try {
        out = ffmpeg.FS('readFile', outputFileName);
      } catch (e) {
        console.error(`[compressImageWithFFmpeg] Output file not found: ${outputFileName}`);
        return data;
      }
      try {
        ffmpeg.FS('unlink', inputFileName);
      } catch (e) {}
      try {
        ffmpeg.FS('unlink', outputFileName);
      } catch (e) {}
      if (out && out.length > 0 && out.length < data.length) {
        return out;
      } else {
        console.log('[compressImageWithFFmpeg] Compression not effective, returning original');
        return data;
      }
    } catch (err) {
      console.error(`[compressImageWithFFmpeg] FFmpeg error: ${err.message}`);
      try { ffmpeg.FS('unlink', inputFileName); } catch (e) {}
      try { ffmpeg.FS('unlink', outputFileName); } catch (e) {}
      return data;
    }
  });
}

// 修改为完全串行处理，解决FFmpeg只能运行一个命令的问题
export async function compressImagesInParallel(images, options, onProgress) {
  const results = [];
  const chunkSize = Math.max(1, Math.floor(images.length / navigator.hardwareConcurrency));
  
  // 确保options是一个对象
  const compressionOptions = typeof options === 'object' ? options : { quality: options };
  
  for (let i = 0; i < images.length; i += chunkSize) {
    const chunk = images.slice(i, i + chunkSize);
    const chunkPromises = chunk.map(async (image, index) => {
      try {
        // 传递完整的压缩选项
        const compressed = await compressImage(image.data, compressionOptions);
        if (onProgress) {
          onProgress((i + index + 1) / images.length);
        }
        return compressed;
      } catch (error) {
        console.error(`Failed to compress image ${image.path}:`, error);
        return image.data;
      }
    });
    
    const chunkResults = await Promise.all(chunkPromises);
    results.push(...chunkResults);
  }
  
  return results;
}

// 添加智能质量调整函数
async function adjustQualityByContent(data, format, baseQuality) {
  try {
    const blob = new Blob([data], { type: `image/${format}` });
    const bitmap = await createImageBitmap(blob);
    
    // 分析图片复杂度
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    
    // 计算图片复杂度（这里使用简单的边缘检测作为示例）
    let complexity = 0;
    for (let i = 0; i < imageData.data.length; i += 4) {
      const r = imageData.data[i];
      const g = imageData.data[i + 1];
      const b = imageData.data[i + 2];
      // 简单的边缘检测
      if (Math.abs(r - g) > 30 || Math.abs(g - b) > 30 || Math.abs(r - b) > 30) {
        complexity++;
      }
    }
    
    // 根据复杂度调整质量
    const complexityRatio = complexity / (bitmap.width * bitmap.height);
    if (complexityRatio > 0.3) {
      // 复杂图片使用更高质量
      return baseQuality * 1.2;
    } else if (complexityRatio < 0.1) {
      // 简单图片可以适当降低质量
      return baseQuality * 0.9;
    }
    
    return baseQuality;
  } catch (error) {
    console.warn('[adjustQualityByContent] Error:', error);
    return baseQuality;
  }
}

// 修改降采样函数
async function downsampleImage(data, maxSize = 1800) {
  // 仅支持常见格式
  const format = await detectFormat(data);
  if (!['png', 'jpeg', 'jpg', 'webp'].includes(format)) return data;
  
  // 用ImageBitmap解码
  let bitmap;
  try {
    const blob = new Blob([data], { type: `image/${format}` });
    bitmap = await createImageBitmap(blob);
  } catch (e) {
    return data;
  }
  
  const { width, height } = bitmap;
  
  // 针对超大图片使用更保守的缩放
  let targetMaxSize = maxSize;
  if (data.byteLength > 5 * 1024 * 1024) {
    targetMaxSize = 1400; // 从1200改为1400
  } else if (data.byteLength > 2 * 1024 * 1024) {
    targetMaxSize = 1800; // 从1600改为1800
  }
  
  if (width <= targetMaxSize && height <= targetMaxSize) {
    bitmap.close && bitmap.close();
    return data;
  }
  
  // 计算缩放比例
  const scale = Math.min(targetMaxSize / width, targetMaxSize / height);
  const targetWidth = Math.round(width * scale);
  const targetHeight = Math.round(height * scale);
  
  // 用OffscreenCanvas缩放
  const canvas = new OffscreenCanvas(targetWidth, targetHeight);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
  bitmap.close && bitmap.close();
  
  // 导出为Uint8Array
  const blobOut = await canvas.convertToBlob({ type: `image/${format}` });
  const arrayBuffer = await blobOut.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

// 修改compressImage函数以接受完整的选项对象
export async function compressImage(data, options = {}) {
  console.log('[compressImage] Starting compression with options:', options);
  
  // 使用固定的高质量参数
  const quality = 0.95; // 固定使用95%的质量
  const allowFormatConversion = true; // 始终允许格式转换
  const allowDownsampling = true; // 始终允许降采样
  const maxImageSize = 2000; // 提高最大尺寸限制
  
  console.log('[compressImage] Using high quality compression settings');
  
  if (!(data instanceof Uint8Array)) {
    console.error('[compressImage] Invalid input data type:', typeof data);
    throw new TypeError('compressImage: data must be a Uint8Array');
  }
  
  let originalSize = data.byteLength;
  console.log('[compressImage] Original size:', originalSize);
  
  // 更保守的降采样策略
  if (allowDownsampling) {
    if (originalSize > 5 * 1024 * 1024) {
      console.log('[compressImage] Downsampling large image (>5MB)');
      data = await downsampleImage(data, Math.min(maxImageSize, 1600));
      originalSize = data.byteLength;
      console.log('[compressImage] After downsampling:', originalSize);
    } else if (originalSize > 2 * 1024 * 1024) {
      console.log('[compressImage] Downsampling medium image (>2MB)');
      data = await downsampleImage(data, Math.min(maxImageSize, 2000));
      originalSize = data.byteLength;
      console.log('[compressImage] After downsampling:', originalSize);
    }
  }
  
  try {
    const cacheKey = `${originalSize}-${quality}-${hashCode(data)}`;
    let cached = null;
    try {
      cached = imageCache.get(cacheKey);
      if (cached) {
        console.log('[compressImage] Using cached result');
        return cached;
      }
    } catch (e) {
      console.warn('[compressImage] Cache access failed:', e.message);
    }
    
    if (originalSize <= COMPRESSION_SETTINGS.MIN_COMPRESSION_SIZE_BYTES) {
      console.log('[compressImage] Skipping small image');
      return { data, format: 'original', compressionMethod: 'skipped-small', originalSize, compressedSize: originalSize, originalDimensions: { width: 0, height: 0 }, finalDimensions: { width: 0, height: 0 } };
    }
    
    console.log('[compressImage] Detecting image format');
    let format;
    try {
      format = await detectFormat(data);
      console.log('[compressImage] Detected format:', format);
      if (!format) {
        console.error('[compressImage] Format detection returned null/undefined');
        throw new Error('Format detection failed: returned null/undefined');
      }
    } catch (error) {
      console.error('[compressImage] Format detection failed:', error.message);
      throw new Error(`Format detection failed: ${error.message}`);
    }
    
    let bestResult = null;
    
    // 透明通道拦截：任何带透明通道的图片都禁止进入ffmpeg
    if (format === 'png' || format === 'webp' || format === 'tiff' || format === 'tif' || format === 'gif' || format === 'ico' || format === 'heif' || format === 'heic' || format === 'avif') {
      console.log('[compressImage] Potential transparent image format detected:', format);
      let hasAlpha = false;
      try {
        console.log('[compressImage] Starting alpha channel check');
        hasAlpha = await checkAlphaChannel(data);
        console.log('[compressImage] Alpha channel check result:', hasAlpha);
      } catch (e) {
        console.error('[compressImage] Alpha channel check failed:', e.message);
        console.error('[compressImage] Error stack:', e.stack);
        hasAlpha = true; // 出错时保守地认为有透明通道
      }
      
      if (hasAlpha) {
        console.log('[compressImage] Detected alpha channel, using Canvas processing');
        try {
          const blob = new Blob([data], { type: `image/${format}` });
          console.log('[compressImage] Created blob for Canvas processing, size:', blob.size);
          
          console.log('[compressImage] Creating bitmap');
          const bitmap = await createImageBitmap(blob);
          console.log('[compressImage] Bitmap created, dimensions:', bitmap.width, 'x', bitmap.height);
          
          console.log('[compressImage] Creating OffscreenCanvas');
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            throw new Error('Failed to get 2D context for Canvas processing');
          }
          
          console.log('[compressImage] Drawing image to canvas');
          ctx.drawImage(bitmap, 0, 0);
          bitmap.close && bitmap.close();
          
          console.log('[compressImage] Converting to blob');
          const outBlob = await canvas.convertToBlob({ type: `image/${format}` });
          console.log('[compressImage] Blob created, size:', outBlob.size);
          
          console.log('[compressImage] Converting to Uint8Array');
          const outData = new Uint8Array(await outBlob.arrayBuffer());
          console.log('[compressImage] Final data size:', outData.length);
          
          return { 
            data: outData, 
            format, 
            compressionMethod: 'canvas-alpha', 
            originalSize, 
            compressedSize: outData.length, 
            originalDimensions: { width: bitmap.width, height: bitmap.height }, 
            finalDimensions: { width: bitmap.width, height: bitmap.height } 
          };
        } catch (error) {
          console.error('[compressImage] Canvas processing failed:', error.message);
          console.error('[compressImage] Error stack:', error.stack);
          // 如果Canvas处理失败，返回原始数据
          return { 
            data, 
            format: 'original', 
            compressionMethod: 'canvas-failed', 
            originalSize, 
            compressedSize: originalSize, 
            originalDimensions: { width: 0, height: 0 }, 
            finalDimensions: { width: 0, height: 0 },
            error: error.message 
          };
        }
      } else {
        console.log('[compressImage] No alpha channel detected, proceeding with FFmpeg');
      }
    }
    
    if (!bestResult) {
      console.log(`[compressImage] Compressing as ${format}`);
      try {
        // 使用智能质量调整
        const adjustedQuality = await adjustQualityByContent(data, format, quality);
        console.log('[compressImage] Adjusted quality:', adjustedQuality);
        
        let compressedData = await compressImageWithFFmpeg(data, adjustedQuality, format);
        console.log('[compressImage] Initial compression result size:', compressedData.length);
        
        // 如果压缩效果不好，尝试额外降低质量
        if (compressedData.length > originalSize * 0.9) {
          console.log('[compressImage] Poor compression, trying lower quality');
          const lowerQuality = adjustedQuality * 0.9;
          const recompressedData = await compressImageWithFFmpeg(data, lowerQuality, format);
          
          if (recompressedData.length < compressedData.length) {
            console.log('[compressImage] Lower quality compression successful');
            compressedData = recompressedData;
          }
        }
        
        bestResult = { data: compressedData, format };
        console.log(`[compressImage] Final compression: ${format}, orig=${originalSize}, comp=${compressedData.length}`);
      } catch (error) {
        console.error('[compressImage] FFmpeg compression failed:', error.message);
        console.error('[compressImage] Error stack:', error.stack);
        throw error;
      }
    }
    
    const result = {
      data: bestResult.data,
      format: bestResult.format,
      compressionMethod: 'ffmpeg',
      originalSize: originalSize,
      compressedSize: bestResult.data.length,
      originalDimensions: { width: 0, height: 0 },
      finalDimensions: { width: 0, height: 0 }
    };
    
    try { 
      imageCache.set(cacheKey, result);
      console.log('[compressImage] Result cached successfully');
    } catch (e) {
      console.warn('[compressImage] Failed to cache result:', e.message);
    }
    
    return result;
  } catch (error) {
    console.error('[compressImage] Compression failed:', error.message);
    console.error('[compressImage] Error stack:', error.stack);
    return { 
      data, 
      format: 'original', 
      compressionMethod: 'error', 
      originalSize, 
      compressedSize: originalSize, 
      originalDimensions: { width: 0, height: 0 }, 
      finalDimensions: { width: 0, height: 0 }, 
      error: error.message 
    };
  }
}

// 修改PNG透明度检查方法，增加错误处理
async function checkAlphaChannel(data) {
  try {
    console.log('[checkAlphaChannel] Starting alpha channel check');
    const format = await detectFormat(data);
    console.log('[checkAlphaChannel] Detected format:', format);
    if (format !== 'png') {
      console.log('[checkAlphaChannel] Not a PNG file, skipping check');
      return false;
    }
    
    // 使用Canvas API解析图像
    const blob = new Blob([data], { type: 'image/png' });
    console.log('[checkAlphaChannel] Created blob, size:', blob.size);
    let bitmap;
    try {
      console.log('[checkAlphaChannel] Attempting to create bitmap');
      bitmap = await createImageBitmap(blob);
      console.log('[checkAlphaChannel] Bitmap created successfully, dimensions:', bitmap.width, 'x', bitmap.height);
    } catch (err) {
      console.error('[checkAlphaChannel] Failed to create bitmap:', err.message);
      console.error('[checkAlphaChannel] Error stack:', err.stack);
      return true; // 解析失败时，保守地认为有透明度
    }
    
    // 绘制到canvas上并获取像素数据
    console.log('[checkAlphaChannel] Creating OffscreenCanvas');
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.error('[checkAlphaChannel] Failed to get 2D context');
      bitmap.close && bitmap.close();
      return true;
    }
    
    console.log('[checkAlphaChannel] Drawing image to canvas');
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close && bitmap.close();
    
    let imageData;
    try {
      console.log('[checkAlphaChannel] Getting image data');
      imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      console.log('[checkAlphaChannel] Image data retrieved, size:', imageData.data.length);
    } catch (err) {
      console.error('[checkAlphaChannel] Failed to get image data:', err.message);
      console.error('[checkAlphaChannel] Error stack:', err.stack);
      return true;
    }
    
    // 检查透明度通道
    console.log('[checkAlphaChannel] Checking alpha channel values');
    let alphaCount = 0;
    for (let i = 3; i < imageData.data.length; i += 4) {
      if (imageData.data[i] < 255) {
        alphaCount++;
        if (alphaCount > 0) {
          console.log('[checkAlphaChannel] Found transparent pixel at index:', i);
          return true;
        }
      }
    }
    
    console.log('[checkAlphaChannel] No transparent pixels found');
    return false;
  } catch (error) {
    console.error('[checkAlphaChannel] Unexpected error:', error.message);
    console.error('[checkAlphaChannel] Error stack:', error.stack);
    return true; // 出错时安全地返回有透明通道
  }
}

export { 
  ImageType, 
  analyzeImageType, 
  checkAlphaChannel, 
  analyzeImage, 
  calculateOptimalDimensions, 
  detectFormat,
  getFFmpegInstance
};