import JSZip from 'jszip';
import { validateFile } from '../utils/validation';
import { compressImage } from '../utils/image';
import { COMPRESSION_SETTINGS, SUPPORTED_IMAGE_EXTENSIONS } from './constants';
import { findMediaFiles, processMediaFile, removeHiddenSlides } from './pptx-utils';
import { removeUnusedLayouts } from './layout-cleaner';
import { cleanUnusedResources } from './cleaner';

// 添加预处理图片的函数
async function preprocessImages(zip, options = {}) {
  try {
    const mediaFiles = findMediaFiles(zip);
    const mediaContents = {};
    const duplicates = new Map();
    
    // 第一步：收集所有媒体文件内容用于比较
    for (const mediaPath of mediaFiles) {
      const file = zip.file(mediaPath);
      if (!file) continue;
      
      const fileExtension = mediaPath.split('.').pop().toLowerCase();
      if (!SUPPORTED_IMAGE_EXTENSIONS.includes(fileExtension)) continue;
      
      const data = await file.async('uint8array');
      // 使用简单的哈希来标识相似图片
      const hash = simpleHash(data);
      mediaContents[mediaPath] = { data, hash, size: data.byteLength };
      
      // 检测重复图片
      if (options.removeDuplicateImages) {
        if (duplicates.has(hash)) {
          duplicates.get(hash).push(mediaPath);
        } else {
          duplicates.set(hash, [mediaPath]);
        }
      }
    }
    
    // 第二步：处理重复图片
    if (options.removeDuplicateImages) {
      for (const [hash, paths] of duplicates.entries()) {
        if (paths.length > 1) {
          // 保留第一个图片，删除其余重复的
          const originalPath = paths[0];
          const duplicatePaths = paths.slice(1);
          
          for (const dupPath of duplicatePaths) {
            // 不直接删除文件，而是将其替换为对原始文件的引用
            // 这需要修改PPT的XML引用，这里简化处理
            console.log(`Found duplicate image: ${dupPath} (same as ${originalPath})`);
          }
        }
      }
    }
    
    return true;
  } catch (error) {
    console.error('Image preprocessing failed:', error);
    return false;
  }
}

// 添加简单的哈希函数用于图片比较
function simpleHash(data) {
  // 简化的哈希算法，仅用于演示
  // 实际应用中应使用更可靠的哈希算法
  let hash = 0;
  const step = Math.max(1, Math.floor(data.length / 1000)); // 采样以提高性能
  for (let i = 0; i < data.length; i += step) {
    hash = ((hash << 5) - hash) + data[i];
    hash |= 0; // 转换为32位整数
  }
  return hash.toString(16);
}

// 在 optimizePPTX 函数中
async function optimizePPTX(file, options = {}) {
  try {
    validateFile(file);
    
    const { onProgress = () => {} } = options;
    const startTime = Date.now();
    
    // 安全检查硬件并发能力 - 只在这里声明一次
    const hasHardwareConcurrency = typeof navigator !== 'undefined' && 
                                  'hardwareConcurrency' in navigator && 
                                  typeof navigator.hardwareConcurrency === 'number';
    
    const cpuCount = hasHardwareConcurrency ? navigator.hardwareConcurrency : 4;
    
    // Send initial file info
    onProgress('fileInfo', {
      name: file.name,
      size: file.size
    });
    
    let zip;
    try {
      zip = await JSZip.loadAsync(file);
    } catch (zipError) {
      // Specific handling for ZIP loading errors
      console.error('ZIP loading error:', zipError);
      const errorMessage = zipError.message.includes('invalid') 
        ? 'Invalid or corrupted file format. Please ensure you upload a valid PowerPoint file.' 
        : `Failed to load file: ${zipError.message}`;
      
      onProgress('error', { 
        message: errorMessage,
        details: zipError.message
      });
      throw new Error(errorMessage);
    }
    
    // 添加清理未使用资源的功能
    if (options.cleanUnusedResources) {
      onProgress('init', { percentage: 25, status: 'Cleaning unused resources...' });
      await cleanUnusedResources(zip, onProgress);
    }
    
    // 添加调试选项
    const debug = options.debug || false;
    
    // 添加预处理步骤
    if (options.preprocessImages) {
      onProgress('init', { percentage: 35, status: 'Preprocessing images...' });
      await preprocessImages(zip, {
        removeDuplicateImages: options.preprocessImages.removeDuplicateImages || false,
        mergeSimilarImages: options.preprocessImages.mergeSimilarImages || false
      });
    }
    
    // 添加删除未使用布局和母版的功能
    if (options.removeUnusedLayouts) {
      onProgress('init', { percentage: 50, status: 'Removing unused layouts and masters...' });
      try {
        if (debug) console.log('Starting layout cleanup...');
        const result = await removeUnusedLayouts(zip, onProgress);
        if (!result) {
          console.warn('Failed to remove unused layouts and masters');
        } else if (debug) {
          console.log('Successfully removed unused layouts and masters');
        }
      } catch (error) {
        console.error('Error during layout cleanup:', error);
      }
    }

    if (options.removeHiddenSlides) {
      onProgress('init', { percentage: 75, status: 'Removing hidden slides...' });
      await removeHiddenSlides(zip);
    }
    
    const mediaFiles = findMediaFiles(zip);
    onProgress('mediaCount', { count: mediaFiles.length });
    
    let totalOriginalSize = 0;
    let totalCompressedSize = 0;
    
    // 在处理媒体文件前添加预处理步骤
    await preprocessImages(zip, {
        removeDuplicateImages: true, // 移除重复图片
        mergeSimilarImages: true    // 合并相似图片
    });
    
    // 将顺序处理改为批处理
    // 动态调整批量大小，基于CPU核心数
    // 删除这里的重复声明，使用上面已经声明的变量
    
    const batchSize = Math.min(
      mediaFiles.length,
      Math.max(4, cpuCount)
    );
    
    // 使用更高效的并行处理方式
    for (let i = 0; i < mediaFiles.length; i += batchSize) {
      const batch = mediaFiles.slice(i, i + batchSize);
      const batchPromises = batch.map(mediaPath => {
        return (async () => {
          try {
            const fileExtension = mediaPath.split('.').pop().toLowerCase();
            const isImage = SUPPORTED_IMAGE_EXTENSIONS.includes(fileExtension);
            
            let result = { originalSize: 0, compressedSize: 0 };
            
            await processMediaFile(zip, mediaPath, async (data) => {
              if (isImage) {
                result.originalSize = data.byteLength;
                
                const adjustedQuality = options.compressImages?.quality || COMPRESSION_SETTINGS.DEFAULT_QUALITY;
                const compressResult = await compressImage(data, adjustedQuality);
                
                result.compressedSize = compressResult.data.byteLength;
                return compressResult.data;
              }
              return data;
            });
            
            return {
              path: mediaPath,
              ...result,
              success: true
            };
          } catch (error) {
            console.error(`处理媒体文件失败: ${mediaPath}`, {
              error: error.message,
              stack: error.stack,
              timestamp: new Date().toISOString()
            });
            return {
              path: mediaPath,
              success: false,
              error: error.message
            };
          }
        })();
      });
      
      const batchResults = await Promise.all(batchPromises);
      
      // 更新进度和统计信息
      const successfulBatches = batchResults.filter(r => r.success);
      successfulBatches.forEach(result => {
        totalOriginalSize += result.originalSize;
        totalCompressedSize += result.compressedSize;
      });
      
      // 计算剩余时间估计
      const elapsed = Date.now() - startTime;
      const processedCount = Math.min(i + batchSize, mediaFiles.length);
      const estimatedTotal = mediaFiles.length > 0 ? (elapsed / processedCount) * mediaFiles.length : 0;
      const estimatedRemaining = Math.max(0, estimatedTotal - elapsed);
      
      onProgress('media', {
        fileIndex: processedCount,
        totalFiles: mediaFiles.length,
        processedFiles: batchResults.map(r => r.path.split('/').pop()),
        estimatedTimeRemaining: Math.round(estimatedRemaining / 1000) // 秒
      });
    }
    
    const savedMediaSize = totalOriginalSize - totalCompressedSize;
    const savedMediaPercentage = totalOriginalSize > 0 ? (savedMediaSize / totalOriginalSize * 100).toFixed(1) : 0;
    
    onProgress('finalize', { 
      status: `Rebuilding presentation...`,
      stats: {
        originalSize: file.size,
        compressedSize: null, // Will be updated after zip generation
        originalMediaSize: totalOriginalSize,
        compressedMediaSize: totalCompressedSize,
        savedMediaSize: savedMediaSize,
        savedMediaPercentage: savedMediaPercentage
      }
    });
    
    const compressedBlob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: {
          level: 9, // 已经是最高级别
          mem: 12,  // 增加内存使用以提高压缩率
          strategy: 2 // 使用RLE策略处理重复数据
      }
    });
    
    // Calculate final statistics
    const finalStats = {
      originalSize: file.size,
      compressedSize: compressedBlob.size,
      savedSize: file.size - compressedBlob.size,
      savedPercentage: ((file.size - compressedBlob.size) / file.size * 100).toFixed(1),
      originalMediaSize: totalOriginalSize,
      compressedMediaSize: totalCompressedSize,
      savedMediaSize: savedMediaSize,
      savedMediaPercentage: savedMediaPercentage,
      processingTime: (Date.now() - startTime) / 1000 // 处理总时间（秒）
    };
    
    // Report completion with final stats
    onProgress('complete', {
      stats: finalStats
    });
    
    return compressedBlob;
    
  } catch (error) {
    console.error('Optimization error:', error);
    
    // 提供更友好的错误信息
    let userFriendlyMessage = '处理文件时发生错误';
    
    if (error.message.includes('file size')) {
      userFriendlyMessage = '文件过大，请尝试分割为多个较小的文件';
    } else if (error.message.includes('memory')) {
      userFriendlyMessage = '浏览器内存不足，请关闭其他标签页后重试';
    } else if (error.message.includes('format')) {
      userFriendlyMessage = '文件格式不支持，请确保上传有效的 PowerPoint 文件';
    }
    
    if (typeof onProgress === 'function') {
      onProgress('error', { 
        message: userFriendlyMessage,
        details: error.message
      });
    }
    
    throw error;
  }
}

export { optimizePPTX };