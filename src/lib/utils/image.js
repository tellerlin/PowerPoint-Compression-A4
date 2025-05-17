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
  return queueFFmpegTask(async () => {
    // 添加额外验证
    if (!data || data.length === 0) {
      console.error('[compressImageWithFFmpeg] Invalid input data');
      return data;
    }
    
    const ffmpeg = await getFFmpegInstance();

    const inputFileName = `input_${Math.random().toString(36).substring(2, 15)}.${format}`;
    const outputFileName = `output_${Math.random().toString(36).substring(2, 15)}.${format}`;

    try {
      ffmpeg.FS('writeFile', inputFileName, data);
      const args = ['-i', inputFileName];
      
      // 更激进的压缩策略
      if (format === 'png') {
        // 使用更安全的PNG压缩参数
        args.push('-compression_level', '9');
        
        // 尝试使用更简单的过滤器
        if (data.length > 512 * 1024) {
          // 大文件使用简单的缩放过滤器
          args.push('-vf', 'scale=iw*0.7:ih*0.7');
        }
        
        // 使用安全的PNG编码参数
        args.push('-pred', 'none', '-f', 'png');
      } else if (format === 'jpeg' || format === 'jpg') {
        // JPEG压缩参数不变
        const qualityValue = data.length > 512 * 1024 ? 
          Math.round(quality * 40) : 
          Math.round(quality * 60);
        args.push('-q:v', qualityValue.toString());
      } else if (format === 'webp') {
        // WebP压缩参数不变
        const qualityValue = Math.round(quality * 60);
        args.push('-quality', qualityValue.toString());
        args.push('-lossless', '0', '-method', '6');
      }
      
      args.push(outputFileName);
      
      console.log(`[compressImageWithFFmpeg] Running FFmpeg for ${format} with args:`, args);
      await ffmpeg.run(...args);
      
      const files = ffmpeg.FS('readdir', '/');
      if (!files.includes(outputFileName)) {
        console.warn(`[compressImageWithFFmpeg] Output file not found: ${outputFileName}`);
        return data;
      }
      
      const outputData = ffmpeg.FS('readFile', outputFileName);
      if (!outputData || outputData.length === 0) {
        console.warn(`[compressImageWithFFmpeg] Empty output file: ${outputFileName}`);
        return data;
      }

      console.log(`[compressImageWithFFmpeg] Compression result: ${format}, ${data.length} -> ${outputData.length}`);
      
      // 检查压缩效果
      if (outputData.length >= data.length) {
        console.log(`[compressImageWithFFmpeg] No size reduction: ${outputData.length} >= ${data.length}`);
        return data;
      }
      
      return new Uint8Array(outputData.buffer);
    } catch (error) {
      console.error('[compressImageWithFFmpeg] Error:', error);
      return data;
    } finally {
      try {
        const files = ffmpeg.FS('readdir', '/');
        if (files.includes(inputFileName)) ffmpeg.FS('unlink', inputFileName);
        if (files.includes(outputFileName)) ffmpeg.FS('unlink', outputFileName);
      } catch (e) {
        console.warn('[compressImageWithFFmpeg] Error cleaning up files:', e);
      }
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

// 新增：图片自动降采样 - 增强处理大图片的能力
async function downsampleImage(data, maxSize = 1600) {
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
  
  // 针对超大图片使用更激进的缩放
  let targetMaxSize = maxSize;
  if (data.byteLength > 5 * 1024 * 1024) {
    targetMaxSize = 1200; // 5MB以上图片缩放更激进
  } else if (data.byteLength > 2 * 1024 * 1024) {
    targetMaxSize = 1400; // 2MB以上图片适度缩放
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
  // 处理向后兼容性
  const quality = typeof options === 'number' ? options : options.quality || COMPRESSION_SETTINGS.DEFAULT_QUALITY;
  const allowFormatConversion = options.allowFormatConversion ?? true;
  const allowDownsampling = options.allowDownsampling ?? true;
  const maxImageSize = options.maxImageSize || COMPRESSION_SETTINGS.MAX_IMAGE_SIZE;
  
  console.log('[compressImage] Compression options:', {
    quality,
    allowFormatConversion,
    allowDownsampling,
    maxImageSize
  });
  
  if (!(data instanceof Uint8Array)) {
    throw new TypeError('compressImage: data must be a Uint8Array');
  }
  if (typeof quality !== 'number' || quality < 0 || quality > 1) {
    throw new RangeError('compressImage: quality must be a number between 0 and 1');
  }
  
  let originalSize = data.byteLength;
  console.log('[compressImage] Original size:', originalSize);
  
  // 根据选项决定是否进行降采样
  if (allowDownsampling) {
    if (originalSize > 5 * 1024 * 1024) {
      console.log('[compressImage] Downsampling large image (>5MB)');
      data = await downsampleImage(data, Math.min(maxImageSize, 1200));
      originalSize = data.byteLength;
      console.log('[compressImage] After downsampling:', originalSize);
    } else if (originalSize > 2 * 1024 * 1024) {
      console.log('[compressImage] Downsampling medium image (>2MB)');
      data = await downsampleImage(data, Math.min(maxImageSize, 1600));
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
    } catch (e) {}
    
    if (originalSize <= COMPRESSION_SETTINGS.MIN_COMPRESSION_SIZE_BYTES) {
      console.log('[compressImage] Skipping small image');
      return { data, format: 'original', compressionMethod: 'skipped-small', originalSize, compressedSize: originalSize, originalDimensions: { width: 0, height: 0 }, finalDimensions: { width: 0, height: 0 } };
    }
    
    let format = await detectFormat(data);
    console.log('[compressImage] Detected format:', format);
    
    // 根据选项决定是否转换格式
    if (allowFormatConversion && ['bmp', 'tiff'].includes(format)) {
      console.log('[compressImage] Converting format from', format, 'to png');
      data = await compressImageWithFFmpeg(data, 1, 'png');
      format = 'png';
    }
    
    if (format === 'unknown' || format === 'gif') {
      console.log('[compressImage] Skipping unsupported format:', format);
      return { data, format: format || 'original', compressionMethod: 'skipped-format', originalSize, compressedSize: originalSize, originalDimensions: { width: 0, height: 0 }, finalDimensions: { width: 0, height: 0 } };
    }
    
    // PNG无Alpha时考虑转换格式并择优
    let bestResult = null;
    if (format === 'png' && allowFormatConversion) {
      let hasAlpha = false;
      try {
        hasAlpha = await checkAlphaChannel(data);
        console.log('[compressImage] PNG alpha check:', hasAlpha);
      } catch (error) {
        console.warn('[compressImage] PNG alpha check failed, assuming alpha:', error);
        hasAlpha = true; // 出错时保守处理
      }
      
      if (!hasAlpha) {
        console.log('[compressImage] PNG without alpha, trying multiple formats');
        const results = [];
        
        // 尝试PNG压缩
        console.log('[compressImage] Trying PNG compression');
        const pngData = await compressImageWithFFmpeg(data, quality, 'png');
        results.push({ data: pngData, format: 'png' });
        
        // 尝试WebP压缩
        console.log('[compressImage] Trying WebP compression');
        let webpQuality = quality;
        let webpData = await compressImageWithFFmpeg(data, webpQuality, 'webp');
        results.push({ data: webpData, format: 'webp' });
        
        // 尝试JPEG压缩
        console.log('[compressImage] Trying JPEG compression');
        let jpegQuality = quality;
        let jpegData = await compressImageWithFFmpeg(data, jpegQuality, 'jpeg');
        results.push({ data: jpegData, format: 'jpeg' });
        
        bestResult = results.reduce((a, b) => (a.data.length < b.data.length ? a : b));
        console.log(`[compressImage] Best format: ${bestResult.format}, orig=${originalSize}, comp=${bestResult.data.length}`);
      }
    }
    
    if (!bestResult) {
      console.log(`[compressImage] Compressing as ${format}`);
      let compressedData = await compressImageWithFFmpeg(data, quality, format);
      
      // 如果压缩效果不好，尝试额外降低质量
      if (compressedData.length > originalSize * 0.9) {
        console.log('[compressImage] Poor compression, trying lower quality');
        const lowerQuality = quality * 0.7;
        const recompressedData = await compressImageWithFFmpeg(data, lowerQuality, format);
        
        if (recompressedData.length < compressedData.length) {
          console.log('[compressImage] Lower quality compression successful');
          compressedData = recompressedData;
        }
      }
      
      bestResult = { data: compressedData, format };
      console.log(`[compressImage] Final compression: ${format}, orig=${originalSize}, comp=${compressedData.length}`);
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
    
    try { imageCache.set(cacheKey, result); } catch (e) {}
    return result;
  } catch (error) {
    console.error('[compressImage] Error:', error);
    return { data, format: 'original', compressionMethod: 'error', originalSize, compressedSize: originalSize, originalDimensions: { width: 0, height: 0 }, finalDimensions: { width: 0, height: 0 }, error: error.message };
  }
}

// 修改PNG透明度检查方法，增加错误处理
async function checkAlphaChannel(data) {
  try {
    const format = await detectFormat(data);
    if (format !== 'png') return false;
    
    // 使用Canvas API解析图像
    const blob = new Blob([data], { type: 'image/png' });
    let bitmap;
    try {
      bitmap = await createImageBitmap(blob);
    } catch (err) {
      console.warn('[checkAlphaChannel] Failed to create bitmap:', err.message);
      return true; // 解析失败时，保守地认为有透明度
    }
    
    // 绘制到canvas上并获取像素数据
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.warn('[checkAlphaChannel] Failed to get 2D context');
      bitmap.close && bitmap.close();
      return true;
    }
    
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close && bitmap.close();
    
    let imageData;
    try {
      imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    } catch (err) {
      console.warn('[checkAlphaChannel] Failed to get image data:', err.message);
      return true;
    }
    
    // 检查透明度通道
    for (let i = 3; i < imageData.data.length; i += 4) {
      if (imageData.data[i] < 255) return true;
    }
    
    return false;
  } catch (error) {
    console.error('[checkAlphaChannel] Error:', error);
    return true; // 出错时安全地返回有透明通道
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