import JSZip from 'jszip';
import { compressImage, loadImage } from '../utils/image';
import { findMediaFiles } from './media';
import { cleanUnusedResources } from './cleaner';
import { zipToMemFS, memFSToZip, readFileFromMemFS, writeFileToMemFS } from './zip-fs';
import { COMPRESSION_SETTINGS } from './constants';

export async function optimizePPTX(file, options = {}) {
  let memFS = {};
  let usedMedia = new Set();
  const onProgress = options.onProgress || (() => {});
  const originalSize = file.size;

  try {
    // 调整进度分配比例
    // 初始化: 10%, 资源清理: 20%, 图片压缩: 40%, ZIP生成: 30%
    onProgress('init', { percentage: 0, status: "Loading file..." });
    
    console.log('Loading PPTX file...');
    const zip = await JSZip.loadAsync(file);
    console.log('Converting ZIP to memory file system...');
    memFS = await zipToMemFS(zip);
    console.log(`memFS created with ${Object.keys(memFS).length} entries.`);
    
    onProgress('init', { percentage: 10, status: "Analyzing file structure..." });

    const cleanUnused = options.cleanUnusedResources !== false;
    const removeLayouts = options.removeUnusedLayouts !== false;
    if (cleanUnused) {
      console.log('Starting resource cleaning...');
      const cleanResult = await cleanUnusedResources(memFS, onProgress, {
        removeUnusedLayouts: removeLayouts,
      });

      if (!cleanResult.success) {
        console.warn("Resource cleaning failed. Proceeding with potentially partially cleaned state.");
        memFS = cleanResult.memFS;
      } else {
        console.log("Resource cleaning successful.");
        memFS = cleanResult.memFS;
      }
      usedMedia = cleanResult.usedMedia || new Set();
      console.log(`memFS now has ${Object.keys(memFS).length} entries after cleaning.`);
    } else {
      console.log('Skipping resource cleaning step.');
      onProgress('init', { percentage: 30, status: "Resource cleaning skipped" });
    }

    // 在media阶段结束后，使用平滑过渡到finalize阶段
    if (options.compressImages !== false) {
      console.log('Starting image compression...');
      const mediaFiles = Array.from(usedMedia);
      console.log(`Found ${mediaFiles.length} media files for potential compression.`);
      let compressedCount = 0;
      let skippedCount = 0;
      let failedCount = 0;
      let totalOriginalSize = 0;
      let totalCompressedSize = 0;

      // 通知UI开始图片压缩阶段
      onProgress('mediaCount', { count: mediaFiles.length, status: "Starting image compression..." });

      const concurrency = options.concurrency || 4;
      let currentIndex = 0;

      // 在compressNext函数中添加智能质量调整
      async function compressNext() {
        if (currentIndex >= mediaFiles.length) return;
        const mediaPath = mediaFiles[currentIndex++];
        try {
          const data = readFileFromMemFS(memFS, mediaPath, 'uint8array');
          if (!data) {
            console.warn(`Media file ${mediaPath} not found in memFS during compression, skipping.`);
            skippedCount++;
            return;
          }
          
          // 跳过SVG和其他非图片文件
          if (mediaPath.toLowerCase().endsWith('.svg') || 
              mediaPath.toLowerCase().endsWith('.emf') ||
              mediaPath.toLowerCase().endsWith('.wmf')) {
            console.log(`Skipping vector file ${mediaPath}`);
            skippedCount++;
            return;
          }
          
          // 根据文件扩展名和大小智能调整质量
          const fileExt = mediaPath.split('.').pop().toLowerCase();
          const fileSize = data.byteLength;
          
          // 基础质量设置
          let imageQuality = options.compressImages && typeof options.compressImages.quality === 'number' 
            ? options.compressImages.quality 
            : (options.imageQuality !== undefined ? options.imageQuality : COMPRESSION_SETTINGS.DEFAULT_QUALITY);
          
          // 根据文件类型和大小调整质量
          if (fileExt === 'png' || fileExt === 'gif') {
            // PNG和GIF可能包含图表或图标，保持较高质量
            imageQuality = Math.max(imageQuality, COMPRESSION_SETTINGS.DIAGRAM_QUALITY);
          } else if (fileExt === 'jpg' || fileExt === 'jpeg') {
            // JPEG通常是照片，可以使用较低质量
            imageQuality = Math.min(imageQuality, COMPRESSION_SETTINGS.PHOTO_QUALITY);
            
            // 对于大文件，可以进一步降低质量
            if (fileSize > 1000000) { // 1MB
              imageQuality = Math.min(imageQuality, 0.75);
            }
          }
          
          // 获取最大尺寸设置
          const maxWidth = options.compressImages && options.compressImages.maxWidth || 1920;
          const maxHeight = options.compressImages && options.compressImages.maxHeight || 1080;
          
          totalOriginalSize += data.byteLength;
          
          const compressedResult = await compressImage(data, imageQuality, {
            maxWidth,
            maxHeight,
            forceCompress: options.forceCompress || false,
            // 添加智能处理选项
            smartCompression: true,
            fileType: fileExt
          });
          
          if (compressedResult && compressedResult.data) {
            if (!compressedResult.skipped && (compressedResult.data.byteLength < data.byteLength || options.forceCompress)) {
              writeFileToMemFS(memFS, mediaPath, compressedResult.data);
              compressedCount++;
              totalCompressedSize += compressedResult.data.byteLength;
              console.log(`Compressed ${mediaPath} (saved ${data.byteLength - compressedResult.data.byteLength} bytes, ${Math.round((1 - compressedResult.data.byteLength / data.byteLength) * 100)}%)`);
            } else {
              skippedCount++;
              totalCompressedSize += data.byteLength;
              console.log(`Skipping update for ${mediaPath}, compressed size not smaller.`);
            }
          } else {
            skippedCount++;
            totalCompressedSize += data.byteLength;
            console.warn(`Compression result for ${mediaPath} is invalid, skipping update.`);
          }
        } catch (compressError) {
          // 确保错误正确计数
          failedCount++;
          console.error(`Error compressing media file ${mediaPath}:`, compressError);
        } finally {
          // 计算图片压缩阶段的进度百分比 (30-70%)
          const processedCount = compressedCount + skippedCount + failedCount;
          const mediaPercentage = mediaFiles.length > 0 
            ? Math.round((processedCount / mediaFiles.length) * 40) + 30 
            : 70;
          
          // 更新进度信息，确保包含status字段
          onProgress('media', {
            fileIndex: processedCount,
            totalFiles: mediaFiles.length,
            compressedCount,
            skippedCount,
            failedCount,
            totalOriginalSize,
            totalCompressedSize,
            savedSize: totalOriginalSize - totalCompressedSize,
            savedPercentage: totalOriginalSize > 0 ? ((totalOriginalSize - totalCompressedSize) / totalOriginalSize * 100).toFixed(2) : 0,
            status: `Compressing image ${processedCount} of ${mediaFiles.length}`,
            percentage: mediaPercentage
          });
          
          if (currentIndex < mediaFiles.length) {
            await compressNext();
          }
        }
      }

      const workers = [];
      for (let i = 0; i < concurrency && i < mediaFiles.length; i++) {
        workers.push(compressNext());
      }
      await Promise.all(workers);

      console.log(`Image compression finished. Compressed ${compressedCount} files, skipped ${skippedCount}, failed ${failedCount}.`);
      console.log(`Total size reduction: ${totalOriginalSize} -> ${totalCompressedSize} bytes (${Math.round(totalCompressedSize / totalOriginalSize * 100)}%)`);
      
      // 添加一个小延迟，让用户看到media阶段完成
      await new Promise(resolve => setTimeout(resolve, 300));
    } else {
      console.log('Skipping image compression step.');
      // 如果跳过图片压缩，直接更新进度到70%
      onProgress('media', { 
        status: "Image compression skipped", 
        percentage: 70,
        fileIndex: 0,
        totalFiles: 0,
        compressedCount: 0,
        skippedCount: 0,
        failedCount: 0
      });
    }

    // 开始ZIP生成阶段，添加进度更新
    console.log('Converting memory file system back to ZIP...');
    onProgress('finalize', { percentage: 0, status: "Creating compressed file..." });
    
    const finalZip = await memFSToZip(memFS);
    console.log('ZIP creation complete.');
    onProgress('finalize', { percentage: 50, status: "Finalizing compression..." });
    onProgress('finalize', { percentage: 80, status: "Finalizing compression..." });

    console.log('Generating final PPTX blob...');
    // 添加进度回调到ZIP生成过程
    let lastReportedProgress = 0;
    // 更新ZIP生成选项
    const blob = await finalZip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { 
        level: 9,  // 最高压缩级别
        memory: 9, // 增加内存使用以提高压缩率
        strategy: 3 // 使用Z_HUFFMAN_ONLY策略可能对某些文件更有效
      }
    }, (metadata) => {
      // 只有当进度变化超过1%时才更新，避免过多的日志
      const currentProgress = Math.round(metadata.percent);
      if (currentProgress > lastReportedProgress && currentProgress < 100) {
        lastReportedProgress = currentProgress;
        // ZIP生成进度 (80-99%)
        const zipProgress = Math.min(98, Math.round(metadata.percent * 0.18) + 80);
        onProgress('finalize', { 
          percentage: zipProgress, 
          status: `Finalizing: ${currentProgress}%` 
        });
      }
    });
    
    console.log('PPTX optimization complete.');
    // 最后阶段只发送一次99%的进度更新
    onProgress('finalize', { percentage: 99, status: "Completing compression..." });

    const compressedSize = blob.size;
    const savedSize = originalSize - compressedSize;
    const savedPercentage = originalSize > 0 ? ((savedSize / originalSize) * 100).toFixed(2) : 0;

    onProgress('complete', {
      status: 'Compression complete!',
      percentage: 100,
      stats: {
        originalSize: originalSize,
        compressedSize: compressedSize,
        savedSize: savedSize,
        savedPercentage: parseFloat(savedPercentage)
      }
    });

    return blob;
  } catch (error) {
    console.error('Error during PPTX optimization process:', error);
    onProgress('error', {
      message: error.message || 'An unknown error occurred during optimization.',
      error: error,
      percentage: 99
    });
    throw error;
  }
}