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
  let memFS = {};
  let usedMedia = new Set();
  const onProgress = options.onProgress || (() => {});
  const originalSize = file.size;

  try {
    // Step 1: Load PPTX and convert to memFS
    console.log('Loading PPTX file...');
    const zip = await JSZip.loadAsync(file);
    console.log('Converting ZIP to memory file system...');
    memFS = await zipToMemFS(zip);
    console.log(`memFS created with ${Object.keys(memFS).length} entries.`);

    // Step 2: Clean unused resources using memFS
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
    }

    // Step 3: Compress images within memFS
    if (options.compressImages !== false) {
      console.log('Starting image compression...');
      const mediaFiles = Array.from(usedMedia);
      console.log(`Found ${mediaFiles.length} media files for potential compression.`);
      let compressedCount = 0;
      let skippedCount = 0;
      let failedCount = 0;

      // 新增：图片压缩进度反馈与并发控制
      const concurrency = options.concurrency || 4;
      let currentIndex = 0;

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
          const imageQuality = options.imageQuality !== undefined ? options.imageQuality : 0.8;
          const compressedResult = await compressImage(data, imageQuality);

          if (compressedResult && compressedResult.data && compressedResult.data.byteLength < data.byteLength) {
            writeFileToMemFS(memFS, mediaPath, compressedResult.data);
            compressedCount++;
            console.log(`Compressed ${mediaPath} (saved ${data.byteLength - compressedResult.data.byteLength} bytes)`);
          } else if (compressedResult && compressedResult.data) {
            skippedCount++;
            console.log(`Skipping update for ${mediaPath}, compressed size not smaller.`);
          } else {
            skippedCount++;
            console.warn(`Compression result for ${mediaPath} is invalid, skipping update.`);
          }
        } catch (compressError) {
          failedCount++;
          console.error(`Error compressing media file ${mediaPath}:`, compressError);
        } finally {
          // 进度反馈
          onProgress('media', {
            fileIndex: compressedCount + skippedCount + failedCount,
            totalFiles: mediaFiles.length,
            compressedCount,
            skippedCount,
            failedCount
          });
          // 递归压缩下一个
          if (currentIndex < mediaFiles.length) {
            await compressNext();
          }
        }
      }

      // 启动并发压缩
      const workers = [];
      for (let i = 0; i < concurrency && i < mediaFiles.length; i++) {
        workers.push(compressNext());
      }
      await Promise.all(workers);

      console.log(`Image compression finished. Compressed ${compressedCount} files, skipped ${skippedCount}, failed ${failedCount}.`);
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

    onProgress('complete', {
      status: 'Compression complete!',
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