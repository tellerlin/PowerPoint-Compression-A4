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
      onProgress('init', { percentage: 25, status: '清理未使用的资源...' });
      await cleanUnusedResources(zip, onProgress);
    }
    
    // 添加删除未使用布局和母版的功能
    if (options.removeUnusedLayouts) {
      onProgress('init', { percentage: 50, status: '删除未使用的布局和母版...' });
      await removeUnusedLayouts(zip, onProgress);
    }
    
    if (options.removeHiddenSlides) {
      onProgress('init', { percentage: 75, status: '删除隐藏的幻灯片...' });
      await removeHiddenSlides(zip);
    }
    
    const mediaFiles = findMediaFiles(zip);
    onProgress('mediaCount', { count: mediaFiles.length });
    
    let totalOriginalSize = 0;
    let totalCompressedSize = 0;
    
    // 将顺序处理改为批处理
    const batchSize = 5; // 根据实际情况调整
    for (let i = 0; i < mediaFiles.length; i += batchSize) {
      const batch = mediaFiles.slice(i, i + batchSize);
      const batchResults = await Promise.all(batch.map(async (mediaPath) => {
        try {
          // 检查是否是图像文件
          const fileExtension = mediaPath.split('.').pop().toLowerCase();
          const isImage = SUPPORTED_IMAGE_EXTENSIONS.includes(fileExtension);
          
          let result = { originalSize: 0, compressedSize: 0 };
          
          await processMediaFile(zip, mediaPath, async (data) => {
            // 只压缩图像文件
            if (isImage) {
              result.originalSize = data.byteLength;
              
              // 使用适当的质量设置
              let adjustedQuality = options.compressImages?.quality || COMPRESSION_SETTINGS.DEFAULT_QUALITY;
              
              const compressResult = await compressImage(data, adjustedQuality);
              
              // 更新压缩统计信息
              result.compressedSize = compressResult.data.byteLength;
              return compressResult.data;
            }
            
            // 返回非图像文件的原始数据
            return data;
          });
          
          return {
            path: mediaPath,
            ...result,
            success: true
          };
        } catch (error) {
          console.warn(`处理 ${mediaPath} 失败:`, error);
          return {
            path: mediaPath,
            success: false,
            error: error.message
          };
        }
      }));
      
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
      status: `重建演示文稿...`,
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