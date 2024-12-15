import JSZip from 'jszip';
import { findMediaFiles, processMediaFile } from './media';
import { compressImage } from '../utils/image';
import { validateFile } from '../utils/validation';
import { COMPRESSION_SETTINGS } from './constants';
import { removeHiddenSlides } from './slides';

export async function optimizePPTX(file, options = {}) {
  try {
    // Step 1: Validate input file
    validateFile(file);
    
    // Step 2: Load the PPTX file
    const zip = await JSZip.loadAsync(file);
    
    // Step 3: Remove hidden slides first
    if (options.removeHiddenSlides) {
      console.log('Removing hidden slides...');
      await removeHiddenSlides(zip);
    }
    
    // Step 4: Find all media files
    console.log('Scanning for media files...');
    const mediaFiles = findMediaFiles(zip);
    console.log(`Found ${mediaFiles.length} media files`);
    
    // Step 5: Process each media file sequentially
    console.log('Processing media files...');
    for (const mediaPath of mediaFiles) {
      try {
        await processMediaFile(zip, mediaPath, async (data) => {
          // Step 6: Compress each image
          const result = await compressImage(data, options.compressImages?.quality);
          return result;
        });
      } catch (error) {
        console.warn(`Failed to process ${mediaPath}:`, error);
        // Continue with other files even if one fails
      }
    }
    
    // Step 7: Generate final compressed file
    console.log('Generating compressed file...');
    return await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { 
        level: COMPRESSION_SETTINGS.ZIP_COMPRESSION_LEVEL 
      }
    });
    
  } catch (error) {
    console.error('Optimization failed:', error);
    throw error;
  }
}