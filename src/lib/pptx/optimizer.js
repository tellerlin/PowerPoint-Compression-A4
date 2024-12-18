import JSZip from 'jszip';
import { findMediaFiles, processMediaFile } from './media';
import { compressImage } from '../utils/image';
import { validateFile } from '../utils/validation';
import { COMPRESSION_SETTINGS } from './constants';
import { removeHiddenSlides } from './slides';

export async function optimizePPTX(file, options = {}) {
  try {
    validateFile(file);
    
    const { onProgress = () => {} } = options;
    
    onProgress('init', { percentage: 0, status: 'Loading PPTX file...' });
    const zip = await JSZip.loadAsync(file);
    onProgress('init', { percentage: 50, status: 'Analyzing file structure...' });
    
    if (options.removeHiddenSlides) {
      onProgress('init', { percentage: 75, status: 'Removing hidden slides...' });
      await removeHiddenSlides(zip);
    }
    
    onProgress('init', { percentage: 90, status: 'Scanning media files...' });
    const mediaFiles = findMediaFiles(zip);
    onProgress('mediaCount', { count: mediaFiles.length });
    onProgress('init', { percentage: 100, status: `Found ${mediaFiles.length} media files` });
    
    for (let i = 0; i < mediaFiles.length; i++) {
      const mediaPath = mediaFiles[i];
      try {
        await processMediaFile(zip, mediaPath, async (data) => {
          onProgress('media', {
            fileIndex: i + 1,
            fileName: mediaPath.split('/').pop(),
            totalFiles: mediaFiles.length
          });
          const result = await compressImage(data, options.compressImages?.quality);
          return result;
        });
      } catch (error) {
        // Continue with other files even if one fails
      }
    }
    
    onProgress('finalize', { status: 'Rebuilding presentation...' });
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