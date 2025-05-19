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
const MAX_LOAD_ATTEMPTS = 3;
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

      // 增加内存限制
      ffmpegInstance = createFFmpegFn({
        log: false,
        corePath: '/ffmpeg/ffmpeg-core.js',
        logger: ({ message }) => {
          if (typeof message === 'string' && message.includes('fatal error')) {
            console.error('[FFmpeg]', message);
          }
        },
        memoryLimit: 256 * 1024 * 1024,  // Increase to 256MB
        maxMemory: 512 * 1024 * 1024,    // Increase to 512MB
        threads: 1,
        wasmMemory: {
          initial: 128 * 1024 * 1024,    // Increase to 128MB
          maximum: 256 * 1024 * 1024     // Increase to 256MB
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
    // 立即尝试处理任何正在运行的进程
    if (ffmpegInstance.isRunning && ffmpegInstance.isRunning()) {
      try {
        // 尝试强制终止
        if (ffmpegInstance.terminate) {
          await ffmpegInstance.terminate();
        } else if (ffmpegInstance.exit) {
          await ffmpegInstance.exit();
        }
      } catch (e) {
        // Ignore normal exit status
      }
    }

    // 清理内存
    try {
      await cleanupFFmpegMemory(ffmpegInstance);
    } catch (cleanupError) {
      // Ignore cleanup errors
    }

    // 尝试清理文件系统
    try {
      if (ffmpegInstance.FS) {
        const files = ffmpegInstance.FS('readdir', '/');
        for (const file of files) {
          if (file.startsWith('input_') || file.startsWith('output_') || 
              file.startsWith('probe_') || file.endsWith('.json')) {
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

    // 强制终止策略
    let exitAttempted = false;
    
    // 尝试正常退出
    try {
      await ffmpegInstance.exit();
      exitAttempted = true;
    } catch (exitError) {
      // 尝试强制终止
      if (ffmpegInstance.terminate) {
        try {
          await ffmpegInstance.terminate();
          exitAttempted = true;
        } catch (terminateError) {
          // Ignore termination errors
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
          // Ignore
        }
      }
    }

    // 强制垃圾回收
    try {
      if (typeof global !== 'undefined' && global.gc) {
        global.gc();
      }
    } catch (e) {
      // Ignore GC errors
    }

    // 等待一段时间确保资源释放
    await new Promise(resolve => setTimeout(resolve, 1000));
  } catch (error) {
    // 即使发生错误也清除实例
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
const CANVAS_RECOVERY_THRESHOLD = 20; // 每处理20张图片尝试恢复FFmpeg
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
  if (canvasProcessedCount >= 5) { // Reduce from 10 to 5
    console.log('[MemoryMonitor] Attempting to recover FFmpeg mode...');
    try {
      await memoryManager.forceCleanup();
      await new Promise(resolve => setTimeout(resolve, 3000));
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
      if (recoveryAttempts >= 5) { // Increase from 3 to 5
        console.log('[MemoryMonitor] Max recovery attempts reached, staying in Canvas mode');
      }
    }
  }
}

// 修改 compressImageWithFFmpeg 函数
async function compressImageWithFFmpeg(data, quality, format) {
  // 如果已进入降级模式，使用Canvas API并检查恢复
  if (useFFmpegFallback) {
    console.log('[compressImageWithFFmpeg] Using Canvas fallback due to WebAssembly issues');
    const result = await compressWithCanvas(data, format, quality);
    await checkAndRecoverFFmpeg();
    return result;
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
      
      // 检查是否已进入降级模式
      if (useFFmpegFallback) {
        return await compressWithCanvas(data, format, quality);
      }
      
      // 获取 FFmpeg 实例
      try {
        ffmpeg = await getFFmpegInstance();
      } catch (error) {
        console.warn('[compressImageWithFFmpeg] FFmpeg initialization failed, falling back to Canvas:', error);
        useFFmpegFallback = true;
        return await compressWithCanvas(data, format, quality);
      }
      
      // 检查取消状态
      if (shouldCancel || !isCompressionActive || signal.aborted) {
        throw new Error('Compression cancelled by user');
      }
      
      const inputFileName = `input_${Math.random().toString(36).substring(2, 15)}.${format}`;
      const outputFileName = `output_${Math.random().toString(36).substring(2, 15)}.${format}`;

      // 确保 FFmpeg 实例已加载
      if (!ffmpeg || !ffmpeg.isLoaded()) {
        console.warn('[compressImageWithFFmpeg] FFmpeg not loaded, using Canvas');
        return await compressWithCanvas(data, format, quality);
      }
      
      // 检查取消状态
      if (shouldCancel || !isCompressionActive || signal.aborted) {
        throw new Error('Compression cancelled by user');
      }

      // 写入文件
      let writeAttempts = 0;
      const maxWriteAttempts = 2; // 减少尝试次数
      
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
            console.warn('[compressImageWithFFmpeg] File write failed, using Canvas:', error);
            return await compressWithCanvas(data, format, quality);
          }
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      
      // 检查取消状态
      if (shouldCancel || !isCompressionActive || signal.aborted) {
        throw new Error('Compression cancelled by user');
      }
      
      const args = ['-i', inputFileName];
      
      // 获取图像尺寸
      let dimensions;
      try {
        dimensions = await getImageDimensions(data, format);
      } catch (error) {
        console.warn('[compressImageWithFFmpeg] Failed to get dimensions, using Canvas:', error);
        return await compressWithCanvas(data, format, quality);
      }
      
      const imageWidth = dimensions.width;
      const imageHeight = dimensions.height;
      
      // 优化压缩参数
      if (format === 'jpeg' || format === 'jpg') {
        if (imageWidth > 1366 && imageHeight > 768) {
          // 大图片使用降噪和锐化
          const denoiseParams = getDenoisingParams(data.length, format);
          const sharpenParams = getSharpeningParams(data.length, format);
          args.push(
            '-vf', `hqdn3d=${denoiseParams},unsharp=${sharpenParams},scale=iw*0.8:ih*0.8`,
            '-q:v', Math.min(95, Math.round(quality * 90)).toString()
          );
        } else {
          // 小图片只进行基本压缩
          args.push(
            '-q:v', Math.min(95, Math.round(quality * 90)).toString()
          );
        }
      } else if (format === 'png') {
        if (imageWidth > 1366 && imageHeight > 768) {
          // 大图片使用降噪和锐化
          const denoiseParams = getDenoisingParams(data.length, format);
          const sharpenParams = getSharpeningParams(data.length, format);
          args.push(
            '-vf', `hqdn3d=${denoiseParams},unsharp=${sharpenParams},scale=iw*0.8:ih*0.8`,
            '-compression_level', '6',
            '-f', 'image2',
            '-vcodec', 'png'
          );
        } else {
          // 小图片只进行基本压缩
          args.push(
            '-compression_level', '6',
            '-f', 'image2',
            '-vcodec', 'png'
          );
        }
      } else if (format === 'webp') {
        if (imageWidth > 1366 && imageHeight > 768) {
          // 大图片使用降噪和锐化
          const denoiseParams = getDenoisingParams(data.length, format);
          const sharpenParams = getSharpeningParams(data.length, format);
          args.push(
            '-vf', `hqdn3d=${denoiseParams},unsharp=${sharpenParams},scale=iw*0.8:ih*0.8`,
            '-quality', Math.min(95, Math.round(quality * 90)).toString(),
            '-compression_level', '6'
          );
        } else {
          // 小图片只进行基本压缩
          args.push(
            '-quality', Math.min(95, Math.round(quality * 90)).toString(),
            '-compression_level', '6'
          );
        }
      }
      
      args.push(outputFileName);
      
      try {
        await ffmpeg.run(...args);
      } catch (ffmpegError) {
        if (shouldCancel || !isCompressionActive || signal.aborted) {
          throw new Error('Compression cancelled by user');
        }
        console.warn(`[compressImageWithFFmpeg] FFmpeg compression failed, using Canvas API:`, ffmpegError);
        // 标记为降级模式
        useFFmpegFallback = true;
        canvasProcessedCount = 0;
        return await compressWithCanvas(data, format, quality);
      }
      
      const files = ffmpeg.FS('readdir', '/');
      if (!files.includes(outputFileName)) {
        console.warn(`[compressImageWithFFmpeg] Output file not found: ${outputFileName}`);
        return await compressWithCanvas(data, format, quality);
      }
      
      let outputData;
      try {
        outputData = ffmpeg.FS('readFile', outputFileName);
      } catch (error) {
        console.warn(`[compressImageWithFFmpeg] Failed to read output file: ${error.message}`);
        return await compressWithCanvas(data, format, quality);
      }
      
      if (!outputData || outputData.length === 0) {
        console.warn(`[compressImageWithFFmpeg] Empty output file: ${outputFileName}`);
        return await compressWithCanvas(data, format, quality);
      }

      console.log(`[compressImageWithFFmpeg] Compression result: ${format}, ${data.length} -> ${outputData.length}`);
      
      if (outputData.length >= data.length * 1.0) {
        return data;
      }
      
      const result = new Uint8Array(outputData.buffer);
      
      // 压缩完成后清理临时文件
      try {
        await cleanupFFmpegMemory(ffmpeg);
      } catch (error) {
        // 忽略清理错误
      }
      
      return result;
    } catch (error) {
      if (shouldCancel || !isCompressionActive || signal.aborted) {
        throw new Error('Compression cancelled by user');
      }
      console.warn('[compressImageWithFFmpeg] Error:', error);
      useFFmpegFallback = true;
      canvasProcessedCount = 0;
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
      bitmap.width > 1366 && bitmap.height > 768 ? targetWidth : bitmap.width,
      bitmap.width > 1366 && bitmap.height > 768 ? targetHeight : bitmap.height
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
    if (format === 'jpeg' || format === 'jpg') {
      compressionOptions = { type: 'image/jpeg', quality: Math.min(0.85, quality) }; // 降低初始质量
    } else if (format === 'webp') {
      compressionOptions = { type: 'image/webp', quality: Math.min(0.85, quality) };
    } else if (format === 'png') {
      compressionOptions = { type: 'image/png' };
    }

    let compressedBlob = await canvas.convertToBlob(compressionOptions);
    let compressedData = new Uint8Array(await compressedBlob.arrayBuffer());

    // 如果输出大于输入，使用更低的质量重试
    if (compressedData.length >= data.length && (format === 'jpeg' || format === 'webp')) {
      compressionOptions.quality = Math.max(0.5, compressionOptions.quality * 0.8);
      compressedBlob = await canvas.convertToBlob(compressionOptions);
      compressedData = new Uint8Array(await compressedBlob.arrayBuffer());
    }

    console.log(`[compressWithCanvas] Compression result: ${format}, ${data.length} -> ${compressedData.length}`);
    return compressedData.length < data.length ? compressedData : data;
  } catch (error) {
    console.error(`[compressWithCanvas] Canvas compression failed:`, error);
    return data;
  }
}

// 修改为完全串行处理，解决FFmpeg只能运行一个命令的问题
export async function compressImagesInParallel(images, options, onProgress) {
  startMemoryMonitoring();
  const results = new Array(images.length);
  const failedImages = new Set();
  
  // 增加批处理大小，因为我们现在有降级策略
  const chunkSize = Math.max(3, Math.min(5, calculateOptimalChunkSize(images.length)));
  
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
  webAssemblyWarningsCount = 0;
  useFFmpegFallback = false;
  canvasProcessedCount = 0;
  recoveryAttempts = 0;
  
  // Ensure options is an object
  const compressionOptions = typeof options === 'object' ? options : { quality: options };
  
  // Reset FFmpeg instance before starting compression
  try {
    await resetFFmpegInstance();
  } catch (resetError) {
    console.warn('[compressImagesInParallel] Initial reset error:', resetError);
  }
  
  try {
    // 将图片分成多个批次并行处理
    const totalBatches = Math.ceil(images.length / chunkSize);
    console.log(`[compressImagesInParallel] Processing ${images.length} images in ${totalBatches} batches of ${chunkSize}`);
    
    for (let i = 0; i < images.length; i += chunkSize) {
      if (shouldCancel || !isCompressionActive || signal.aborted) {
        throw new Error('Compression cancelled by user');
      }
      
      const chunk = images.slice(i, i + chunkSize);
      const batchNumber = Math.floor(i / chunkSize) + 1;
      console.log(`[compressImagesInParallel] Processing batch ${batchNumber}/${totalBatches}`);
      
      // 并行处理当前批次
      const batchPromises = chunk.map(async (image, index) => {
        const globalIndex = i + index;
        
        if (shouldCancel || !isCompressionActive || signal.aborted) {
          throw new Error('Compression cancelled by user');
        }
        
        try {
          // 检查内存压力
          if (checkMemoryPressure()) {
            console.warn('[compressImagesInParallel] High memory pressure detected, waiting...');
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
          
          // 尝试使用 FFmpeg 压缩
          const compressed = await compressImage(image.data, compressionOptions);
          
          if (shouldCancel || !isCompressionActive || signal.aborted) {
            throw new Error('Compression cancelled by user');
          }
          
          results[globalIndex] = compressed;
          
          if (onProgress) {
            onProgress((globalIndex + 1) / images.length);
          }
        } catch (error) {
          console.warn(`[compressImagesInParallel] Failed to compress image ${image.path}:`, error);
          failedImages.add(globalIndex);
          results[globalIndex] = { data: image.data, error: error.message };
        }
      });
      
      // 等待当前批次完成
      await Promise.all(batchPromises);
      
      // 每处理完一个批次后，检查是否需要清理
      await memoryManager.checkAndCleanup();
      
      // 如果已经处理了20张图片，尝试恢复 FFmpeg
      if (canvasProcessedCount >= CANVAS_RECOVERY_THRESHOLD) {
        await checkAndRecoverFFmpeg();
      }
    }
    
    // 处理失败的图片
    if (failedImages.size > 0) {
      console.log(`[compressImagesInParallel] Retrying ${failedImages.size} failed images with Canvas`);
      
      // 切换到 Canvas 模式
      useFFmpegFallback = true;
      
      // 串行处理失败的图片
      for (const index of failedImages) {
        if (shouldCancel || !isCompressionActive || signal.aborted) {
          throw new Error('Compression cancelled by user');
        }
        
        try {
          const image = images[index];
          const compressed = await compressWithCanvas(image.data, await detectFormat(image.data), compressionOptions.quality);
          
          if (shouldCancel || !isCompressionActive || signal.aborted) {
            throw new Error('Compression cancelled by user');
          }
          
          results[index] = {
            data: compressed,
            format: await detectFormat(compressed),
            compressionMethod: 'canvas-fallback',
            originalSize: image.data.length,
            compressedSize: compressed.length
          };
          
          if (onProgress) {
            onProgress((index + 1) / images.length);
          }
        } catch (error) {
          console.error(`[compressImagesInParallel] Failed to compress image ${images[index].path} with Canvas:`, error);
          results[index] = { 
            data: images[index].data, 
            error: error.message,
            compressionMethod: 'failed'
          };
        }
      }
    }
  } catch (error) {
    if (shouldCancel || !isCompressionActive || signal.aborted) {
      await resetFFmpegInstance().catch(cleanupError => {
        console.warn('[compressImagesInParallel] Cleanup after cancellation failed:', cleanupError);
      });
    }
    throw error;
  } finally {
    isCompressionActive = false;
    try {
      await new Promise(resolve => setTimeout(resolve, 2000));
      await resetFFmpegInstance();
      await memoryManager.forceCleanup();
    } catch (cleanupError) {
      console.warn('[compressImagesInParallel] Final cleanup error:', cleanupError);
    }
    stopMemoryMonitoring();
  }
  
  return results;
}

// 添加计算最优批处理大小的函数
function calculateOptimalChunkSize(totalImages) {
  const cpuCores = navigator.hardwareConcurrency || 4;
  if (totalImages <= 10) {
    return 1; // Serial processing for small sets
  } else if (totalImages <= 50) {
    return 1; // Single image per batch for medium sets
  } else {
    return 2; // Two images per batch for large sets
  }
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
    this.cleanupInterval = 3000; // Reduce to 3 seconds
    this.memoryThreshold = 0.4;  // Lower to 40%
    this.forceCleanupThreshold = 0.55; // Lower to 55%
    this.processedImagesCount = 0;
    this.cleanupAfterImages = 10; // Reduce to 10 images
    this.lastFFmpegReset = Date.now();
    this.ffmpegResetInterval = 15000; // Reduce to 15 seconds
  }
  
  async checkAndCleanup() {
    const now = Date.now();
    this.processedImagesCount++;
    
    if (this.processedImagesCount >= this.cleanupAfterImages) {
      await this.forceCleanup();
      this.processedImagesCount = 0;
      if (useFFmpegFallback) {
        await checkAndRecoverFFmpeg();
      }
      return;
    }
    
    if (now - this.lastCleanup < this.cleanupInterval) {
      return;
    }
    
    this.lastCleanup = now;
    
    if (now - this.lastFFmpegReset >= this.ffmpegResetInterval) {
      console.log('[MemoryManager] Performing periodic FFmpeg reset');
      await resetFFmpegInstance();
      this.lastFFmpegReset = now;
    }
    
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
  
  async normalCleanup() {
    console.log('[MemoryManager] Performing normal cleanup');
    try {
      if (imageCache && typeof imageCache.evictOldest === 'function') {
        imageCache.evictOldest();
      }
      await resetFFmpegInstance();
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
      await resetFFmpegInstance();
      await new Promise(resolve => setTimeout(resolve, 3000));
      if (typeof global !== 'undefined' && global.gc) {
        try {
          global.gc();
        } catch (e) {
          console.warn('[MemoryManager] Force GC failed:', e);
        }
      }
      this.processedImagesCount = 0;
      this.lastCleanup = Date.now();
      this.lastFFmpegReset = Date.now();
    } catch (error) {
      console.warn('[MemoryManager] Force cleanup failed:', error);
    }
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

// 修改compressImage函数
export async function compressImage(data, options = {}) {
  if (checkMemoryPressure()) {
    console.warn('[compressImage] High memory pressure detected, clearing cache');
    if (imageCache) {
      if (typeof imageCache.clear === 'function') {
        imageCache.clear();
      } else if (typeof imageCache.evictOldest === 'function') {
        for (let i = 0; i < 10; i++) {
          imageCache.evictOldest();
        }
      }
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  const quality = 0.95;
  const allowFormatConversion = true;
  const allowDownsampling = true;
  const maxImageSize = 1600; // Lower max size
  
  if (!(data instanceof Uint8Array)) {
    throw new TypeError('compressImage: data must be a Uint8Array');
  }
  
  let originalSize = data.byteLength;
  
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
  
  data = await checkAndResizeImage(data, 1400, 800); // Lower max dimensions
  originalSize = data.byteLength;
  
  if (allowDownsampling) {
    if (originalSize > 2 * 1024 * 1024) {
      data = await downsampleImage(data, 1200); // Lower threshold and size
      originalSize = data.byteLength;
    } else if (originalSize > 1 * 1024 * 1024) {
      data = await downsampleImage(data, 1400);
      originalSize = data.byteLength;
    }
  }
  
  try {
    const cacheKey = `${originalSize}-${quality}-${hashCode(data)}`;
    let cached = null;
    try {
      if (imageCache && typeof imageCache.get === 'function') {
        cached = imageCache.get(cacheKey);
        if (cached) {
          return cached;
        }
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
      if (imageCache && typeof imageCache.set === 'function') {
        if (imageCache.currentSize + result.compressedSize > imageCache.maxSize * 0.9) {
          if (typeof imageCache.evictOldest === 'function') {
            imageCache.evictOldest();
          }
        }
        imageCache.set(cacheKey, result); 
      }
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