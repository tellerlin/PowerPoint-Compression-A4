import JSZip from 'jszip';
import { validateFile } from '../utils/validation';
import { compressImage } from '../utils/image';
import { COMPRESSION_SETTINGS, SUPPORTED_IMAGE_EXTENSIONS } from './constants';
import { findMediaFiles as findMediaFilesFromUtil, processMediaFile } from './pptx-utils';
import { removeHiddenSlides } from './slides';
import { cleanUnusedResources } from './cleaner';

async function preprocessImages(zip, options = {}) {
    // Placeholder for future implementation (e.g., duplicate detection)
    console.log('[preprocessImages] Preprocessing step (currently placeholder).');
    return true;
}


export async function optimizePPTX(file, options = {}) {
  let zip;
  const { onProgress = () => {} } = options;
  const startTime = Date.now();
  let finalStats = { // Initialize with defaults
      originalSize: file?.size || 0,
      compressedSize: null,
      savedSize: 0,
      savedPercentage: 0,
      originalMediaSize: 0,
      compressedMediaSize: 0,
      savedMediaSize: 0,
      savedMediaPercentage: 0,
      processingTime: 0
  };

  try {
    validateFile(file);

    const hasHardwareConcurrency = typeof navigator !== 'undefined' && 'hardwareConcurrency' in navigator;
    const cpuCount = hasHardwareConcurrency ? navigator.hardwareConcurrency : 4; // Default to 4 if undefined

    onProgress('fileInfo', { name: file.name, size: file.size });

    try {
      console.log('[optimizePPTX] Loading ZIP file...');
      zip = await JSZip.loadAsync(file);
      console.log('[optimizePPTX] ZIP file loaded.');
    } catch (zipError) {
      console.error('[optimizePPTX] ZIP loading error:', zipError);
      const errorMessage = zipError.message.includes('invalid')
        ? 'Invalid or corrupted file format. Please upload a valid PowerPoint file.'
        : `Failed to load file: ${zipError.message}`;
      throw new Error(errorMessage);
    }

    const debug = options.debug || false;
    if (debug) {
      zip.debug = true;
      console.log('[optimizePPTX] Debug mode enabled.');
    }

    // --- Step 1: Remove Hidden Slides ---
    if (options.removeHiddenSlides) {
      onProgress('init', { percentage: 10, status: 'Removing hidden slides...' });
      console.log('[optimizePPTX] Starting hidden slide removal...');
      try {
         await removeHiddenSlides(zip); // Assumes this function logs internally
         console.log('[optimizePPTX] Hidden slide removal step finished.');
      } catch (error) {
          console.error('[optimizePPTX] Error during hidden slide removal:', error);
          // Continue processing even if this step fails? Or throw? For now, continue.
      }
    } else {
         console.log('[optimizePPTX] Skipping hidden slide removal.');
    }

    // --- Step 2: Clean Unused Resources (Layouts, Masters, Media) ---
    // This function now handles layouts/masters removal internally based on options
    // and performs the final content type update.
    console.log('[optimizePPTX] Starting unused resource cleanup step...');
    await cleanUnusedResources(zip, onProgress, {
        removeUnusedLayouts: options.removeUnusedLayouts,
        cleanMediaInUnusedLayouts: options.cleanMediaInUnusedLayouts, // Pass this option if needed
    });
    console.log('[optimizePPTX] Unused resource cleanup step finished.');


    // --- Step 3: Preprocess Images (Optional Placeholder) ---
    if (options.preprocessImages) {
        onProgress('init', { percentage: 35, status: 'Preprocessing images...' });
        await preprocessImages(zip, { /* Options */ });
    }

    // --- Step 4: Compress Media Files ---
    if (options.compressImages) {
        console.log('[optimizePPTX] Starting media compression step...');
        const mediaFiles = findMediaFilesFromUtil(zip); // Find remaining media files
        onProgress('mediaCount', { count: mediaFiles.length });

        let totalOriginalMediaSize = 0;
        let totalCompressedMediaSize = 0;
        const batchSize = Math.min(mediaFiles.length, Math.max(4, cpuCount));

        if (mediaFiles.length > 0) {
            for (let i = 0; i < mediaFiles.length; i += batchSize) {
              const batch = mediaFiles.slice(i, i + batchSize);
              const batchPromises = batch.map(mediaPath => {
                return (async () => {
                  try {
                    const fileExtension = mediaPath.split('.').pop()?.toLowerCase() || '';
                    const isImage = SUPPORTED_IMAGE_EXTENSIONS.includes(fileExtension);
                    let result = { originalSize: 0, compressedSize: 0 };

                    // processMediaFile reads, processes (compresses), and writes back
                    await processMediaFile(zip, mediaPath, async (data) => {
                      result.originalSize = data.byteLength;
                      if (isImage) {
                        const qualityOption = typeof options.compressImages === 'object' ? options.compressImages.quality : undefined;
                        const adjustedQuality = qualityOption || COMPRESSION_SETTINGS.DEFAULT_QUALITY;
                        const compressResult = await compressImage(data, adjustedQuality);
                        result.compressedSize = compressResult?.data?.byteLength || data.byteLength;
                        return compressResult?.data || data; // Return compressed or original data
                      } else {
                        // Not an image type we compress
                        result.compressedSize = data.byteLength;
                        return data; // Return original data
                      }
                    });

                    return { path: mediaPath, ...result, success: true };
                  } catch (error) {
                    console.error(`[optimizePPTX] Failed to process media file: ${mediaPath}`, error);
                    // Try to get original size even if processing failed
                    let originalSize = 0;
                    try {
                        const file = zip.file(mediaPath);
                        if(file) originalSize = (await file.async('uint8array')).byteLength;
                    } catch(e){}
                    return { path: mediaPath, success: false, error: error.message, originalSize: originalSize, compressedSize: originalSize };
                  }
                })();
              });

              const batchResults = await Promise.all(batchPromises);

              // Aggregate stats from batch results
              batchResults.forEach(result => {
                totalOriginalMediaSize += result.originalSize || 0;
                totalCompressedMediaSize += result.compressedSize || result.originalSize || 0; // Use original if compressed failed
              });

              const elapsed = Date.now() - startTime;
              const processedCount = Math.min(i + batchSize, mediaFiles.length);
              const estimatedTotalTime = mediaFiles.length > 0 && processedCount > 0 ? (elapsed / processedCount) * mediaFiles.length : 0;
              const estimatedRemaining = Math.max(0, estimatedTotalTime - elapsed);

              onProgress('media', {
                fileIndex: processedCount,
                totalFiles: mediaFiles.length,
                processedFiles: batch.map(p => p.split('/').pop()),
                estimatedTimeRemaining: Math.round(estimatedRemaining / 1000)
              });
            }

            // Update final stats after loop
            finalStats.originalMediaSize = totalOriginalMediaSize;
            finalStats.compressedMediaSize = totalCompressedMediaSize;
            finalStats.savedMediaSize = totalOriginalMediaSize - totalCompressedMediaSize;
            finalStats.savedMediaPercentage = totalOriginalMediaSize > 0 ? ((totalOriginalMediaSize - totalCompressedMediaSize) / totalOriginalMediaSize * 100).toFixed(1) : 0;

            console.log('[optimizePPTX] Media compression step finished.');
        } else {
             console.log('[optimizePPTX] No media files found to compress.');
        }
    } else {
         console.log('[optimizePPTX] Skipping media compression step.');
    }


    // --- Step 5: Finalize and Generate Blob ---
    onProgress('finalize', {
      status: `Rebuilding presentation...`,
      stats: finalStats // Pass current stats
    });

    console.log('[optimizePPTX] Generating final ZIP file...');
    const compressedBlob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 }
      // mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' // Optional: Set MIME type
    });
    console.log('[optimizePPTX] Final ZIP file generated.');

    // Update final stats with blob size and time
    finalStats.compressedSize = compressedBlob.size;
    finalStats.savedSize = finalStats.originalSize - compressedBlob.size;
    finalStats.savedPercentage = finalStats.originalSize > 0 ? (finalStats.savedSize / finalStats.originalSize * 100).toFixed(1) : 0;
    finalStats.processingTime = (Date.now() - startTime) / 1000;

    onProgress('complete', { stats: finalStats });
    console.log('[optimizePPTX] Optimization process completed successfully.');

    return compressedBlob;

  } catch (error) {
    console.error('[optimizePPTX] Optimization failed:', error);

    let userFriendlyMessage = 'An unexpected error occurred during optimization.';
    if (error.message.includes('format') || error.name === 'SyntaxError') { // Catch XML parsing errors too
        userFriendlyMessage = 'Invalid or corrupted file. Please ensure it is a valid PowerPoint file.';
    } else if (error.message.includes('memory') || error.message.includes('buffer') || error instanceof RangeError) {
        userFriendlyMessage = 'Processing failed due to memory or size constraints. Try closing other tabs or using a smaller file.';
    } else if (error instanceof ReferenceError) {
         userFriendlyMessage = 'A programming error occurred. Please report this issue.';
         console.error("ReferenceError Details:", error.message, error.stack);
    } else if (error instanceof TypeError) {
         userFriendlyMessage = 'A data type error occurred. Please report this issue.';
         console.error("TypeError Details:", error.message, error.stack);
    }
    // Add more specific error checks if needed

    finalStats.processingTime = (Date.now() - startTime) / 1000; // Add time even on error
    onProgress('error', {
      message: userFriendlyMessage,
      details: error.message,
      stats: finalStats // Include stats collected so far
    });

    // Re-throw the error so the caller knows it failed
    throw error;
  }
}
