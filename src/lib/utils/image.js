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

// 添加hashCode函数定义
function hashCode(data) {
  // 优化：使用更高效的采样方法
  let hash = 0;
  const length = data.length;
  // 对于大文件，采样更少的点以提高性能
  const step = length > 1000000 ? Math.floor(length / 50) : 
               length > 100000 ? Math.floor(length / 100) : 
               Math.max(1, Math.floor(length / 200));
  
  for (let i = 0; i < length; i += step) {
    hash = ((hash << 5) - hash) + data[i];
    hash |= 0;  // 转换为32位整数
  }
  return hash.toString(16);
}

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

// 修改 FFmpeg 实例管理
let ffmpegInstance = null;
let isFFmpegLoading = false;
let ffmpegLoadPromise = null;

async function getFFmpegInstance() {
  // 如果实例存在且已加载，直接返回
  if (ffmpegInstance && !isFFmpegLoading) {
    return ffmpegInstance;
  }

  // 如果正在加载，等待加载完成
  if (isFFmpegLoading && ffmpegLoadPromise) {
    return ffmpegLoadPromise;
  }

  // 开始新的加载过程
  isFFmpegLoading = true;
  ffmpegLoadPromise = (async () => {
    try {
      const createFFmpegFn = window.createFFmpeg || window.FFmpeg?.createFFmpeg;
      if (!createFFmpegFn) {
        throw new Error('FFmpeg creation function not found');
      }

      // 如果存在旧实例，先清理
      if (ffmpegInstance) {
        try {
          await cleanupFFmpegMemory(ffmpegInstance);
          await ffmpegInstance.exit();
        } catch (error) {
          // Ignore cleanup errors
        }
        ffmpegInstance = null;
      }

      // 创建新实例
      ffmpegInstance = createFFmpegFn({
        log: false,
        corePath: '/ffmpeg/ffmpeg-core.js',
        logger: ({ message }) => {
          // 只记录严重错误
          if (typeof message === 'string' && 
              message.includes('fatal error')) {
            console.error('[FFmpeg]', message);
          }
        },
        memoryLimit: 256 * 1024 * 1024,
        maxMemory: 512 * 1024 * 1024,
        threads: 2
      });

      // 等待加载完成
      await ffmpegInstance.load();
      return ffmpegInstance;
    } catch (error) {
      // 重置状态
      ffmpegInstance = null;
      isFFmpegLoading = false;
      ffmpegLoadPromise = null;
      throw error;
    } finally {
      isFFmpegLoading = false;
      ffmpegLoadPromise = null;
    }
  })();

  return ffmpegLoadPromise;
}

// 修改重置函数
async function resetFFmpegInstance() {
  if (!ffmpegInstance) return;

  try {
    // Immediately try to handle any running processes
    if (ffmpegInstance.isRunning && ffmpegInstance.isRunning()) {
      try {
        // Try to force terminate
        if (ffmpegInstance.terminate) {
          await ffmpegInstance.terminate();
        } else if (ffmpegInstance.exit) {
          await ffmpegInstance.exit();
        }
      } catch (e) {
        // Ignore normal exit status
      }
    }

    // Clean up memory
    try {
      await cleanupFFmpegMemory(ffmpegInstance);
    } catch (cleanupError) {
      // Ignore cleanup errors
    }

    // Try to clean up file system
    try {
      if (ffmpegInstance.FS) {
        const files = ffmpegInstance.FS('readdir', '/');
        for (const file of files) {
          if (file.startsWith('input_') || file.startsWith('output_')) {
            try {
              ffmpegInstance.FS('unlink', file);
            } catch (e) {
              // Ignore file deletion errors
            }
          }
        }
      }
    } catch (fsError) {
      // Ignore file system errors
    }

    // Force termination strategy
    let exitAttempted = false;
    
    // Try normal exit
    try {
      await ffmpegInstance.exit();
      exitAttempted = true;
    } catch (exitError) {
      // Try force terminate
      if (ffmpegInstance.terminate) {
        try {
          await ffmpegInstance.terminate();
          exitAttempted = true;
        } catch (terminateError) {
          // Ignore termination errors
        }
      }
    }

    // Remove all references to help garbage collection
    const tmpInstance = ffmpegInstance;
    ffmpegInstance = null;
    isFFmpegLoading = false;
    ffmpegLoadPromise = null;
    
    // Try to delete all properties to help garbage collection
    if (tmpInstance) {
      for (const prop in tmpInstance) {
        try {
          tmpInstance[prop] = null;
        } catch (e) {
          // Ignore
        }
      }
    }

    // Force garbage collection
    try {
      if (typeof global !== 'undefined' && global.gc) {
        global.gc();
      }
    } catch (e) {
      // Ignore GC errors
    }
  } catch (error) {
    // Clear instance even if error occurs
    ffmpegInstance = null;
    isFFmpegLoading = false;
    ffmpegLoadPromise = null;
  }
}

// 添加FFmpeg队列管理
let ffmpegQueue = Promise.resolve();
let currentFFmpegTask = null;
let isCompressionActive = false;

async function queueFFmpegTask(task) {
  return new Promise((resolve, reject) => {
    const abortController = new AbortController();
    currentFFmpegTask = abortController;
    const signal = abortController.signal;
    
    // 设置中断监听器
    signal.addEventListener('abort', () => {
      console.log('[queueFFmpegTask] Task aborted by signal');
      resetFFmpegInstance().catch(e => console.warn('[queueFFmpegTask] Reset error:', e));
    });
    
    ffmpegQueue = ffmpegQueue
      .then(async () => {
        if (shouldCancel || !isCompressionActive || signal.aborted) {
          throw new Error('Compression cancelled by user');
        }
        
        try {
          // 将中断信号传递给任务
          const result = await task(signal);
          if (shouldCancel || !isCompressionActive || signal.aborted) {
            throw new Error('Compression cancelled by user');
          }
          return result;
        } catch (error) {
          if (shouldCancel || !isCompressionActive || signal.aborted) {
            throw new Error('Compression cancelled by user');
          }
          throw error;
        }
      })
      .then(resolve)
      .catch(error => {
        if (shouldCancel || !isCompressionActive || signal.aborted) {
          console.log('[queueFFmpegTask] Task cancelled');
        }
        reject(error);
      })
      .finally(() => {
        currentFFmpegTask = null;
        // 清理可能的错误状态，确保队列继续执行
        if (ffmpegQueue._state === 'rejected') {
          ffmpegQueue = Promise.resolve();
        }
      });
  });
}

// 修改智能锐化函数
function getSharpeningParams(dataSize, format) {
  // 根据图片大小和格式动态调整锐化参数
  if (dataSize > 5 * 1024 * 1024) {
    // 大图片使用更保守的锐化
    return '5:5:0.5:5:5:0.5';  // luma_msize_x:luma_msize_y:luma_amount:chroma_msize_x:chroma_msize_y:chroma_amount
  } else if (dataSize > 2 * 1024 * 1024) {
    // 中等大小图片使用中等锐化
    return '5:5:0.8:5:5:0.8';
  } else {
    // 小图片可以使用更强的锐化
    return '5:5:1.2:5:5:1.2';
  }
}

// 修改智能降噪函数
function getDenoisingParams(dataSize, format) {
  // 根据图片大小和格式动态调整降噪参数
  if (dataSize > 5 * 1024 * 1024) {
    // 大图片使用更强的降噪
    return '4:3:6:4';  // spatial_luma:spatial_chroma:temporal_luma:temporal_chroma
  } else if (dataSize > 2 * 1024 * 1024) {
    // 中等大小图片使用中等降噪
    return '3:2:4:3';
  } else {
    // 小图片使用轻微降噪
    return '2:1:2:1';
  }
}

// 添加内存清理函数
async function cleanupFFmpegMemory(ffmpeg) {
  if (!ffmpeg) return;
  
  try {
    // 检查 FFmpeg 是否已加载
    if (!ffmpeg.isLoaded?.()) {
      return;
    }
    
    // 清理所有临时文件
    const files = ffmpeg.FS('readdir', '/');
    for (const file of files) {
      if (file.startsWith('input_') || file.startsWith('output_')) {
        try {
          ffmpeg.FS('unlink', file);
        } catch (e) {
          // Ignore file deletion errors
        }
      }
    }
    
    // 强制释放内存
    if (typeof global !== 'undefined' && global.gc) {
      try {
        global.gc();
      } catch (e) {
        // Ignore GC errors
      }
    }
    
    // 等待一小段时间确保资源释放
    await new Promise(resolve => setTimeout(resolve, 100));
  } catch (error) {
    // Ignore cleanup errors
  }
}

// 修改取消标志和取消函数
let shouldCancel = false;

// 增强取消函数
export function cancelCompression() {
  console.log('[cancelCompression] Starting to cancel compression process...');
  shouldCancel = true;
  isCompressionActive = false;    // 如果有正在进行的 FFmpeg 任务，尝试终止它
  if (currentFFmpegTask) {
    try {
      console.log('[cancelCompression] Stopping current task');
      currentFFmpegTask.abort();
    } catch (error) {
      console.warn('[cancelCompression] Error aborting current task:', error);
    }
  }
  
  // 立即尝试强制终止所有运行中的 FFmpeg 进程
  try {
    console.log('[cancelCompression] Stopping all FFmpeg processes');
    if (ffmpegInstance && ffmpegInstance.exit) {
      try {
        ffmpegInstance.exit();
      } catch (e) {
        console.warn('[cancelCompression] FFmpeg exit error:', e);
      }
    }
  } catch (e) {
    console.warn('[cancelCompression] Force exit error:', e);
  }
  
  // 重置 FFmpeg 实例
  console.log('[cancelCompression] Resetting FFmpeg instance');
  resetFFmpegInstance().catch(error => {
    console.warn('[cancelCompression] Error resetting FFmpeg instance:', error);
  });
  
  // 重置队列
  ffmpegQueue = Promise.resolve();
  
  // 延迟执行一次垃圾回收
  setTimeout(() => {
    if (typeof global !== 'undefined' && global.gc) {
      try {
        global.gc();
      } catch (e) {
        console.warn('[cancelCompression] GC failed:', e);
      }
    }
    console.log('[cancelCompression] Cancel operation completed');
  }, 1000);
}

// 修改 compressImageWithFFmpeg 函数
async function compressImageWithFFmpeg(data, quality, format) {
  return queueFFmpegTask(async (signal) => {
    let ffmpeg = null;
    try {
      if (shouldCancel || !isCompressionActive || signal.aborted) {
        throw new Error('Compression cancelled by user');
      }
      
      if (!data || data.length === 0) {
        return data;
      }
      
      // 获取 FFmpeg 实例
      ffmpeg = await getFFmpegInstance();
      
      // 检查取消状态
      if (shouldCancel || !isCompressionActive || signal.aborted) {
        throw new Error('Compression cancelled by user');
      }
      
      const inputFileName = `input_${Math.random().toString(36).substring(2, 15)}.${format}`;
      const outputFileName = `output_${Math.random().toString(36).substring(2, 15)}.${format}`;

      // 确保 FFmpeg 实例已加载
      if (!ffmpeg.isLoaded()) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (!ffmpeg.isLoaded()) {
          return await compressWithCanvas(data, format, quality);
        }
      }
      
      // 检查取消状态
      if (shouldCancel || !isCompressionActive || signal.aborted) {
        throw new Error('Compression cancelled by user');
      }

      // 写入文件
      let writeAttempts = 0;
      const maxWriteAttempts = 3;
      
      while (writeAttempts < maxWriteAttempts) {
        if (shouldCancel || !isCompressionActive || signal.aborted) {
          throw new Error('Compression cancelled by user');
        }
        
        try {
          if (!ffmpeg.isLoaded()) {
            return await compressWithCanvas(data, format, quality);
          }
          ffmpeg.FS('writeFile', inputFileName, data);
          break;
        } catch (error) {
          writeAttempts++;
          if (writeAttempts === maxWriteAttempts) {
            return await compressWithCanvas(data, format, quality);
          }
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      // 检查取消状态
      if (shouldCancel || !isCompressionActive || signal.aborted) {
        throw new Error('Compression cancelled by user');
      }
      
      const args = ['-i', inputFileName];
      
      // 优化压缩参数
      if (format === 'jpeg' || format === 'jpg') {
        // 添加降噪和锐化滤镜
        const denoiseParams = getDenoisingParams(data.length, format);
        const sharpenParams = getSharpeningParams(data.length, format);
        
        args.push(
          '-vf', `hqdn3d=${denoiseParams},unsharp=${sharpenParams},scale=iw*0.8:ih*0.8`,  // 添加降噪和锐化
          '-q:v', Math.min(95, Math.round(quality * 90)).toString()
        );
      } else if (format === 'png') {
        // 添加降噪和锐化滤镜
        const denoiseParams = getDenoisingParams(data.length, format);
        const sharpenParams = getSharpeningParams(data.length, format);
        
        args.push(
          '-vf', `hqdn3d=${denoiseParams},unsharp=${sharpenParams},scale=iw*0.8:ih*0.8`,  // 添加降噪和锐化
          '-compression_level', '6',
          '-f', 'image2',
          '-vcodec', 'png'
        );
      } else if (format === 'webp') {
        // 添加降噪和锐化滤镜
        const denoiseParams = getDenoisingParams(data.length, format);
        const sharpenParams = getSharpeningParams(data.length, format);
        
        args.push(
          '-vf', `hqdn3d=${denoiseParams},unsharp=${sharpenParams},scale=iw*0.8:ih*0.8`,  // 添加降噪和锐化
          '-quality', Math.min(95, Math.round(quality * 90)).toString(),
          '-compression_level', '6'
        );
      }
      
      args.push(outputFileName);
      
      try {
        await ffmpeg.run(...args);
      } catch (ffmpegError) {
        if (shouldCancel || !isCompressionActive || signal.aborted) {
          throw new Error('Compression cancelled by user');
        }
        console.warn(`[compressImageWithFFmpeg] FFmpeg compression failed, trying Canvas API:`, ffmpegError);
        return await compressWithCanvas(data, format, quality);
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
      
      if (outputData.length >= data.length * 1.0) {
        return data;
      }
      
      const result = new Uint8Array(outputData.buffer);
      
      // 压缩完成后清理临时文件
      await cleanupFFmpegMemory(ffmpeg);
      
      return result;
    } catch (error) {
      if (shouldCancel || !isCompressionActive || signal.aborted) {
        throw new Error('Compression cancelled by user');
      }
      return await compressWithCanvas(data, format, quality);
    } finally {
      if (ffmpeg) {
        try {
          await cleanupFFmpegMemory(ffmpeg);
        } catch (cleanupError) {
          // Ignore cleanup errors
        }
      }
    }
  });
}

// 使用Canvas API进行压缩的辅助函数
async function compressWithCanvas(data, format, quality) {
  try {
    const blob = new Blob([data], { type: `image/${format}` });
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    
    const compressedBlob = await canvas.convertToBlob({ 
      type: `image/${format}`,
      quality: format === 'png' ? undefined : quality
    });
    
    return new Uint8Array(await compressedBlob.arrayBuffer());
  } catch (error) {
    console.error(`[compressWithCanvas] Canvas compression failed:`, error);
    return data;
  }
}

// 修改为完全串行处理，解决FFmpeg只能运行一个命令的问题
export async function compressImagesInParallel(images, options, onProgress) {
  const results = [];
  const chunkSize = Math.max(1, Math.floor(images.length / navigator.hardwareConcurrency));
  
  // Create an abort controller for child tasks
  const abortController = new AbortController();
  const signal = abortController.signal;
  currentFFmpegTask = abortController;
  
  // Set up abort listener
  signal.addEventListener('abort', () => {
    console.log('[compressImagesInParallel] Received abort signal, stopping all compression tasks');
    resetFFmpegInstance().catch(e => console.warn('[compressImagesInParallel] Reset error:', e));
  });
  
  // Reset state
  shouldCancel = false;
  isCompressionActive = true;
  
  // Ensure options is an object
  const compressionOptions = typeof options === 'object' ? options : { quality: options };
  
  // Reset FFmpeg instance before starting compression
  try {
    await resetFFmpegInstance();
  } catch (resetError) {
    console.warn('[compressImagesInParallel] Initial reset error:', resetError);
  }
  
  try {
    for (let i = 0; i < images.length; i += chunkSize) {
      // Check if should cancel
      if (shouldCancel || !isCompressionActive || signal.aborted) {
        throw new Error('Compression cancelled by user');
      }
      
      const chunk = images.slice(i, i + chunkSize);
      const chunkPromises = chunk.map(async (image, index) => {
        // Check if should cancel
        if (shouldCancel || !isCompressionActive || signal.aborted) {
          throw new Error('Compression cancelled by user');
        }
        
        try {
          // Pass complete compression options
          const compressed = await compressImage(image.data, compressionOptions);
          
          // Check cancellation status again
          if (shouldCancel || !isCompressionActive || signal.aborted) {
            throw new Error('Compression cancelled by user');
          }
          
          if (onProgress) {
            onProgress((i + index + 1) / images.length);
          }
          return compressed;
        } catch (error) {
          if (shouldCancel || !isCompressionActive || signal.aborted) {
            throw new Error('Compression cancelled by user');
          }
          console.error(`Failed to compress image ${image.path}:`, error);
          return image.data;
        }
      });
      
      try {
        const chunkResults = await Promise.all(chunkPromises);
        
        // Check cancellation status
        if (shouldCancel || !isCompressionActive || signal.aborted) {
          throw new Error('Compression cancelled by user');
        }
        
        results.push(...chunkResults);
      } catch (error) {
        if (shouldCancel || !isCompressionActive || signal.aborted) {
          throw new Error('Compression cancelled by user');
        }
        throw error;
      }
      
      // Force garbage collection after each chunk
      if (typeof global !== 'undefined' && global.gc) {
        try {
          global.gc();
        } catch (e) {
          console.warn('[compressImagesInParallel] GC failed:', e);
        }
      }
      
      // Check cancellation status
      if (shouldCancel || !isCompressionActive || signal.aborted) {
        throw new Error('Compression cancelled by user');
      }
    }
  } catch (error) {
    if (shouldCancel || !isCompressionActive || signal.aborted) {
      // Ensure cleanup resources on cancellation
      await resetFFmpegInstance().catch(cleanupError => {
        console.warn('[compressImagesInParallel] Cleanup after cancellation failed:', cleanupError);
      });
    }
    throw error;
  } finally {
    isCompressionActive = false;
    // Clean up FFmpeg instance after compression
    try {
      // Wait a moment to ensure all operations complete
      await new Promise(resolve => setTimeout(resolve, 2000));
      await resetFFmpegInstance();
    } catch (cleanupError) {
      console.warn('[compressImagesInParallel] Final cleanup error:', cleanupError);
    }
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
      // 复杂图片使用更高质量
      adjustedQuality = baseQuality * 1.2;
    } else if (complexityRatio < 0.1) {
      // 简单图片可以适当降低质量
      adjustedQuality = baseQuality * 0.9;
    }
    
    // 确保质量值在合理范围内
    return format === 'webp' ? Math.min(1.0, adjustedQuality) : adjustedQuality;
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

// 添加检查并调整图片尺寸的函数
async function checkAndResizeImage(data, maxWidth = 1600, maxHeight = 900) {
  try {
    const format = await detectFormat(data);
    if (!['png', 'jpeg', 'jpg', 'webp'].includes(format)) return data;
    
    const blob = new Blob([data], { type: `image/${format}` });
    const bitmap = await createImageBitmap(blob);
    
    const { width, height } = bitmap;
    
    // 如果图片尺寸小于限制，直接返回原数据
    if (width <= maxWidth && height <= maxHeight) {
      bitmap.close && bitmap.close();
      return data;
    }
    
    // 计算缩放比例
    const scale = Math.min(maxWidth / width, maxHeight / height);
    const targetWidth = Math.round(width * scale);
    const targetHeight = Math.round(height * scale);
    
    // 使用OffscreenCanvas进行缩放
    const canvas = new OffscreenCanvas(targetWidth, targetHeight);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
    bitmap.close && bitmap.close();
    
    // 导出为Uint8Array
    const blobOut = await canvas.convertToBlob({ type: `image/${format}` });
    const arrayBuffer = await blobOut.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  } catch (error) {
    console.warn('[checkAndResizeImage] Error:', error);
    return data;
  }
}

// 添加内存使用监控
let memoryUsage = {
  peak: 0,
  current: 0,
  lastCheck: Date.now()
};

function updateMemoryUsage() {
  if (typeof performance !== 'undefined' && performance.memory) {
    memoryUsage.current = performance.memory.usedJSHeapSize;
    memoryUsage.peak = Math.max(memoryUsage.peak, memoryUsage.current);
  }
}

// 添加内存压力检测
function checkMemoryPressure() {
  updateMemoryUsage();
  if (typeof performance !== 'undefined' && performance.memory) {
    const memoryLimit = performance.memory.jsHeapSizeLimit * 0.8; // 80% 阈值
    return memoryUsage.current > memoryLimit;
  }
  return false;
}

// 修改compressImage函数
export async function compressImage(data, options = {}) {
  // 检查内存压力
  if (checkMemoryPressure()) {
    console.warn('[compressImage] High memory pressure detected, clearing cache');
    imageCache.clear();
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  const quality = 0.95;
  const allowFormatConversion = true;
  const allowDownsampling = true;
  const maxImageSize = 2000;
  
  if (!(data instanceof Uint8Array)) {
    throw new TypeError('compressImage: data must be a Uint8Array');
  }
  
  let originalSize = data.byteLength;
  
  // 添加大小限制检查
  if (originalSize > 50 * 1024 * 1024) {
    console.warn('[compressImage] Image too large, skipping compression');
    return { 
      data, 
      format: 'original', 
      compressionMethod: 'skipped-size', 
      originalSize, 
      compressedSize: originalSize,
      originalDimensions: { width: 0, height: 0 },
      finalDimensions: { width: 0, height: 0 }
    };
  }
  
  // 首先检查并调整图片尺寸
  data = await checkAndResizeImage(data);
  originalSize = data.byteLength;
  
  // 更保守的降采样策略
  if (allowDownsampling) {
    if (originalSize > 5 * 1024 * 1024) {
      data = await downsampleImage(data, Math.min(maxImageSize, 1600));
      originalSize = data.byteLength;
    } else if (originalSize > 2 * 1024 * 1024) {
      data = await downsampleImage(data, Math.min(maxImageSize, 2000));
      originalSize = data.byteLength;
    }
  }
  
  try {
    const cacheKey = `${originalSize}-${quality}-${hashCode(data)}`;
    let cached = null;
    try {
      cached = imageCache.get(cacheKey);
      if (cached) {
        return cached;
      }
    } catch (e) {
      console.warn('[compressImage] Cache error:', e);
    }
    
    if (originalSize <= COMPRESSION_SETTINGS.MIN_COMPRESSION_SIZE_BYTES) {
      return { data, format: 'original', compressionMethod: 'skipped-small', originalSize, compressedSize: originalSize, originalDimensions: { width: 0, height: 0 }, finalDimensions: { width: 0, height: 0 } };
    }
    
    let format = await detectFormat(data);
    
    // 格式转换策略
    if (allowFormatConversion && ['bmp', 'tiff'].includes(format)) {
      data = await compressImageWithFFmpeg(data, 1, 'png');
      format = 'png';
    }
    
    if (format === 'unknown' || format === 'gif') {
      return { data, format: format || 'original', compressionMethod: 'skipped-format', originalSize, compressedSize: originalSize, originalDimensions: { width: 0, height: 0 }, finalDimensions: { width: 0, height: 0 } };
    }
    
    // PNG无Alpha时考虑转换格式并择优
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
        
        // 优先尝试WebP
        let webpQuality = await adjustQualityByContent(data, 'webp', Math.min(1.0, quality * 1.1));
        let webpData = await compressImageWithFFmpeg(data, webpQuality, 'webp');
        results.push({ data: webpData, format: 'webp' });
        
        // 如果WebP压缩效果不理想，尝试其他格式
        if (webpData.length > originalSize * 1.0) {
          // 尝试PNG压缩
          const pngQuality = await adjustQualityByContent(data, 'png', quality);
          const pngData = await compressImageWithFFmpeg(data, pngQuality, 'png');
          results.push({ data: pngData, format: 'png' });
          
          // 尝试JPEG压缩
          const jpegQuality = await adjustQualityByContent(data, 'jpeg', quality);
          const jpegData = await compressImageWithFFmpeg(data, jpegQuality, 'jpeg');
          results.push({ data: jpegData, format: 'jpeg' });
        }
        
        bestResult = results.reduce((a, b) => (a.data.length < b.data.length ? a : b));
        console.log(`[compressImage] Best format: ${bestResult.format}, orig=${originalSize}, comp=${bestResult.data.length}`);
      }
    }
    
    if (!bestResult) {
      // 使用智能质量调整
      const adjustedQuality = await adjustQualityByContent(data, format, quality);
      let compressedData = await compressImageWithFFmpeg(data, adjustedQuality, format);
      
      // 如果压缩效果不好，尝试额外降低质量
      if (compressedData.length > originalSize * 1.0) {
        const lowerQuality = adjustedQuality * 0.85;
        const recompressedData = await compressImageWithFFmpeg(data, lowerQuality, format);
        
        if (recompressedData.length < compressedData.length) {
          compressedData = recompressedData;
        }
      }
      
      bestResult = { data: compressedData, format };
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
      if (imageCache.currentSize + result.compressedSize > imageCache.maxSize * 0.9) {
        imageCache.evictOldest();
      }
      imageCache.set(cacheKey, result); 
    } catch (e) {
      console.warn('[compressImage] Failed to cache result:', e);
    }
    
    return result;
  } catch (error) {
    console.error('[compressImage] Error:', error);
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
  } finally {
    if (typeof global !== 'undefined' && global.gc) {
      try {
        global.gc();
      } catch (e) {
        console.warn('[compressImage] GC failed:', e);
      }
    }
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