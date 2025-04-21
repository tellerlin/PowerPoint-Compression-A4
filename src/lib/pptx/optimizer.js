import JSZip from 'jszip';
import { validateFile } from '../utils/validation';
import { compressImage } from '../utils/image';
import { COMPRESSION_SETTINGS, SUPPORTED_IMAGE_EXTENSIONS } from './constants';
import { findMediaFiles, processMediaFile } from './pptx-utils';
import { removeHiddenSlides } from './slides';
import { removeUnusedLayouts } from './layout-cleaner';
import { cleanUnusedResources } from './cleaner';

// Function to preprocess images
async function preprocessImages(zip, options = {}) {
  try {
    const mediaFiles = findMediaFiles(zip);
    const mediaContents = {};
    const duplicates = new Map();
    
    // Step 1: Collect all media file contents for comparison
    for (const mediaPath of mediaFiles) {
      const file = zip.file(mediaPath);
      if (!file) continue;
      
      const fileExtension = mediaPath.split('.').pop().toLowerCase();
      if (!SUPPORTED_IMAGE_EXTENSIONS.includes(fileExtension)) continue;
      
      const data = await file.async('uint8array');
      // Use a simple hash to identify similar images
      const hash = simpleHash(data);
      mediaContents[mediaPath] = { data, hash, size: data.byteLength };
      
      // Detect duplicate images
      if (options.removeDuplicateImages) {
        if (duplicates.has(hash)) {
          duplicates.get(hash).push(mediaPath);
        } else {
          duplicates.set(hash, [mediaPath]);
        }
      }
    }
    
    // Step 2: Process duplicate images
    if (options.removeDuplicateImages) {
      for (const [hash, paths] of duplicates.entries()) {
        if (paths.length > 1) {
          // Keep the first image, remove the rest
          const originalPath = paths[0];
          const duplicatePaths = paths.slice(1);
          
          for (const dupPath of duplicatePaths) {
            // Don't directly delete files, but replace them with references to the original file
            // This requires modifying PPT XML references, simplified handling here
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

// Add a simple hash function for image comparison
function simpleHash(data) {
  // Simplified hash algorithm, for demonstration only
  // In production, use a more reliable hash algorithm
  let hash = 0;
  const step = Math.max(1, Math.floor(data.length / 1000)); // Sample to improve performance
  for (let i = 0; i < data.length; i += step) {
    hash = ((hash << 5) - hash) + data[i];
    hash |= 0; // Convert to 32-bit integer
  }
  return hash.toString(16);
}

// In the optimizePPTX function
async function optimizePPTX(file, options = {}) {
  try {
    validateFile(file);
    
    const { onProgress = () => {} } = options;
    const startTime = Date.now();
    
    // Safely check hardware concurrency - declare only once
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
    
    // 添加调试选项
    const debug = options.debug || false;
    if (debug) {
      zip.debug = true;
      console.log('Debug mode enabled');
    }
    
    // 第一步：删除隐藏幻灯片
    if (options.removeHiddenSlides) {
      onProgress('init', { percentage: 10, status: '删除隐藏幻灯片...' });
      console.log('Starting to call removeHiddenSlides function...');
      try {
        await removeHiddenSlides(zip);
        console.log('removeHiddenSlides function call completed');
      } catch (error) {
        console.error('Error calling removeHiddenSlides function:', error);
      }
    }
    
    // 第二步：清理未使用资源
    if (options.cleanUnusedResources) {
      onProgress('init', { percentage: 25, status: '清理未使用资源...' });
      await cleanUnusedResources(zip, onProgress, {
        removeUnusedLayouts: true,  // 删除未使用的布局
        cleanMediaInUnusedLayouts: true  // 清理未使用布局中的媒体文件
      });
    }
    
    
    // 第三步：预处理图片
    if (options.preprocessImages) {
      onProgress('init', { percentage: 35, status: '预处理图片...' });
      await preprocessImages(zip, {
        removeDuplicateImages: options.preprocessImages.removeDuplicateImages || false,
        mergeSimilarImages: options.preprocessImages.mergeSimilarImages || false
      });
    }
    
    // 第四步：删除未使用布局和母版
    if (options.removeUnusedLayouts) {
      onProgress('init', { percentage: 50, status: '删除未使用布局和母版...' });
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

    // 第五步：压缩媒体文件
    const mediaFiles = findMediaFiles(zip);
    onProgress('mediaCount', { count: mediaFiles.length });
    
    let totalOriginalSize = 0;
    let totalCompressedSize = 0;
    
    // 移除重复的预处理步骤，避免重复执行
    if (!options.preprocessImages) {
      // 只有在之前没有执行过预处理的情况下才执行
      await preprocessImages(zip, {
          removeDuplicateImages: true, // Remove duplicate images
          mergeSimilarImages: true    // Merge similar images
      });
    }
    
    // Change sequential processing to batch processing
    // Dynamically adjust batch size based on CPU core count
    // Remove duplicate declaration here, use the variable declared above
    
    const batchSize = Math.min(
      mediaFiles.length,
      Math.max(4, cpuCount)
    );
    
    // Use more efficient parallel processing
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
            console.error(`Failed to process media file: ${mediaPath}`, {
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
      
      // Update progress and statistics
      const successfulBatches = batchResults.filter(r => r.success);
      successfulBatches.forEach(result => {
        totalOriginalSize += result.originalSize;
        totalCompressedSize += result.compressedSize;
      });
      
      // Calculate estimated time remaining
      const elapsed = Date.now() - startTime;
      const processedCount = Math.min(i + batchSize, mediaFiles.length);
      const estimatedTotal = mediaFiles.length > 0 ? (elapsed / processedCount) * mediaFiles.length : 0;
      const estimatedRemaining = Math.max(0, estimatedTotal - elapsed);
      
      onProgress('media', {
        fileIndex: processedCount,
        totalFiles: mediaFiles.length,
        processedFiles: batchResults.map(r => r.path.split('/').pop()),
        estimatedTimeRemaining: Math.round(estimatedRemaining / 1000) // seconds
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
          level: 9, // Already at maximum level
          mem: 12,  // Increase memory usage to improve compression ratio
          strategy: 2 // Use RLE strategy to handle repeated data
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
      processingTime: (Date.now() - startTime) / 1000 // Total processing time (seconds)
    };
    
    // Report completion with final stats
    onProgress('complete', {
      stats: finalStats
    });
    
    return compressedBlob;
    
  } catch (error) {
    console.error('Optimization error:', error);
    
    // Provide more user-friendly error messages
    let userFriendlyMessage = 'An error occurred while processing the file';
    
    if (error.message.includes('file size')) {
      userFriendlyMessage = 'File is too large, please try splitting it into multiple smaller files';
    } else if (error.message.includes('memory')) {
      userFriendlyMessage = 'Browser memory insufficient, please close other tabs and try again';
    } else if (error.message.includes('format')) {
      userFriendlyMessage = 'File format not supported, please ensure you upload a valid PowerPoint file';
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