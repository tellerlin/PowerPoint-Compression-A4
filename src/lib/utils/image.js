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
let ffmpegLoadAttempts = 0;
const MAX_LOAD_ATTEMPTS = 2;
let consecutiveFailures = 0;
const MAX_CONSECUTIVE_FAILURES = 5;

async function getFFmpegInstance() {
  if (ffmpegInstance && !isFFmpegLoading) {
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      console.log('[getFFmpegInstance] Too many consecutive failures, forcing instance reset');
      await resetFFmpegInstance();
      consecutiveFailures = 0;
    }
    return ffmpegInstance;
  }

  if (isFFmpegLoading && ffmpegLoadPromise) {
    return ffmpegLoadPromise;
  }

  isFFmpegLoading = true;
  ffmpegLoadPromise = (async () => {
    try {
      const createFFmpegFn = window.createFFmpeg || window.FFmpeg?.createFFmpeg;
      if (!createFFmpegFn) {
        throw new Error('FFmpeg creation function not found');
      }

      if (ffmpegInstance) {
        try {
          await cleanupFFmpegMemory(ffmpegInstance);
          await ffmpegInstance.exit();
        } catch (error) {}
        ffmpegInstance = null;
      }

      // Reduced memory limits
      ffmpegInstance = createFFmpegFn({
        log: false,
        corePath: '/ffmpeg/ffmpeg-core.js',
        logger: ({ message }) => {
          if (typeof message === 'string' && message.includes('fatal error')) {
            console.error('[FFmpeg]', message);
          }
        },
        memoryLimit: 128 * 1024 * 1024,  // Reduced to 128MB
        maxMemory: 256 * 1024 * 1024,    // Reduced to 256MB
        threads: 1,
        wasmMemory: {
          initial: 64 * 1024 * 1024,    // Reduced to 64MB
          maximum: 128 * 1024 * 1024    // Reduced to 128MB
        }
      });

      await ffmpegInstance.load();
      ffmpegLoadAttempts = 0;
      consecutiveFailures = 0;
      return ffmpegInstance;
    } catch (error) {
      ffmpegInstance = null;
      isFFmpegLoading = false;
      ffmpegLoadPromise = null;
      ffmpegLoadAttempts++;
      consecutiveFailures++;

      if (ffmpegLoadAttempts < MAX_LOAD_ATTEMPTS) {
        console.warn(`[getFFmpegInstance] Load attempt ${ffmpegLoadAttempts} failed, retrying...`);
        await new Promise(resolve => setTimeout(resolve, 2000 * ffmpegLoadAttempts));
        return getFFmpegInstance();
      }
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
    // 首先尝试清理文件系统
    if (ffmpegInstance.FS) {
      try {
        const files = ffmpegInstance.FS('readdir', '/');
        for (const file of files) {
          if (file !== '.' && file !== '..') {
            try {
              ffmpegInstance.FS('unlink', file);
            } catch (e) {
              // 忽略文件删除错误
            }
          }
        }
      } catch (fsError) {
        // 忽略文件系统错误
      }
    }

    // 检查是否有正在运行的进程
    if (ffmpegInstance.isRunning && ffmpegInstance.isRunning()) {
      try {
        // 尝试正常退出
        await ffmpegInstance.exit();
      } catch (exitError) {
        // 如果正常退出失败，尝试强制终止
        if (ffmpegInstance.terminate) {
          try {
            await ffmpegInstance.terminate();
          } catch (terminateError) {
            // 忽略终止错误
          }
        }
      }
    }

    // 移除所有引用以帮助垃圾回收
    const tmpInstance = ffmpegInstance;
    ffmpegInstance = null;
    isFFmpegLoading = false;
    ffmpegLoadPromise = null;
    
    // 尝试删除所有属性以帮助垃圾回收
    if (tmpInstance) {
      for (const prop in tmpInstance) {
        try {
          tmpInstance[prop] = null;
        } catch (e) {
          // 忽略属性删除错误
        }
      }
    }

    // 等待一段时间确保资源释放
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 尝试垃圾回收
    if (typeof global !== 'undefined' && global.gc) {
      try {
        global.gc();
      } catch (e) {
        // 忽略 GC 错误
      }
    }
  } catch (error) {
    // 即使发生错误也清除实例
    ffmpegInstance = null;
    isFFmpegLoading = false;
    ffmpegLoadPromise = null;
    
    // 只记录非 ExitStatus 错误
    if (error.name !== 'ExitStatus' || error.status !== 1) {
      console.warn('[resetFFmpegInstance] Non-critical error:', error);
    }
  }
}

// 添加FFmpeg队列管理
let ffmpegQueue = Promise.resolve();
let currentFFmpegTask = null;
let isCompressionActive = false;

async function queueFFmpegTask(task) {
  return new Promise((resolve, reject) => {
    const taskId = Math.random().toString(36).substring(2, 15);
    const abortController = new AbortController();
    currentFFmpegTask = abortController;
    const signal = abortController.signal;
    
    // 设置中断监听器
    signal.addEventListener('abort', () => {
      console.log('[queueFFmpegTask] Task aborted by signal');
      memoryManager.removeTask(taskId);
      resetFFmpegInstance().catch(e => console.warn('[queueFFmpegTask] Reset error:', e));
    });
    
    ffmpegQueue = ffmpegQueue
      .then(async () => {
        if (shouldCancel || !isCompressionActive || signal.aborted) {
          throw new Error('Compression cancelled by user');
        }
        
        memoryManager.addTask(taskId);
        try {
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
        } finally {
          memoryManager.removeTask(taskId);
        }
      })
      .then(resolve)
      .catch(error => {
        memoryManager.removeTask(taskId);
        if (shouldCancel || !isCompressionActive || signal.aborted) {
          console.log('[queueFFmpegTask] Task cancelled');
        }
        reject(error);
      })
      .finally(() => {
        currentFFmpegTask = null;
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
    // 首先尝试清理文件系统
    if (ffmpeg.FS) {
      try {
        const files = ffmpeg.FS('readdir', '/');
        for (const file of files) {
          if (file !== '.' && file !== '..') {
            try {
              ffmpeg.FS('unlink', file);
            } catch (e) {
              // 忽略文件删除错误
            }
          }
        }
      } catch (fsError) {
        // 忽略文件系统错误
      }
    }

    // 检查 FFmpeg 是否正在运行
    if (ffmpeg.isRunning && ffmpeg.isRunning()) {
      try {
        // 尝试正常退出
        await ffmpeg.exit();
      } catch (exitError) {
        // 如果正常退出失败，尝试强制终止
        if (ffmpeg.terminate) {
          try {
            await ffmpeg.terminate();
          } catch (terminateError) {
            // 忽略终止错误
          }
        }
      }
    }

    // 等待一段时间确保资源释放
    await new Promise(resolve => setTimeout(resolve, 500));

    // 尝试垃圾回收
    if (typeof global !== 'undefined' && global.gc) {
      try {
        global.gc();
      } catch (gcError) {
        // 忽略 GC 错误
      }
    }
  } catch (error) {
    // 忽略所有清理错误，但记录警告
    if (error.name !== 'ExitStatus' || error.status !== 1) {
      console.warn('[cleanupFFmpegMemory] Non-critical error:', error);
    }
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

// 优化图像尺寸检测函数
async function getImageDimensions(data, format) {
  try {
    // 首先尝试使用 FFmpeg 获取尺寸
    const ffmpeg = await getFFmpegInstance();
    if (ffmpeg && ffmpeg.isLoaded()) {
      const inputFileName = `probe_${Math.random().toString(36).substring(2, 15)}.${format}`;
      const outputFileName = `probe_output_${Math.random().toString(36).substring(2, 15)}.json`;
      
      try {
        ffmpeg.FS('writeFile', inputFileName, data);
        
        // 使用更可靠的命令获取图像信息
        const probeArgs = [
          '-v', 'error',
          '-select_streams', 'v:0',
          '-show_entries', 'stream=width,height',
          '-of', 'json',
          '-i', inputFileName,
          outputFileName
        ];
        
        await ffmpeg.run(...probeArgs);
        
        // 检查输出文件是否存在
        const files = ffmpeg.FS('readdir', '/');
        if (files.includes(outputFileName)) {
          const probeOutput = ffmpeg.FS('readFile', outputFileName);
          const probeData = JSON.parse(new TextDecoder().decode(probeOutput));
          
          // 清理临时文件
          try {
            ffmpeg.FS('unlink', inputFileName);
            ffmpeg.FS('unlink', outputFileName);
          } catch (e) {
            // Ignore cleanup errors
          }
          
          if (probeData.streams && probeData.streams[0]) {
            return {
              width: probeData.streams[0].width,
              height: probeData.streams[0].height
            };
          }
        }
      } catch (error) {
        console.warn('[getImageDimensions] FFmpeg probe failed:', error);
        // 清理临时文件
        try {
          ffmpeg.FS('unlink', inputFileName);
          ffmpeg.FS('unlink', outputFileName);
        } catch (e) {
          // Ignore cleanup errors
        }
      }
    }
    
    // 如果 FFmpeg 失败，使用 Canvas API
    const blob = new Blob([data], { type: `image/${format}` });
    const bitmap = await createImageBitmap(blob);
    const dimensions = {
      width: bitmap.width,
      height: bitmap.height
    };
    bitmap.close && bitmap.close();
    return dimensions;
  } catch (error) {
    console.warn('[getImageDimensions] Failed to get image dimensions:', error);
    return { width: 0, height: 0 };
  }
}

// 修改全局降级标志和计数器
let useFFmpegFallback = false;
let webAssemblyWarningsCount = 0;
let canvasProcessedCount = 0;
const MAX_WEBASSEMBLY_WARNINGS = 3;
const CANVAS_RECOVERY_THRESHOLD = 10; // Reduced from 20 to 10
const MAX_RECOVERY_ATTEMPTS = 3;      // 最大恢复尝试次数
let recoveryAttempts = 0;

// 修改控制台警告监听
if (typeof window !== 'undefined') {
  const originalConsoleWarn = console.warn;
  console.warn = function() {
    const args = Array.from(arguments);
    const message = args.join(' ');
    
    if (message.includes('WebAssembly module validated with warning') || 
        message.includes('failed to allocate executable memory')) {
      webAssemblyWarningsCount++;
      console.log(`[MemoryMonitor] WebAssembly warning detected (${webAssemblyWarningsCount}/5)`); // Increase to 5
      
      if (webAssemblyWarningsCount >= 5) { // Increase from 3 to 5
        console.log('[MemoryMonitor] Too many WebAssembly warnings, switching to Canvas-only mode');
        useFFmpegFallback = true;
        canvasProcessedCount = 0;
        recoveryAttempts = 0;
        
        memoryManager.forceCleanup().catch(e => {
          console.error('[MemoryMonitor] Cleanup error:', e);
        });
      }
    }
    
    originalConsoleWarn.apply(console, args);
  };
}

// 添加恢复检查函数
async function checkAndRecoverFFmpeg() {
  if (!useFFmpegFallback || recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
    return;
  }

  canvasProcessedCount++;
  if (canvasProcessedCount >= CANVAS_RECOVERY_THRESHOLD) {
    console.log('[MemoryMonitor] Attempting to recover FFmpeg mode...');
    try {
      await memoryManager.forceCleanup();
      await new Promise(resolve => setTimeout(resolve, 5000)); // Increased delay to 5 seconds
      await resetFFmpegInstance();
      const testFFmpeg = await getFFmpegInstance();
      if (testFFmpeg && testFFmpeg.isLoaded()) {
        console.log('[MemoryMonitor] Successfully recovered FFmpeg mode');
        useFFmpegFallback = false;
        webAssemblyWarningsCount = 0;
        canvasProcessedCount = 0;
        recoveryAttempts = 0;
      } else {
        throw new Error('FFmpeg instance not properly loaded');
      }
    } catch (error) {
      console.warn('[MemoryMonitor] Failed to recover FFmpeg mode:', error);
      recoveryAttempts++;
      canvasProcessedCount = 0;
      if (recoveryAttempts >= 5) { // Increased from 3 to 5
        console.log('[MemoryMonitor] Max recovery attempts reached, staying in Canvas mode');
      }
    }
  }
}

// 修改图片复杂度分析函数
async function analyzeImageComplexity(data) {
  try {
    const blob = new Blob([data], { type: 'image/jpeg' });
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    
    // 计算图片复杂度（使用简单的边缘检测）
    let complexity = 0;
    const pixels = imageData.data;
    const totalPixels = bitmap.width * bitmap.height;
    
    // 采样计算复杂度，避免处理所有像素
    const sampleStep = Math.max(1, Math.floor(totalPixels / 10000));
    for (let i = 0; i < pixels.length; i += 4 * sampleStep) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      if (Math.abs(r - g) > 30 || Math.abs(g - b) > 30 || Math.abs(r - b) > 30) {
        complexity++;
      }
    }
    
    // 计算复杂度比例
    const complexityRatio = complexity / (totalPixels / sampleStep);
    
    return {
      complexity: complexityRatio,
      size: data.length,
      width: bitmap.width,
      height: bitmap.height
    };
  } catch (error) {
    console.warn('[analyzeImageComplexity] Error:', error);
    // 返回默认值
    return { 
      complexity: 0.5, 
      size: data.length, 
      width: 0, 
      height: 0 
    };
  }
}

// 修改 FFmpeg 压缩函数，添加快速模式
async function compressImageWithFFmpeg(data, quality, format, fastMode = false) {
  if (useFFmpegFallback) {
    console.log('[compressImageWithFFmpeg] Using Canvas fallback due to WebAssembly issues');
    return await compressWithCanvas(data, format, quality);
  }
  
  return queueFFmpegTask(async (signal) => {
    let ffmpeg = null;
    try {
      if (shouldCancel || !isCompressionActive || signal.aborted) {
        throw new Error('Compression cancelled by user');
      }
      
      if (!data || data.length === 0) {
        return data;
      }
      
      ffmpeg = await getFFmpegInstance();
      
      const inputFileName = `input_${Math.random().toString(36).substring(2, 15)}.${format}`;
      const outputFileName = `output_${Math.random().toString(36).substring(2, 15)}.${format}`;
      
      ffmpeg.FS('writeFile', inputFileName, data);
      
      const args = ['-i', inputFileName];
      
      // 根据模式选择不同的压缩参数
      if (fastMode) {
        // 快速模式：使用更激进的压缩参数
        if (format === 'jpeg' || format === 'jpg') {
          args.push(
            '-vf', 'scale=iw*0.9:ih*0.9',  // 从 0.8 提高到 0.9
            '-q:v', '85',  // 从 80 提高到 85
            '-preset', 'ultrafast'
          );
        } else if (format === 'png') {
          args.push(
            '-vf', 'scale=iw*0.9:ih*0.9',  // 从 0.8 提高到 0.9
            '-compression_level', '2',  // 从 1 提高到 2
            '-preset', 'ultrafast'
          );
        } else if (format === 'webp') {
          args.push(
            '-vf', 'scale=iw*0.9:ih*0.9',  // 从 0.8 提高到 0.9
            '-quality', '85',  // 从 80 提高到 85
            '-compression_level', '2',  // 从 1 提高到 2
            '-preset', 'ultrafast'
          );
        }
      } else {
        // 高质量模式：使用更保守的压缩参数
        if (format === 'jpeg' || format === 'jpg') {
          args.push(
            '-q:v', Math.min(95, Math.round(quality * 95)).toString(),  // 从 90 提高到 95
            '-preset', 'medium'
          );
        } else if (format === 'png') {
          args.push(
            '-compression_level', '7',  // 从 6 提高到 7
            '-preset', 'medium'
          );
        } else if (format === 'webp') {
          args.push(
            '-quality', Math.min(95, Math.round(quality * 95)).toString(),  // 从 90 提高到 95
            '-compression_level', '7',  // 从 6 提高到 7
            '-preset', 'medium'
          );
        }
      }
      
      args.push(outputFileName);
      
      await ffmpeg.run(...args);
      
      const outputData = ffmpeg.FS('readFile', outputFileName);
      
      // 清理临时文件
      try {
        ffmpeg.FS('unlink', inputFileName);
        ffmpeg.FS('unlink', outputFileName);
      } catch (e) {
        // Ignore cleanup errors
      }
      
      return new Uint8Array(outputData.buffer);
    } catch (error) {
      console.warn('[compressImageWithFFmpeg] Error:', error);
      throw error;
    }
  });
}

// 修改主压缩函数
export async function compressImage(data, options = {}) {
  if (!(data instanceof Uint8Array)) {
    throw new TypeError('compressImage: data must be a Uint8Array');
  }

  const quality = options.quality || 0.95;
  const format = await detectFormat(data);
  const originalSize = data.byteLength;

  // 调整阈值，增加 FFmpeg 使用范围
  if (originalSize < 200 * 1024) {  // 从 500KB 降低到 200KB
    // 小图片直接使用 Canvas
    console.log('[compressImage] Using Canvas for small image');
    return await compressWithCanvas(data, format, quality);
  }
  
  try {
    // 中等大小图片使用 FFmpeg 快速模式
    if (originalSize < 5 * 1024 * 1024) {  // 从 2MB 提高到 5MB
      console.log('[compressImage] Using FFmpeg fast mode for medium image');
      const compressed = await compressImageWithFFmpeg(data, quality, format, true);
      if (compressed.length < originalSize) {
        return {
          data: compressed,
          format,
          compressionMethod: 'ffmpeg-fast',
          originalSize,
          compressedSize: compressed.length
        };
      }
    }
    
    // 大图片使用高质量模式
    console.log('[compressImage] Using FFmpeg high quality mode');
    const compressed = await compressImageWithFFmpeg(data, quality, format, false);
    
    // 如果压缩后反而更大，尝试使用 Canvas
    if (compressed.length >= originalSize) {
      console.log('[compressImage] FFmpeg compression not effective, falling back to Canvas');
      const canvasResult = await compressWithCanvas(data, format, quality);
      return {
        data: canvasResult,
        format,
        compressionMethod: 'canvas-fallback',
        originalSize,
        compressedSize: canvasResult.length
      };
    }
    
    return {
      data: compressed,
      format,
      compressionMethod: 'ffmpeg-high',
      originalSize,
      compressedSize: compressed.length
    };
  } catch (error) {
    console.warn('[compressImage] Error during compression, using Canvas:', error);
    const canvasResult = await compressWithCanvas(data, format, quality);
    return {
      data: canvasResult,
      format,
      compressionMethod: 'canvas-error',
      originalSize,
      compressedSize: canvasResult.length
    };
  }
}

// 增强 Canvas 压缩方法
async function compressWithCanvas(data, format, quality) {
  try {
    console.log(`[compressWithCanvas] Compressing ${format} image with Canvas API`);
    const blob = new Blob([data], { type: `image/${format}` });
    let bitmap;
    try {
      bitmap = await createImageBitmap(blob);
    } catch (error) {
      console.warn('[compressWithCanvas] Failed to create bitmap:', error);
      return data;
    }

    const targetWidth = Math.round(bitmap.width * 0.8);
    const targetHeight = Math.round(bitmap.height * 0.8);
    const canvas = new OffscreenCanvas(
      bitmap.width > 1200 && bitmap.height > 800 ? targetWidth : bitmap.width,
      bitmap.width > 1200 && bitmap.height > 800 ? targetHeight : bitmap.height
    );

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.warn('[compressWithCanvas] Failed to get 2D context');
      bitmap.close && bitmap.close();
      return data;
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close && bitmap.close();

    let compressionOptions = {};
    let targetFormat = format;
    
    // Check for PNG alpha channel and convert to WebP if no alpha
    if (format === 'png') {
      const hasAlpha = await checkAlphaChannel(data);
      if (!hasAlpha) {
        targetFormat = 'webp';
        compressionOptions = { type: 'image/webp', quality: Math.min(0.8, quality) };
      } else {
        compressionOptions = { type: 'image/png' };
      }
    } else if (format === 'jpeg' || format === 'jpg') {
      compressionOptions = { type: 'image/jpeg', quality: Math.min(0.8, quality) };
    } else if (format === 'webp') {
      compressionOptions = { type: 'image/webp', quality: Math.min(0.8, quality) };
    } else {
      compressionOptions = { type: `image/${format}` };
    }

    let compressedBlob = await canvas.convertToBlob(compressionOptions);
    let compressedData = new Uint8Array(await compressedBlob.arrayBuffer());

    // If output is larger than input, try with lower quality
    if (compressedData.length >= data.length && (targetFormat === 'jpeg' || targetFormat === 'webp')) {
      compressionOptions.quality = Math.max(0.5, compressionOptions.quality * 0.8);
      compressedBlob = await canvas.convertToBlob(compressionOptions);
      compressedData = new Uint8Array(await compressedBlob.arrayBuffer());
    }

    console.log(`[compressWithCanvas] Compression result: ${targetFormat}, ${data.length} -> ${compressedData.length}`);
    return compressedData.length < data.length ? compressedData : data;
  } catch (error) {
    console.error(`[compressWithCanvas] Canvas compression failed:`, error);
    return data;
  }
}

// 添加任务状态跟踪
const taskStatus = {
  pending: new Set(),
  completed: new Set(),
  failed: new Set(),
  timeout: new Set()
};

// 添加任务超时时间常量
const TASK_TIMEOUT = 30000; // 30 seconds
const RETRY_TIMEOUT = 60000; // 60 seconds for retry tasks

// 修改计算最优批处理大小的函数
function calculateOptimalChunkSize(totalImages) {
  const cpuCores = navigator.hardwareConcurrency || 4;
  const memoryUsage = performance.memory ? performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit : 0.5;
  
  // 根据内存使用情况调整批处理大小
  if (memoryUsage > 0.7) {
    return Math.max(1, Math.floor(cpuCores / 4)); // 高内存压力时使用更小的批次
  } else if (memoryUsage > 0.5) {
    return Math.max(2, Math.floor(cpuCores / 2)); // 中等内存压力
  } else {
    return Math.max(3, Math.floor(cpuCores * 0.75)); // 低内存压力时可以使用更大的批次
  }
}

// 修改 compressImagesInParallel 函数
export async function compressImagesInParallel(images, options, onProgress) {
  startMemoryMonitoring();
  const results = new Array(images.length);
  const processedImages = new Set(); // 跟踪已处理的图片
  const failedImages = new Set();
  let shouldRetry = true;
  let retryCount = 0;
  const MAX_RETRIES = 3;
  let uniqueImages = []; // 将 uniqueImages 移到函数作用域顶部

  // 重置状态
  shouldCancel = false;
  isCompressionActive = true;
  webAssemblyWarningsCount = 0;
  useFFmpegFallback = false;
  canvasProcessedCount = 0;
  recoveryAttempts = 0;

  // 重置任务状态
  taskStatus.pending.clear();
  taskStatus.completed.clear();
  taskStatus.failed.clear();
  taskStatus.timeout.clear();

  try {
    // 预处理：降采样大图片并去重
    console.log('[compressImagesInParallel] Starting image preprocessing...');
    const preprocessedImages = await Promise.all(images.map(async (image, index) => {
      try {
        // 检查是否已处理过相同的图片
        const imageHash = await hashCode(image.data);
        if (processedImages.has(imageHash)) {
          console.log(`[compressImagesInParallel] Skipping duplicate image at index ${index}`);
          return null;
        }
        processedImages.add(imageHash);
        
        const resizedData = await checkAndResizeImage(image.data, 1200, 800);
        taskStatus.pending.add(index);
        return { ...image, data: resizedData, hash: imageHash };
      } catch (error) {
        console.warn(`[compressImagesInParallel] Preprocessing failed for image:`, error);
        taskStatus.failed.add(index);
        return null;
      }
    }));

    // 过滤掉重复的图片
    uniqueImages = preprocessedImages.filter(img => img !== null);
    console.log(`[compressImagesInParallel] Preprocessing completed. Unique images: ${uniqueImages.length}`);

    // 确保批处理大小合理
    const chunkSize = Math.min(
      calculateOptimalChunkSize(uniqueImages.length),
      uniqueImages.length
    );
    console.log(`[compressImagesInParallel] Using batch size: ${chunkSize} for ${uniqueImages.length} files`);

    // 创建任务队列
    const taskQueue = [];
    for (let i = 0; i < uniqueImages.length; i += chunkSize) {
      taskQueue.push(uniqueImages.slice(i, i + chunkSize));
    }

    // 处理任务队列
    for (let batchIndex = 0; batchIndex < taskQueue.length; batchIndex++) {
      if (shouldCancel || !isCompressionActive) {
        console.log('[compressImagesInParallel] Compression cancelled, cleaning up...');
        await cleanupCompression(uniqueImages.length);
        throw new Error('Compression cancelled by user');
      }

      const batch = taskQueue[batchIndex];
      console.log(`[compressImagesInParallel] Processing batch ${batchIndex + 1}/${taskQueue.length}`);

      // 并行处理当前批次
      const batchPromises = batch.map(async (image, index) => {
        const globalIndex = batchIndex * chunkSize + index;
        
        if (shouldCancel || !isCompressionActive) {
          throw new Error('Compression cancelled by user');
        }

        try {
          if (checkMemoryPressure()) {
            console.warn('[compressImagesInParallel] High memory pressure detected, waiting...');
            await new Promise(resolve => setTimeout(resolve, 1000));
          }

          // 根据图片大小选择处理方式
          const format = await detectFormat(image.data);
          const originalSize = image.data.byteLength;
          
          let compressed;
          if (originalSize < 200 * 1024) {
            // 小图片直接使用 Canvas
            compressed = await compressWithCanvas(image.data, format, options.quality);
          } else {
            // 尝试 FFmpeg 处理
            try {
              compressed = await Promise.race([
                compressImageWithFFmpeg(image.data, options.quality, format, originalSize < 5 * 1024 * 1024),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Task timeout')), TASK_TIMEOUT))
              ]);
            } catch (error) {
              console.warn(`[compressImagesInParallel] FFmpeg failed for image ${image.path}, falling back to Canvas:`, error);
              compressed = await compressWithCanvas(image.data, format, options.quality);
            }
          }

          const stats = {
            originalSize,
            compressedSize: compressed.length,
            ratio: compressed.length / originalSize,
            method: originalSize < 200 * 1024 ? 'canvas' : 
                   originalSize < 5 * 1024 * 1024 ? 'ffmpeg-fast' : 'ffmpeg-high'
          };

          results[globalIndex] = {
            data: compressed,
            format: await detectFormat(compressed),
            compressionMethod: stats.method,
            originalSize,
            compressedSize: compressed.length,
            stats
          };

          taskStatus.completed.add(globalIndex);
          taskStatus.pending.delete(globalIndex);

          if (onProgress) {
            onProgress({
              current: globalIndex + 1,
              total: uniqueImages.length,
              stats
            });
          }
        } catch (error) {
          console.warn(`[compressImagesInParallel] Failed to compress image ${image.path}:`, error);
          failedImages.add(globalIndex);
          
          const stats = {
            originalSize: image.data.length,
            compressedSize: image.data.length,
            ratio: 1,
            method: 'failed'
          };

          results[globalIndex] = {
            data: image.data,
            error: error.message,
            stats
          };

          taskStatus.failed.add(globalIndex);
          taskStatus.pending.delete(globalIndex);

          if (onProgress) {
            onProgress({
              current: globalIndex + 1,
              total: uniqueImages.length,
              stats
            });
          }
        }
      });

      // 等待当前批次完成
      await Promise.all(batchPromises);

      // 批次间清理
      await memoryManager.checkAndCleanup();
    }

    await cleanupCompression(uniqueImages.length);
    return results;
  } catch (error) {
    console.error('[compressImagesInParallel] Error:', error);
    await cleanupCompression(uniqueImages.length);
    throw error;
  }
}

// 修改清理函数
async function cleanupCompression(totalImages) {
  try {
    isCompressionActive = false;
    await new Promise(resolve => setTimeout(resolve, 1000));
    await resetFFmpegInstance();
    await memoryManager.forceCleanup();
  } catch (cleanupError) {
    console.warn('[compressImagesInParallel] Final cleanup error:', cleanupError);
  } finally {
    stopMemoryMonitoring();
  }

  // 输出任务状态统计
  console.log('[compressImagesInParallel] Task status summary:', {
    total: totalImages,
    completed: taskStatus.completed.size,
    failed: taskStatus.failed.size,
    timeout: taskStatus.timeout.size,
    pending: taskStatus.pending.size
  });
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

// 修改 MemoryManager 类
class MemoryManager {
  constructor() {
    this.lastCleanup = Date.now();
    this.cleanupInterval = 2000; // 2 seconds
    this.memoryThreshold = 0.35; // 35%
    this.forceCleanupThreshold = 0.50; // 50%
    this.processedImagesCount = 0;
    this.cleanupAfterImages = 8; // 每处理8张图片清理一次
    this.activeTasks = new Set(); // 跟踪活动任务
  }
  
  async checkAndCleanup() {
    const now = Date.now();
    this.processedImagesCount++;
    
    // 只在没有活动任务时进行清理
    if (this.activeTasks.size === 0) {
      if (this.processedImagesCount >= this.cleanupAfterImages) {
        await this.forceCleanup();
        this.processedImagesCount = 0;
        return;
      }
      
      if (now - this.lastCleanup < this.cleanupInterval) {
        return;
      }
      
      this.lastCleanup = now;
      
      if (typeof performance !== 'undefined' && performance.memory) {
        const usedHeap = performance.memory.usedJSHeapSize;
        const totalHeap = performance.memory.jsHeapSizeLimit;
        const memoryUsage = usedHeap / totalHeap;
        
        if (memoryUsage > this.forceCleanupThreshold) {
          await this.forceCleanup();
        } else if (memoryUsage > this.memoryThreshold) {
          await this.normalCleanup();
        }
      }
    }
  }
  
  async normalCleanup() {
    console.log('[MemoryManager] Performing normal cleanup');
    try {
      if (imageCache && typeof imageCache.evictOldest === 'function') {
        imageCache.evictOldest();
      }
      
      // 只在没有活动任务时清理 FFmpeg
      if (this.activeTasks.size === 0 && ffmpegInstance) {
        await cleanupFFmpegMemory(ffmpegInstance);
      }
      
      if (typeof global !== 'undefined' && global.gc) {
        try {
          global.gc();
        } catch (e) {
          console.warn('[MemoryManager] GC failed:', e);
        }
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.warn('[MemoryManager] Normal cleanup failed:', error);
    }
  }
  
  async forceCleanup() {
    console.log('[MemoryManager] Performing force cleanup');
    try {
      if (imageCache) {
        if (typeof imageCache.clear === 'function') {
          imageCache.clear();
        } else if (typeof imageCache.evictOldest === 'function') {
          for (let i = 0; i < 20; i++) {
            imageCache.evictOldest();
          }
        }
      }
      
      // 只在没有活动任务时强制清理 FFmpeg
      if (this.activeTasks.size === 0 && ffmpegInstance) {
        await resetFFmpegInstance();
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (typeof global !== 'undefined' && global.gc) {
        try {
          global.gc();
        } catch (e) {
          console.warn('[MemoryManager] Force GC failed:', e);
        }
      }
      this.processedImagesCount = 0;
      this.lastCleanup = Date.now();
    } catch (error) {
      console.warn('[MemoryManager] Force cleanup failed:', error);
    }
  }

  // 添加任务跟踪方法
  addTask(taskId) {
    this.activeTasks.add(taskId);
  }

  removeTask(taskId) {
    this.activeTasks.delete(taskId);
  }
}

// 创建内存管理器实例
const memoryManager = new MemoryManager();

// 新的内存压力检测函数
function checkMemoryPressure() {
  if (typeof performance !== 'undefined' && performance.memory) {
    const usedHeap = performance.memory.usedJSHeapSize;
    const totalHeap = performance.memory.jsHeapSizeLimit;
    const memoryUsage = usedHeap / totalHeap;
    console.log(`[MemoryMonitor] Memory usage: ${(memoryUsage * 100).toFixed(2)}% (${(usedHeap / 1024 / 1024).toFixed(2)}MB / ${(totalHeap / 1024 / 1024).toFixed(2)}MB), FFmpeg active: ${!!ffmpegInstance}`);
    memoryManager.checkAndCleanup();
    return memoryUsage > memoryManager.memoryThreshold;
  }
  return false;
}

// 添加内存监控定时器
let memoryMonitorInterval = null;

function startMemoryMonitoring() {
  if (memoryMonitorInterval) {
    clearInterval(memoryMonitorInterval);
  }
  memoryMonitorInterval = setInterval(() => {
    checkMemoryPressure();
  }, 5000); // 每5秒检查一次
}

function stopMemoryMonitoring() {
  if (memoryMonitorInterval) {
    clearInterval(memoryMonitorInterval);
    memoryMonitorInterval = null;
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