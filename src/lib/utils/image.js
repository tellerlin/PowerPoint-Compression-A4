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
    const ffmpeg = await getFFmpegInstance();

    // 生成临时文件名
    const inputFileName = `input_${Math.random().toString(36).substring(2, 15)}.${format}`;
    const outputFileName = `output_${Math.random().toString(36).substring(2, 15)}.${format}`;

    try {
      ffmpeg.FS('writeFile', inputFileName, data);
      const args = ['-i', inputFileName];
      
      // 优化压缩参数 - 移除不兼容选项
      if (format === 'png') {
        // 对于PNG，使用更激进的压缩策略
        args.push('-compression_level', '9', '-pred', 'mixed');
        
        // 根据图片大小动态调整缩放
        if (data.length > 2 * 1024 * 1024) {
          args.push('-vf', 'scale=iw*0.6:ih*0.6'); // 大图更激进缩放
        } else if (data.length > 1024 * 1024) {
          args.push('-vf', 'scale=iw*0.7:ih*0.7');
        } else if (data.length > 512 * 1024) {
          args.push('-vf', 'scale=iw*0.8:ih*0.8');
        }
        
        // 添加额外的PNG优化参数
        args.push('-colorspace', 'rgb');
      } else if (format === 'jpeg' || format === 'jpg') {
        // 对于JPEG，使用更智能的质量控制
        const qualityValue = data.length > 1024 * 1024 ? 
          Math.round(quality * 50) : // 大图使用更低质量
          Math.round(quality * 70);
        args.push('-q:v', qualityValue.toString());
        
        // 移除不兼容的参数 (optimize和progressive)
      } else if (format === 'webp') {
        // 对于WebP，使用更激进的压缩
        const qualityValue = Math.round(quality * 70);
        args.push('-quality', qualityValue.toString());
        args.push('-lossless', '0', '-method', '6');
      }
      
      args.push(outputFileName);
      await ffmpeg.run(...args);
      
      const files = ffmpeg.FS('readdir', '/');
      if (!files.includes(outputFileName)) {
        return data;
      }
      
      const outputData = ffmpeg.FS('readFile', outputFileName);
      if (!outputData || outputData.length === 0) {
        return data;
      }

      // 优化回退策略
      const compressionRatio = outputData.length / data.length;
      if (compressionRatio >= 0.95) { // 如果压缩后大小超过原图的95%
        console.log(`[compressImageWithFFmpeg] Poor compression ratio (${compressionRatio.toFixed(2)}), trying alternative format. orig=${data.length}, comp=${outputData.length}`);
        
        // 尝试更激进的压缩
        const aggressiveArgs = ['-i', inputFileName];
        if (format === 'png') {
          aggressiveArgs.push('-compression_level', '9', '-pred', 'mixed', '-vf', 'scale=iw*0.5:ih*0.5');
        } else if (format === 'jpeg' || format === 'jpg') {
          aggressiveArgs.push('-q:v', '40');
        } else if (format === 'webp') {
          aggressiveArgs.push('-quality', '40', '-lossless', '0', '-method', '6');
        }
        aggressiveArgs.push(outputFileName);
        
        try {
          await ffmpeg.run(...aggressiveArgs);
          const aggressiveOutput = ffmpeg.FS('readFile', outputFileName);
          if (aggressiveOutput && aggressiveOutput.length < data.length * 0.9) {
            return new Uint8Array(aggressiveOutput.buffer);
          }
        } catch (e) {
          console.warn('Aggressive compression failed:', e);
        }
        
        // 如果还是失败，尝试转换为WebP
        if (format !== 'webp' && data.length > 50 * 1024) {
          try {
            const webpFilename = outputFileName.replace(/\.[^.]+$/, '.webp');
            const webpArgs = [
              '-i', inputFileName,
              '-quality', '70',
              '-lossless', '0',
              '-method', '6',
              webpFilename
            ];
            await ffmpeg.run(...webpArgs);
            const webpOutput = ffmpeg.FS('readFile', webpFilename);
            if (webpOutput && webpOutput.length < data.length * 0.9) {
              console.log(`[compressImageWithFFmpeg] WebP conversion successful: ${data.length} -> ${webpOutput.length}`);
              return new Uint8Array(webpOutput.buffer);
            }
          } catch (e) {
            console.warn('WebP conversion failed:', e);
          }
        }
        
        return data;
      }
      
      return new Uint8Array(outputData.buffer);
    } catch (error) {
      console.warn('FFmpeg compression failed:', error);
      return data;
    } finally {
      try {
        const files = ffmpeg.FS('readdir', '/');
        if (files.includes(inputFileName)) ffmpeg.FS('unlink', inputFileName);
        if (files.includes(outputFileName)) ffmpeg.FS('unlink', outputFileName);
        // 清理可能的WebP临时文件
        const webpOutput = outputFileName.replace(/\.[^.]+$/, '.webp');
        if (files.includes(webpOutput)) ffmpeg.FS('unlink', webpOutput);
      } catch (e) {}
    }
  });
}

// 修改为完全串行处理，解决FFmpeg只能运行一个命令的问题
async function compressImagesInParallel(images, quality) {
  const results = [];
  
  // 完全串行处理所有图片
  for (const image of images) {
    try {
      const format = await detectFormat(image.data);
      const compressedData = await compressImageWithFFmpeg(image.data, quality, format);
      results.push(compressedData);
    } catch (error) {
      console.error("Error compressing image:", error);
      // 出错时使用原图
      results.push(image.data);
    }
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

export async function compressImage(data, quality = COMPRESSION_SETTINGS.DEFAULT_QUALITY) {
  if (!(data instanceof Uint8Array)) {
    throw new TypeError('compressImage: data must be a Uint8Array');
  }
  if (typeof quality !== 'number' || quality < 0 || quality > 1) {
    throw new RangeError('compressImage: quality must be a number between 0 and 1');
  }
  
  let originalSize = data.byteLength;
  
  // 新增：极大图片先降采样，使用更激进的设置
  if (originalSize > 5 * 1024 * 1024) {
    data = await downsampleImage(data, 1200);
    originalSize = data.byteLength;
  } else if (originalSize > 2 * 1024 * 1024) {
    data = await downsampleImage(data, 1600);
    originalSize = data.byteLength;
  }
  
  try {
    const cacheKey = `${originalSize}-${quality}-${hashCode(data)}`;
    let cached = null;
    try {
      cached = imageCache.get(cacheKey);
      if (cached) {
        return cached;
      }
    } catch (e) {}
    
    if (originalSize <= COMPRESSION_SETTINGS.MIN_COMPRESSION_SIZE_BYTES) {
      return { data, format: 'original', compressionMethod: 'skipped-small', originalSize, compressedSize: originalSize, originalDimensions: { width: 0, height: 0 }, finalDimensions: { width: 0, height: 0 } };
    }
    
    let format = await detectFormat(data);
    
    // 新增：不常用格式自动转为png
    if (['bmp', 'tiff'].includes(format)) {
      // 用ffmpeg转为png
      data = await compressImageWithFFmpeg(data, 1, 'png');
      format = 'png';
    }
    
    if (format === 'unknown' || format === 'gif') {
      return { data, format: format || 'original', compressionMethod: 'skipped-format', originalSize, compressedSize: originalSize, originalDimensions: { width: 0, height: 0 }, finalDimensions: { width: 0, height: 0 } };
    }
    
    // PNG无Alpha时考虑转换格式并择优
    let bestResult = null;
    if (format === 'png') {
      const hasAlpha = await checkAlphaChannel(data);
      if (!hasAlpha) {
        const results = [];
        
        // 尝试PNG压缩
        const pngData = await compressImageWithFFmpeg(data, quality, 'png');
        results.push({ data: pngData, format: 'png' });
        
        // 尝试WebP压缩 (更优先考虑WebP)
        let webpQuality = quality;
        let webpData = await compressImageWithFFmpeg(data, webpQuality, 'webp');
        results.push({ data: webpData, format: 'webp' });
        
        // 尝试JPEG压缩
        let jpegQuality = quality;
        let jpegData = await compressImageWithFFmpeg(data, jpegQuality, 'jpeg');
        results.push({ data: jpegData, format: 'jpeg' });
        
        bestResult = results.reduce((a, b) => (a.data.length < b.data.length ? a : b));
        console.log(`[compressImage] PNG no alpha, best format: ${bestResult.format}, orig=${originalSize}, comp=${bestResult.data.length}`);
      }
    }
    
    if (!bestResult) {
      // 针对不同格式调整压缩策略
      let compressedData = await compressImageWithFFmpeg(data, quality, format);
      
      // 如果压缩效果不好，尝试额外降低质量
      if (compressedData.length > originalSize * 0.9) {
        const lowerQuality = quality * 0.7;
        const recompressedData = await compressImageWithFFmpeg(data, lowerQuality, format);
        
        // 如果重新压缩效果更好，使用重新压缩结果
        if (recompressedData.length < compressedData.length) {
          compressedData = recompressedData;
        }
      }
      
      bestResult = { data: compressedData, format };
      console.log(`[compressImage] format: ${format}, orig=${originalSize}, comp=${compressedData.length}`);
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
    return { data, format: 'original', compressionMethod: 'error', originalSize, compressedSize: originalSize, originalDimensions: { width: 0, height: 0 }, finalDimensions: { width: 0, height: 0 }, error: error.message };
  }
}

export { 
  ImageType, 
  analyzeImageType, 
  checkAlphaChannel, 
  analyzeImage, 
  calculateOptimalDimensions, 
  detectFormat,
  compressImagesInParallel
};