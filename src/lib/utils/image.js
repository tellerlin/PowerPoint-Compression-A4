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
let ffmpegLoadPromise = null;

async function getFFmpegInstance() {
  if (!ffmpegLoadPromise) {
    ffmpegLoadPromise = (async () => {
      try {
        if (!window.FFmpeg) {
          throw new Error('FFmpeg not loaded');
        }
        ffmpegInstance = window.FFmpeg.createFFmpeg({
          log: false,
          corePath: '/ffmpeg/ffmpeg-core.js',
          mainName: 'main',
          // 添加内存限制
          memoryLimit: 256 * 1024 * 1024, // 256MB
          // 添加错误处理
          onError: (err) => {
            console.warn('[FFmpeg] Error:', err);
            // 重置实例
            ffmpegInstance = null;
            ffmpegLoadPromise = null;
          }
        });
        await ffmpegInstance.load();
        return ffmpegInstance;
      } catch (error) {
        console.error('[FFmpeg] Failed to load:', error);
        ffmpegInstance = null;
        ffmpegLoadPromise = null;
        throw error;
      }
    })();
  }
  return ffmpegLoadPromise;
}

// 添加FFmpeg队列管理
let ffmpegQueue = Promise.resolve();
let isProcessing = false;

async function queueFFmpegTask(task) {
  return new Promise((resolve, reject) => {
    if (isProcessing) {
      console.warn('[FFmpeg] Task queued while another is processing');
    }
    
    ffmpegQueue = ffmpegQueue
      .then(async () => {
        isProcessing = true;
        try {
          const result = await task();
          return result;
        } catch (error) {
          if (error.message.includes('OOM') || error.message.includes('Out of memory')) {
            console.warn('[FFmpeg] Memory overflow, resetting instance');
            // 重置FFmpeg实例
            ffmpegInstance = null;
            ffmpegLoadPromise = null;
            // 等待一段时间后重试
            await new Promise(resolve => setTimeout(resolve, 1000));
            try {
              const result = await task();
              return result;
            } catch (retryError) {
              console.error('[FFmpeg] Retry failed:', retryError);
              throw retryError;
            }
          }
          throw error;
        } finally {
          isProcessing = false;
        }
      })
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
  let inputFileName = null;
  let outputFileName = null;
  
  return queueFFmpegTask(async () => {
    if (!data || data.length === 0) {
      console.error('[compressImageWithFFmpeg] Invalid input data');
      return data;
    }
    
    try {
      const ffmpeg = await getFFmpegInstance();
      inputFileName = `input_${Math.random().toString(36).substring(2, 15)}.${format}`;
      outputFileName = `output_${Math.random().toString(36).substring(2, 15)}.${format}`;

      ffmpeg.FS('writeFile', inputFileName, data);
      const args = ['-i', inputFileName];
      
      // 使用固定的滤镜参数
      const filterComplex = [
        'nlmeans=s=3:p=3:r=5',
        'unsharp=3:3:0.5:3:3:0.5',
        'eq=contrast=1.05:brightness=0.01:saturation=1.05'
      ].join(',');
      
      args.push('-vf', filterComplex);
      
      if (format === 'png') {
        // 使用更激进的PNG压缩设置
        args.push('-c:v', 'png', '-compression_level', '9', '-threads', '1');
        args.push('-pred', 'mixed'); // 使用混合预测器
        args.push('-color_range', 'jpeg', '-colorspace', 'bt709');
      } else if (format === 'jpeg' || format === 'jpg') {
        // 使用固定的JPEG质量
        args.push('-c:v', 'mjpeg', '-q:v', quality.toString(), '-threads', '1');
        args.push('-color_range', 'jpeg', '-colorspace', 'bt709');
      } else if (format === 'webp') {
        // 使用固定的WebP压缩设置
        args.push('-c:v', 'libwebp', '-quality', quality.toString());
        args.push('-lossless', '0', '-method', '4', '-threads', '1');
        args.push('-pix_fmt', 'yuv420p');
        args.push('-color_range', 'jpeg', '-colorspace', 'bt709');
      }
      
      // 添加基本设置
      args.push('-y'); // 覆盖输出文件
      
      // 根据格式设置输出格式
      if (format === 'jpeg' || format === 'jpg') {
        args.push('-f', 'image2');
      } else if (format === 'png') {
        args.push('-f', 'image2');
      } else if (format === 'webp') {
        args.push('-f', 'image2');
      }
      
      args.push(outputFileName);
      
      try {
        await ffmpeg.run(...args);
      } catch (error) {
        console.warn(`[compressImageWithFFmpeg] FFmpeg error: ${error.message}`);
        return data;
      }
      
      // 检查输出文件是否存在
      const files = ffmpeg.FS('readdir', '/');
      if (!files.includes(outputFileName)) {
        console.warn(`[compressImageWithFFmpeg] Output file not found: ${outputFileName}`);
        return data;
      }
      
      // 读取输出文件
      let outputData;
      try {
        outputData = ffmpeg.FS('readFile', outputFileName);
      } catch (error) {
        console.warn(`[compressImageWithFFmpeg] Error reading output file: ${error.message}`);
        return data;
      }
      
      if (!outputData || outputData.length === 0) {
        console.warn(`[compressImageWithFFmpeg] Empty output file: ${outputFileName}`);
        return data;
      }

      // 检查压缩效果
      if (outputData.length >= data.length * 0.95) {
        console.warn(`[compressImageWithFFmpeg] Poor compression: ${outputData.length} >= ${data.length * 0.95}`);
        return data;
      }
      
      return new Uint8Array(outputData.buffer);
    } catch (error) {
      console.error('[compressImageWithFFmpeg] Error:', error);
      return data;
    }
  });
}

// 添加智能图像处理函数
async function enhanceImage(data, format) {
  let inputFileName = null;
  let outputFileName = null;
  
  try {
    const ffmpeg = await getFFmpegInstance();
    inputFileName = `input_${Math.random().toString(36).substring(2, 15)}.${format}`;
    outputFileName = `output_${Math.random().toString(36).substring(2, 15)}.${format}`;

    // 写入输入文件
    ffmpeg.FS('writeFile', inputFileName, data);
    
    // 直接使用 ImageBitmap 获取图片尺寸
    let dimensions = { width: 0, height: 0 };
    try {
      const blob = new Blob([data], { type: `image/${format}` });
      const bitmap = await createImageBitmap(blob);
      dimensions = {
        width: bitmap.width,
        height: bitmap.height
      };
      console.log(`[enhanceImage] Got dimensions from ImageBitmap: ${dimensions.width}x${dimensions.height}`);
      bitmap.close && bitmap.close();
    } catch (error) {
      console.warn('[enhanceImage] Failed to get dimensions from ImageBitmap:', error);
      dimensions = { width: 1000, height: 1000 };
      console.warn('[enhanceImage] Using default dimensions');
    }
    
    // 根据图片尺寸决定是否跳过增强
    const totalPixels = dimensions.width * dimensions.height;
    
    // 如果图片太大，直接返回原始数据
    if (totalPixels > 500000) { // 超过 707x707
      console.log(`[enhanceImage] Skipping enhancement for large image (${dimensions.width}x${dimensions.height})`);
      return data;
    }
    
    // 根据图片尺寸设置滤镜参数
    let filterComplex;
    
    if (totalPixels > 250000) { // 500x500
      // 中等图片只使用锐化和简单的对比度调整
      filterComplex = 'unsharp=3:3:0.4:3:3:0.4,eq=contrast=1.02:brightness=0.005';
    } else {
      // 小图片使用标准参数
      filterComplex = [
        'nlmeans=s=3:p=3:r=5',
        'unsharp=3:3:0.5:3:3:0.5',
        'eq=contrast=1.03:brightness=0.008:saturation=1.03'
      ].join(',');
    }

    console.log(`[enhanceImage] Processing image ${dimensions.width}x${dimensions.height}`);
    console.log(`[enhanceImage] Using filter: ${filterComplex}`);

    const args = [
      '-i', inputFileName,
      '-vf', filterComplex,
      '-c:v', format === 'webp' ? 'libwebp' : format === 'png' ? 'png' : 'mjpeg',
      '-y',
      outputFileName
    ];

    try {
      await ffmpeg.run(...args);
    } catch (error) {
      if (error.message.includes('OOM') || error.message.includes('Out of memory')) {
        console.warn('[enhanceImage] Memory overflow, skipping enhancement');
        return data;
      }
      console.warn('[enhanceImage] FFmpeg processing error:', error);
      return data;
    }
    
    // 检查输出文件是否存在
    const files = ffmpeg.FS('readdir', '/');
    if (!files.includes(outputFileName)) {
      console.warn('[enhanceImage] Output file not found:', outputFileName);
      return data;
    }
    
    // 读取输出文件
    let outputData;
    try {
      outputData = ffmpeg.FS('readFile', outputFileName);
    } catch (error) {
      console.warn('[enhanceImage] Error reading output file:', error);
      return data;
    }
    
    if (!outputData || outputData.length === 0) {
      console.warn('[enhanceImage] Empty output file');
      return data;
    }
    
    return new Uint8Array(outputData.buffer);
  } catch (error) {
    console.error('[enhanceImage] Error:', error);
    return data;
  } finally {
    // 清理文件
    try {
      const ffmpeg = await getFFmpegInstance();
      const files = ffmpeg.FS('readdir', '/');
      if (inputFileName && files.includes(inputFileName)) {
        ffmpeg.FS('unlink', inputFileName);
      }
      if (outputFileName && files.includes(outputFileName)) {
        ffmpeg.FS('unlink', outputFileName);
      }
    } catch (e) {
      console.warn('[enhanceImage] Error cleaning up files:', e);
    }
  }
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
    let adjustedQuality = baseQuality;
    
    if (complexityRatio > 0.3) {
      // 复杂图片使用更高质量，但不超过100
      adjustedQuality = Math.min(baseQuality * 1.2, 1.0);
    } else if (complexityRatio < 0.1) {
      // 简单图片可以适当降低质量
      adjustedQuality = baseQuality * 0.9;
    }
    
    // 确保quality值在0-100范围内
    return Math.min(Math.max(adjustedQuality, 0), 1.0);
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

// 添加预处理图片尺寸的函数
async function preprocessImageDimensions(data, maxWidth = 1600, maxHeight = 900) {
  try {
    const format = await detectFormat(data);
    if (!['png', 'jpeg', 'jpg', 'webp'].includes(format)) return data;
    
    const blob = new Blob([data], { type: `image/${format}` });
    const bitmap = await createImageBitmap(blob);
    
    const { width, height } = bitmap;
    
    // 如果图片尺寸已经小于目标尺寸，直接返回
    if (width <= maxWidth && height <= maxHeight) {
      bitmap.close && bitmap.close();
      return data;
    }
    
    // 计算等比例缩放后的尺寸
    const scale = Math.min(maxWidth / width, maxHeight / height);
    const targetWidth = Math.round(width * scale);
    const targetHeight = Math.round(height * scale);
    
    // 使用OffscreenCanvas进行缩放
    const canvas = new OffscreenCanvas(targetWidth, targetHeight);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
    bitmap.close && bitmap.close();
    
    // 导出为Uint8Array
    const blobOut = await canvas.convertToBlob({ type: `image/${format}` });
    const arrayBuffer = await blobOut.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  } catch (error) {
    console.warn('[preprocessImageDimensions] Error:', error);
    return data;
  }
}

// 修改compressImage函数
export async function compressImage(data, options = {}) {
  const quality = 0.98;
  const allowFormatConversion = true;
  const allowDownsampling = true;
  const maxImageSize = 2000;
  
  if (!(data instanceof Uint8Array)) {
    throw new TypeError('compressImage: data must be a Uint8Array');
  }
  
  let originalSize = data.byteLength;
  let dimensions = { width: 0, height: 0 };
  let format = 'unknown';
  
  try {
    try {
      format = await detectFormat(data);
    } catch (error) {
      console.warn('[compressImage] Failed to detect format:', error);
    }
    
    try {
      const blob = new Blob([data], { type: `image/${format}` });
      const bitmap = await createImageBitmap(blob);
      dimensions = {
        width: bitmap.width,
        height: bitmap.height
      };
      bitmap.close && bitmap.close();
    } catch (error) {
      console.warn('[compressImage] Failed to get dimensions:', error);
      if (originalSize > 4 * 1024 * 1024) {
        dimensions = { width: 2000, height: 2000 };
      } else if (originalSize > 1 * 1024 * 1024) {
        dimensions = { width: 1500, height: 1500 };
      } else {
        dimensions = { width: 1000, height: 1000 };
      }
    }
    
    const totalPixels = dimensions.width * dimensions.height;
    const shouldUseUltraConservativeStrategy = 
      totalPixels > 2000000 || 
      originalSize > 4 * 1024 * 1024;
    
    if (shouldUseUltraConservativeStrategy) {
      try {
        const targetSize = Math.min(1000, Math.sqrt(totalPixels) * 0.5);
        const scale = Math.min(targetSize / dimensions.width, targetSize / dimensions.height);
        const targetWidth = Math.max(1, Math.round(dimensions.width * scale));
        const targetHeight = Math.max(1, Math.round(dimensions.height * scale));
        
        const canvas = new OffscreenCanvas(targetWidth, targetHeight);
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        const blob = new Blob([data], { type: `image/${format}` });
        const bitmap = await createImageBitmap(blob);
        ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
        bitmap.close && bitmap.close();
        
        const jpegBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
        const jpegData = new Uint8Array(await jpegBlob.arrayBuffer());
        
        return {
          data: jpegData,
          format: 'jpeg',
          compressionMethod: 'ultra-conservative',
          originalSize: originalSize,
          compressedSize: jpegData.length,
          originalDimensions: dimensions,
          finalDimensions: { width: targetWidth, height: targetHeight }
        };
      } catch (error) {
        console.warn('[compressImage] Ultra conservative strategy failed:', error);
        try {
          const jpegData = await compressImageWithFFmpeg(data, 0.9, 'jpeg');
          return {
            data: jpegData,
            format: 'jpeg',
            compressionMethod: 'fallback-jpeg',
            originalSize: originalSize,
            compressedSize: jpegData.length,
            originalDimensions: dimensions,
            finalDimensions: dimensions
          };
        } catch (jpegError) {
          console.warn('[compressImage] JPEG conversion failed:', jpegError);
          return {
            data,
            format: format || 'original',
            compressionMethod: 'failed',
            originalSize,
            compressedSize: originalSize,
            originalDimensions: dimensions,
            finalDimensions: dimensions
          };
        }
      }
    }
    
    try {
      data = await preprocessImageDimensions(data);
      originalSize = data.byteLength;
    } catch (error) {
      console.warn('[compressImage] Dimension preprocessing failed:', error);
    }
    
    if (allowDownsampling) {
      try {
        if (originalSize > 5 * 1024 * 1024) {
          data = await downsampleImage(data, Math.min(maxImageSize, 1600));
          originalSize = data.byteLength;
        } else if (originalSize > 2 * 1024 * 1024) {
          data = await downsampleImage(data, Math.min(maxImageSize, 2000));
          originalSize = data.byteLength;
        }
      } catch (error) {
        console.warn('[compressImage] Downsampling failed:', error);
      }
    }
    
    const cacheKey = `${originalSize}-${quality}-${hashCode(data)}`;
    let cached = null;
    try {
      cached = imageCache.get(cacheKey);
      if (cached) {
        return cached;
      }
    } catch (e) {}
    
    if (originalSize <= COMPRESSION_SETTINGS.MIN_COMPRESSION_SIZE_BYTES) {
      return { data, format: 'original', compressionMethod: 'skipped-small', originalSize, compressedSize: originalSize, originalDimensions: dimensions, finalDimensions: dimensions };
    }
    
    const shouldSkipEnhancement = 
      totalPixels > 500000 || 
      originalSize > 4 * 1024 * 1024 || 
      format === 'gif' || 
      format === 'unknown';
    
    if (!shouldSkipEnhancement) {
      try {
        data = await enhanceImage(data, format);
      } catch (error) {
        console.warn('[compressImage] Enhancement failed:', error);
      }
    }
    
    if (allowFormatConversion && ['bmp', 'tiff'].includes(format)) {
      try {
        data = await compressImageWithFFmpeg(data, 1, 'png');
        format = 'png';
      } catch (error) {
        console.warn('[compressImage] Format conversion failed:', error);
      }
    }
    
    if (format === 'unknown' || format === 'gif') {
      return { data, format: format || 'original', compressionMethod: 'skipped-format', originalSize, compressedSize: originalSize, originalDimensions: dimensions, finalDimensions: dimensions };
    }
    
    const shouldUseConservativeCompression = 
      totalPixels > 1000000 || 
      originalSize > 2 * 1024 * 1024;
    
    let bestResult = null;
    if (format === 'png' && allowFormatConversion) {
      let hasAlpha = false;
      try {
        hasAlpha = await checkAlphaChannel(data);
      } catch (error) {
        console.warn('[compressImage] PNG alpha check failed, assuming alpha:', error);
        hasAlpha = true;
      }
      
      if (!hasAlpha) {
        const results = [];
        
        try {
          if (shouldUseConservativeCompression) {
            const jpegQuality = 0.95;
            const jpegData = await compressImageWithFFmpeg(data, jpegQuality, 'jpeg');
            results.push({ data: jpegData, format: 'jpeg' });
          } else {
            let webpQuality = await adjustQualityByContent(data, 'webp', quality * 1.2);
            let webpData = await compressImageWithFFmpeg(data, webpQuality, 'webp');
            results.push({ data: webpData, format: 'webp' });
            
            if (webpData.length > originalSize * 0.95) {
              try {
                const pngQuality = await adjustQualityByContent(data, 'png', quality);
                const pngData = await compressImageWithFFmpeg(data, pngQuality, 'png');
                results.push({ data: pngData, format: 'png' });
              } catch (error) {
                console.warn('[compressImage] PNG compression failed:', error);
              }
              
              try {
                const jpegQuality = await adjustQualityByContent(data, 'jpeg', quality);
                const jpegData = await compressImageWithFFmpeg(data, jpegQuality, 'jpeg');
                results.push({ data: jpegData, format: 'jpeg' });
              } catch (error) {
                console.warn('[compressImage] JPEG compression failed:', error);
              }
            }
          }
          
          if (results.length > 0) {
            bestResult = results.reduce((a, b) => (a.data.length < b.data.length ? a : b));
            console.log(`[compressImage] ${bestResult.format}: ${originalSize} -> ${bestResult.data.length} bytes`);
          }
        } catch (error) {
          console.warn('[compressImage] Format optimization failed:', error);
        }
      }
    }
    
    if (!bestResult) {
      try {
        const adjustedQuality = shouldUseConservativeCompression ? 0.95 : await adjustQualityByContent(data, format, quality);
        let compressedData = await compressImageWithFFmpeg(data, adjustedQuality, format);
        
        if (compressedData.length > originalSize * 0.95) {
          try {
            const higherQuality = Math.min(1, adjustedQuality * 1.1);
            const recompressedData = await compressImageWithFFmpeg(data, higherQuality, format);
            
            if (recompressedData.length < compressedData.length) {
              compressedData = recompressedData;
            }
          } catch (error) {
            console.warn('[compressImage] Recompression failed:', error);
          }
        }
        
        bestResult = { data: compressedData, format };
        console.log(`[compressImage] ${format}: ${originalSize} -> ${compressedData.length} bytes`);
      } catch (error) {
        console.warn('[compressImage] Compression failed:', error);
        bestResult = { data, format };
      }
    }
    
    const result = {
      data: bestResult.data,
      format: bestResult.format,
      compressionMethod: 'ffmpeg',
      originalSize: originalSize,
      compressedSize: bestResult.data.length,
      originalDimensions: dimensions,
      finalDimensions: dimensions
    };
    
    try { imageCache.set(cacheKey, result); } catch (e) {}
    return result;
  } catch (error) {
    console.error('[compressImage] Error:', error);
    return { 
      data, 
      format: format || 'original', 
      compressionMethod: 'error', 
      originalSize, 
      compressedSize: originalSize, 
      originalDimensions: dimensions, 
      finalDimensions: dimensions, 
      error: error.message 
    };
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