import JSZip from 'jszip';
import { findMediaFiles, processMediaFile } from './media';
import { compressImage } from '../utils/image';
import { validateFile } from '../utils/validation';
import { COMPRESSION_SETTINGS } from './constants';
import { removeHiddenSlides } from './slides';

export async function optimizePPTX(file, options = {}) {
  try {
    validateFile(file);
    
    const zip = await JSZip.loadAsync(file);

    if (options.removeHiddenSlides) {
      await removeHiddenSlides(zip);
    }

    const mediaFiles = findMediaFiles(zip);
    await Promise.all(mediaFiles.map(mediaPath => 
      processMediaFile(zip, mediaPath, data => 
        compressImage(data, options.compressImages?.quality)
      )
    ));

    return await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { 
        level: COMPRESSION_SETTINGS.ZIP_COMPRESSION_LEVEL 
      }
    });
  } catch (error) {
    return file;
  }
}