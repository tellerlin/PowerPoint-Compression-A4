import * as JSZip from 'jszip';
import { validateFile } from '../utils/validation';
import { compressImagesInParallel } from '../utils/image';
import { 
  COMPRESSION_SETTINGS, 
  SUPPORTED_IMAGE_EXTENSIONS
} from './constants';
import { calculateEstimatedTime, calculateSavedStats } from '../utils/progressUtils';
import { updateProgress } from './progress';

// Modified processMediaBatch function to use parallel compression
async function processMediaBatch(zip, batch, options, cpuCount, onProgress, currentIndex, totalFiles) {
  const imagesToCompress = [];
  const otherFiles = [];

  // Separate images and other files
  for (const mediaPath of batch) {
    const fileExtension = mediaPath.split('.').pop()?.toLowerCase() || '';
    const isSupportedImage = SUPPORTED_IMAGE_EXTENSIONS.includes(fileExtension);
    
    if (isSupportedImage) {
      try {
        const file = zip.file(mediaPath);
        if (file) {
          const data = await file.async('uint8array');
          if (data && data.byteLength > COMPRESSION_SETTINGS.MIN_COMPRESSION_SIZE_BYTES) {
            imagesToCompress.push({ path: mediaPath, data });
          } else {
            otherFiles.push({ path: mediaPath, data });
          }
        }
      } catch (e) {
        console.error(`Error reading file ${mediaPath}:`, e);
        otherFiles.push({ path: mediaPath, data: null });
      }
    } else {
      otherFiles.push({ path: mediaPath, data: null });
    }
  }

  const results = [];
  let processedCount = 0;
  const totalBatchFiles = imagesToCompress.length + otherFiles.length;

  // Process images in parallel
  if (imagesToCompress.length > 0) {
    const compressionOptions = typeof options.compressImages === 'object' ? options.compressImages : {
      quality: COMPRESSION_SETTINGS.quality,
      allowFormatConversion: COMPRESSION_SETTINGS.allowFormatConversion,
      allowDownsampling: COMPRESSION_SETTINGS.allowDownsampling,
      maxImageSize: COMPRESSION_SETTINGS.maxImageSize,
      compressionMethod: COMPRESSION_SETTINGS.compressionMethod
    };
    
    const compressedImages = await compressImagesInParallel(imagesToCompress, compressionOptions, (progress) => {
      processedCount++;
      const batchProgress = (processedCount / totalBatchFiles) * 100;
      onProgress('media', {
        fileIndex: currentIndex + processedCount,
        totalFiles: totalFiles,
        processedFiles: batch.map(r => r.split('/').pop()),
        estimatedTimeRemaining: null,
        batchProgress: batchProgress
      });
    });
    
    // Update compressed images
    for (let i = 0; i < imagesToCompress.length; i++) {
      const { path } = imagesToCompress[i];
      const compressedData = compressedImages[i];
      
      try {
        if (compressedData && compressedData.data) {
          // Ensure we're using the correct data format
          const finalData = compressedData.data instanceof Uint8Array ? 
            compressedData.data : 
            new Uint8Array(compressedData.data);
            
          // Update the file in the zip with the compressed data
          zip.file(path, finalData);
          
          results.push({
            path,
            originalSize: imagesToCompress[i].data.byteLength,
            compressedSize: finalData.byteLength,
            success: true,
            error: null
          });
        } else {
          // If compression failed, keep the original data
          results.push({
            path,
            originalSize: imagesToCompress[i].data.byteLength,
            compressedSize: imagesToCompress[i].data.byteLength,
            success: false,
            error: 'Compression failed - no valid data returned'
          });
        }
      } catch (error) {
        console.error(`Error updating compressed image ${path}:`, error);
        results.push({
          path,
          originalSize: imagesToCompress[i].data.byteLength,
          compressedSize: imagesToCompress[i].data.byteLength,
          success: false,
          error: error.message
        });
      }
    }
  }

  // Process other files - just record their sizes, don't modify them
  for (const { path, data } of otherFiles) {
    try {
      let fileOriginalSize = 0;
      let fileCompressedSize = 0;
      
      const file = zip.file(path);
      if (file) {
        const fileData = await file.async('uint8array');
        if (fileData) {
          fileOriginalSize = fileData.byteLength;
          fileCompressedSize = fileOriginalSize;
        }
      }
      
      results.push({
        path,
        originalSize: fileOriginalSize,
        compressedSize: fileCompressedSize,
        success: true,
        error: null
      });
    } catch (error) {
      console.error(`Error processing other file ${path}:`, error);
      results.push({
        path,
        originalSize: 0,
        compressedSize: 0,
        success: false,
        error: error.message
      });
    }
  }

  return results;
}

export async function optimizePPTX(file, options = {}) {
  // Get compression options from settings directly
  const presetOptions = {
    quality: COMPRESSION_SETTINGS.quality,
    allowFormatConversion: COMPRESSION_SETTINGS.allowFormatConversion,
    allowDownsampling: COMPRESSION_SETTINGS.allowDownsampling,
    maxImageSize: COMPRESSION_SETTINGS.maxImageSize,
    compressionMethod: COMPRESSION_SETTINGS.compressionMethod
  };
  
  const mergedOptions = {
    ...options,
    compressImages: options.compressImages !== false ? {
      quality: presetOptions.quality,
      allowFormatConversion: presetOptions.allowFormatConversion,
      allowDownsampling: presetOptions.allowDownsampling,
      maxImageSize: presetOptions.maxImageSize,
      compressionMethod: presetOptions.compressionMethod
    } : false
  };

  let zip;
  const { onProgress = updateProgress } = mergedOptions;
  const startTime = Date.now();
  let finalStats = {
    originalSize: file?.size || 0,
    compressedSize: null,
    savedSize: 0,
    savedPercentage: 0,
    originalMediaSize: 0,
    compressedMediaSize: 0,
    savedMediaSize: 0,
    savedMediaPercentage: 0,
    processingTime: 0,
    error: null
  };

  try {
    validateFile(file);

    const hasHardwareConcurrency = typeof navigator !== 'undefined' && 'hardwareConcurrency' in navigator;
    const cpuCount = hasHardwareConcurrency ? navigator.hardwareConcurrency : 4;

    onProgress('fileInfo', { name: file.name, size: file.size });

    try {
      zip = await JSZip.loadAsync(file);
    } catch (zipError) {
      throw new Error('Invalid or corrupted file format. Please upload a valid PowerPoint file.');
    }

    if (mergedOptions.compressImages !== false) {
      const mediaFiles = [];
      // Find all media files in the zip
      for (const path in zip.files) {
        if (path.startsWith('ppt/media/') && !zip.files[path].dir) {
          mediaFiles.push(path);
        }
      }
      
      onProgress('mediaCount', { count: mediaFiles.length });

      let totalOriginalMediaSize = 0;
      let totalCompressedMediaSize = 0;
      let processedMediaCount = 0;
      let failedMediaCount = 0;

      if (mediaFiles.length > 0) {
        const batchSize = Math.min(
          mediaFiles.length,
          mediaFiles.some(f => zip.files[f].data && zip.files[f].data.length > 10 * 1024 * 1024) ? 1 :
          mediaFiles.some(f => zip.files[f].data && zip.files[f].data.length > 5 * 1024 * 1024) ? 2 :
          4
        );

        for (let i = 0; i < mediaFiles.length; i += batchSize) {
          const batch = mediaFiles.slice(i, i + batchSize);
          const batchResults = await processMediaBatch(zip, batch, mergedOptions, cpuCount, onProgress, i, mediaFiles.length);
          
          batchResults.forEach(result => {
            totalOriginalMediaSize += result.originalSize || 0;
            totalCompressedMediaSize += result.compressedSize || 0;
            if (result.success) {
              processedMediaCount++;
            } else {
              failedMediaCount++;
            }
          });
          
          const elapsed = Date.now() - startTime;
          const currentProcessedTotal = processedMediaCount + failedMediaCount;
          const estimatedRemaining = calculateEstimatedTime(elapsed, currentProcessedTotal, mediaFiles.length);
          
          onProgress('media', {
            fileIndex: Math.min(i + batchSize, mediaFiles.length),
            totalFiles: mediaFiles.length,
            processedFiles: batchResults.map(r => r.path.split('/').pop()),
            estimatedTimeRemaining: Math.round(estimatedRemaining / 1000)
          });
        }
        
        finalStats.originalMediaSize = totalOriginalMediaSize;
        finalStats.compressedMediaSize = totalCompressedMediaSize;
        const mediaStats = calculateSavedStats(totalOriginalMediaSize, totalCompressedMediaSize);
        finalStats.savedMediaSize = mediaStats.savedSize;
        finalStats.savedMediaPercentage = mediaStats.savedPercentage;
      }
    }

    onProgress('finalize', {
      status: "Rebuilding presentation...",
      stats: finalStats
    });

    const compressedBlob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: COMPRESSION_SETTINGS.ZIP_COMPRESSION_LEVEL },
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    });

    finalStats.compressedSize = compressedBlob.size;
    const overallStats = calculateSavedStats(finalStats.originalSize, compressedBlob.size);
    finalStats.savedSize = overallStats.savedSize;
    finalStats.savedPercentage = overallStats.savedPercentage;
    finalStats.processingTime = (Date.now() - startTime) / 1000;

    onProgress('complete', { stats: finalStats });

    return compressedBlob;

  } catch (error) {
    finalStats.error = error.message;
    finalStats.processingTime = (Date.now() - startTime) / 1000;
    onProgress('error', {
      message: error.message,
      stats: finalStats
    });

    throw error;
  }
}