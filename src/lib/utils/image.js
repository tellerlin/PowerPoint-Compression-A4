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
      
      if (format === 'png') {
        // 使用基本的PNG压缩设置
        args.push('-c:v', 'png', '-compression_level', '4', '-threads', '1');
        args.push('-color_range', 'jpeg', '-colorspace', 'bt709');
      } else if (format === 'jpeg' || format === 'jpg') {
        // 使用基本的JPEG压缩设置
        const qualityValue = data.length > 1024 * 1024 ? 
          Math.round(quality * 75) : 
          Math.round(quality * 90);
        args.push('-c:v', 'mjpeg', '-q:v', qualityValue.toString(), '-threads', '1');
        args.push('-color_range', 'jpeg', '-colorspace', 'bt709');
      } else if (format === 'webp') {
        // 使用基本的WebP压缩设置
        const qualityValue = Math.round(quality * 90);
        args.push('-c:v', 'libwebp', '-quality', qualityValue.toString());
        args.push('-lossless', '0', '-method', '3', '-threads', '1');
        // 添加YUV颜色空间转换选项
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
      
      console.log(`[compressImageWithFFmpeg] Running FFmpeg for ${format} with args:`, args);
      
      try {
        await ffmpeg.run(...args);
      } catch (error) {
        console.warn(`[compressImageWithFFmpeg] FFmpeg error: ${error.message}`);
        return data;
      }
      
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
      
      // 检查压缩效果，提高阈值
      if (outputData.length >= data.length * 0.95) { // 从1.0改为0.95
        console.log(`[compressImageWithFFmpeg] Poor compression: ${outputData.length} >= ${data.length * 0.95}`);
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
  // 使用固定的高质量参数
  const quality = 0.95; // 固定使用95%的质量
  const allowFormatConversion = true; // 始终允许格式转换
  const allowDownsampling = true; // 始终允许降采样
  const maxImageSize = 2000; // 提高最大尺寸限制
  
  console.log('[compressImage] Using high quality compression settings');
  
  if (!(data instanceof Uint8Array)) {
    throw new TypeError('compressImage: data must be a Uint8Array');
  }
  
  let originalSize = data.byteLength;
  console.log('[compressImage] Original size:', originalSize);
  
  // 首先进行尺寸预处理
  console.log('[compressImage] Preprocessing image dimensions');
  data = await preprocessImageDimensions(data);
  originalSize = data.byteLength;
  console.log('[compressImage] After dimension preprocessing:', originalSize);
  
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
    } catch (e) {}
    
    if (originalSize <= COMPRESSION_SETTINGS.MIN_COMPRESSION_SIZE_BYTES) {
      console.log('[compressImage] Skipping small image');
      return { data, format: 'original', compressionMethod: 'skipped-small', originalSize, compressedSize: originalSize, originalDimensions: { width: 0, height: 0 }, finalDimensions: { width: 0, height: 0 } };
    }
    
    let format = await detectFormat(data);
    console.log('[compressImage] Detected format:', format);
    
    // 格式转换策略
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
        hasAlpha = true;
      }
      
      if (!hasAlpha) {
        console.log('[compressImage] PNG without alpha, trying multiple formats');
        const results = [];
        
        // 优先尝试WebP
        console.log('[compressImage] Trying WebP compression first');
        let webpQuality = await adjustQualityByContent(data, 'webp', quality * 1.1);
        let webpData = await compressImageWithFFmpeg(data, webpQuality, 'webp');
        results.push({ data: webpData, format: 'webp' });
        
        // 如果WebP压缩效果不理想，尝试其他格式
        if (webpData.length > originalSize * 0.9) { // 从0.8改为0.9
          // 尝试PNG压缩
          console.log('[compressImage] Trying PNG compression');
          const pngQuality = await adjustQualityByContent(data, 'png', quality);
          const pngData = await compressImageWithFFmpeg(data, pngQuality, 'png');
          results.push({ data: pngData, format: 'png' });
          
          // 尝试JPEG压缩
          console.log('[compressImage] Trying JPEG compression');
          const jpegQuality = await adjustQualityByContent(data, 'jpeg', quality);
          const jpegData = await compressImageWithFFmpeg(data, jpegQuality, 'jpeg');
          results.push({ data: jpegData, format: 'jpeg' });
        }
        
        bestResult = results.reduce((a, b) => (a.data.length < b.data.length ? a : b));
        console.log(`[compressImage] Best format: ${bestResult.format}, orig=${originalSize}, comp=${bestResult.data.length}`);
      }
    }
    
    if (!bestResult) {
      console.log(`[compressImage] Compressing as ${format}`);
      // 使用智能质量调整
      const adjustedQuality = await adjustQualityByContent(data, format, quality);
      let compressedData = await compressImageWithFFmpeg(data, adjustedQuality, format);
      
      // 如果压缩效果不好，尝试额外降低质量
      if (compressedData.length > originalSize * 0.9) { // 从0.85改为0.9
        console.log('[compressImage] Poor compression, trying lower quality');
        const lowerQuality = adjustedQuality * 0.9; // 从0.8改为0.9
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