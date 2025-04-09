import JSZip from 'jszip';
import { validateFile } from '../utils/validation';
import { compressImage } from '../utils/image';
import { COMPRESSION_SETTINGS, SUPPORTED_IMAGE_EXTENSIONS } from './constants';
import { findMediaFiles, processMediaFile, removeHiddenSlides } from './pptx-utils';
import { removeUnusedLayouts } from './layout-cleaner';
import { cleanUnusedResources } from './cleaner';

async function optimizePPTX(file, options = {}) {
  try {
    validateFile(file);
    
    const { onProgress = () => {} } = options;
    const startTime = Date.now();
    
    // Send initial file info
    onProgress('fileInfo', {
      name: file.name,
      size: file.size
    });
    
    const zip = await JSZip.loadAsync(file);
    
    // 添加清理未使用资源的功能
    if (options.cleanUnusedResources) {
      onProgress('init', { percentage: 25, status: 'Cleaning unused resources...' });
      await cleanUnusedResources(zip, onProgress);
    }
    
    // 添加调试选项
    const debug = options.debug || false;
    
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
    
    // 将顺序处理改为批处理
    // 动态调整批量大小，基于CPU核心数
    const batchSize = Math.min(mediaFiles.length, Math.max(4, navigator.hardwareConcurrency || 4));
    
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
    
    const savedSize = totalOriginalSize - totalCompressedSize;
    const savedPercentage = totalOriginalSize > 0 ? (savedSize / totalOriginalSize * 100).toFixed(1) : 0;
    
    onProgress('finalize', { 
      status: `Rebuilding presentation...`,
      stats: {
        originalSize: file.size,
        compressedSize: null, // Will be updated after zip generation
        originalMediaSize: totalOriginalSize,
        compressedMediaSize: totalCompressedSize,
        savedMediaSize: savedSize,
        savedMediaPercentage: savedPercentage
      }
    });
    
    const compressedBlob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { 
        level: COMPRESSION_SETTINGS.ZIP_COMPRESSION_LEVEL 
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
      savedMediaSize: savedSize,
      savedMediaPercentage: savedPercentage,
      processingTime: (Date.now() - startTime) / 1000 // 处理总时间（秒）
    };
    
    // Report completion with final stats
    onProgress('complete', { stats: finalStats });
    
    return compressedBlob;
    
  } catch (error) {
    console.error('优化失败:', error);
    throw error;
  }
}

export { optimizePPTX };