import JSZip from 'jszip';
// import { validateFile } from '../utils/validation'; // Assuming validation happens elsewhere or is not needed here
import { compressImage } from '../utils/image';
// import { COMPRESSION_SETTINGS, SUPPORTED_IMAGE_EXTENSIONS } from './constants'; // SUPPORTED_IMAGE_EXTENSIONS might be needed if compressImage doesn't handle type checks
import { findMediaFiles } from './media'; // Keep findMediaFiles, now expects memFS
// import { processMediaFile } from './pptx-utils'; // processMediaFile is likely replaced by direct read/compress/write logic
// import { removeHiddenSlides } from './slides'; // Assuming slide removal is part of cleaner or not implemented here
// import { removeUnusedLayouts } from './layout-cleaner'; // This is called within cleaner
import { cleanUnusedResources } from './cleaner'; // Expects memFS, returns { success, memFS, error? }
import { zipToMemFS, memFSToZip, readFileFromMemFS, writeFileToMemFS } from './zip-fs'; // Import memFS helpers

// Remove preprocessImages and simpleHash as they are not integrated with memFS
/*
async function preprocessImages(zip, options = {}) { ... }
function simpleHash(data) { ... }
*/

export async function optimizePPTX(file, options = {}) {
  let memFS = {}; // Initialize memFS
  let usedMedia = new Set();
  const onProgress = options.onProgress || (() => {}); // Get onProgress callback
  const originalSize = file.size; // Store original size

  try {
    // Step 1: Load PPTX and convert to memFS
    console.log('Loading PPTX file...');
    const zip = await JSZip.loadAsync(file);
    console.log('Converting ZIP to memory file system...');
    memFS = await zipToMemFS(zip);
    console.log(`memFS created with ${Object.keys(memFS).length} entries.`);

    // Step 2: Clean unused resources using memFS
    if (options.cleanUnusedResources !== false) { // Default to true unless explicitly false
      console.log('Starting resource cleaning...');
      const cleanResult = await cleanUnusedResources(memFS, options.onProgress || (() => {}), {
        removeUnusedLayouts: options.removeUnusedLayouts !== false,
        // cleanMediaInUnusedLayouts: options.cleanMediaInUnusedLayouts
      });

      if (!cleanResult.success) {
        console.warn("Resource cleaning failed. Proceeding with potentially partially cleaned state.");
        memFS = cleanResult.memFS;
      } else {
        console.log("Resource cleaning successful.");
        memFS = cleanResult.memFS;
      }
      // 新增：获取 usedMedia
      usedMedia = cleanResult.usedMedia || new Set(); // <-- 赋值到外部变量
      console.log(`memFS now has ${Object.keys(memFS).length} entries after cleaning.`);
    } else {
      console.log('Skipping resource cleaning step.');
    }

    // Step 3: Compress images within memFS
    if (options.compressImages !== false) { // Default to true unless explicitly false
        console.log('Starting image compression...');
        // 只压缩被引用的媒体文件
        const mediaFiles = Array.from(usedMedia); // <-- 这里不会报错了
        console.log(`Found ${mediaFiles.length} media files for potential compression.`);
        let compressedCount = 0;

        // Use Promise.all for potentially parallel compression (if compressImage is truly async)
        await Promise.all(mediaFiles.map(async (mediaPath) => {
            try {
                // Read image data from memFS
                const data = readFileFromMemFS(memFS, mediaPath, 'uint8array');
                if (!data) {
                    console.warn(`Media file ${mediaPath} not found in memFS during compression, skipping.`);
                    return;
                }

                // Compress the image
                // 从 options 中获取 imageQuality，如果未提供，则使用默认值（例如 0.8）
                const imageQuality = options.imageQuality !== undefined ? options.imageQuality : 0.8; // 或者从 COMPRESSION_SETTINGS 获取默认值
                const compressedResult = await compressImage(data, imageQuality); // <-- 直接传递 quality 数字

                // Write compressed data back to memFS if compression occurred and was successful
                if (compressedResult && compressedResult.data && compressedResult.data.byteLength < data.byteLength) {
                    writeFileToMemFS(memFS, mediaPath, compressedResult.data);
                    compressedCount++;
                    console.log(`Compressed ${mediaPath} (saved ${data.byteLength - compressedResult.data.byteLength} bytes)`);
                } else if (compressedResult && compressedResult.data) {
                    console.log(`Skipping update for ${mediaPath}, compressed size not smaller.`);
                } else {
                    console.warn(`Compression result for ${mediaPath} is invalid, skipping update.`);
                }
            } catch (compressError) {
                console.error(`Error compressing media file ${mediaPath}:`, compressError);
                // Decide whether to continue or stop on error
            }
        }));
        console.log(`Image compression finished. Compressed ${compressedCount} files.`);
    } else {
        console.log('Skipping image compression step.');
    }


    // Step 4: Convert final memFS back to Zip
    console.log('Converting memory file system back to ZIP...');
    const finalZip = await memFSToZip(memFS);
    console.log('ZIP creation complete.');

    // Step 5: Generate Blob
    console.log('Generating final PPTX blob...');
    const blob = await finalZip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 }
    });
    console.log('PPTX optimization complete.');

    // Step 6: Report completion via onProgress
    const compressedSize = blob.size;
    const savedSize = originalSize - compressedSize;
    const savedPercentage = originalSize > 0 ? ((savedSize / originalSize) * 100).toFixed(2) : 0;

    onProgress('complete', { // <-- Call onProgress with 'complete' phase
      status: 'Compression complete!',
      stats: {
        originalSize: originalSize,
        compressedSize: compressedSize,
        savedSize: savedSize,
        savedPercentage: parseFloat(savedPercentage) // Ensure it's a number
        // Include other relevant stats if available
      }
    });

    return blob; // Return the final blob

  } catch (error) {
    console.error('Error during PPTX optimization process:', error);
    onProgress('error', { // <-- Report error via onProgress
        message: error.message || 'An unknown error occurred during optimization.',
        error: error,
        percentage: 99 // Or estimate progress based on where it failed
    });
    throw error; // Rethrowing for now
  }
}