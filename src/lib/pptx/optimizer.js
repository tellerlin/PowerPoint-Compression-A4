import JSZip from 'jszip';
import { findMediaFiles, processMediaFile } from './media';
import { compressImage } from '../utils/image';
import { validateFile } from '../utils/validation';
import { COMPRESSION_SETTINGS, SUPPORTED_IMAGE_EXTENSIONS } from './constants';
import { removeHiddenSlides } from './slides';

export async function optimizePPTX(file, options = {}) {
  try {
    validateFile(file);
    
    const { onProgress = () => {} } = options;
    
    // Send initial file info
    onProgress('fileInfo', {
      name: file.name,
      size: file.size
    });
    
    const zip = await JSZip.loadAsync(file);
    
    if (options.removeHiddenSlides) {
      onProgress('init', { percentage: 75, status: 'Removing hidden slides...' });
      await removeHiddenSlides(zip);
    }
    
    const mediaFiles = findMediaFiles(zip);
    onProgress('mediaCount', { count: mediaFiles.length });
    
    let totalOriginalSize = 0;
    let totalCompressedSize = 0;
    
    for (let i = 0; i < mediaFiles.length; i++) {
      const mediaPath = mediaFiles[i];
      try {
        // Check if it's an image file
        const fileExtension = mediaPath.split('.').pop().toLowerCase();
        const isImage = SUPPORTED_IMAGE_EXTENSIONS.includes(fileExtension);
        
        await processMediaFile(zip, mediaPath, async (data) => {
          onProgress('media', {
            fileIndex: i + 1,
            totalFiles: mediaFiles.length
          });
          
          // Only compress image files
          if (isImage) {
            totalOriginalSize += data.byteLength;
            
            // Use appropriate quality setting
            let adjustedQuality = options.compressImages?.quality || COMPRESSION_SETTINGS.DEFAULT_QUALITY;
            
            const result = await compressImage(data, adjustedQuality);
            
            // Update compression statistics
            totalCompressedSize += result.data.byteLength;
            return result.data;
          }
          
          // Return original data for non-image files
          return data;
        });
      } catch (error) {
        // Continue with other files even if one fails
        console.warn(`Failed to process ${mediaPath}:`, error);
      }
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
      savedMediaPercentage: savedPercentage
    };
    
    // Report completion with final stats
    onProgress('complete', { stats: finalStats });
    
    return compressedBlob;
    
  } catch (error) {
    console.error('Optimization failed:', error);
    throw error;
  }
}