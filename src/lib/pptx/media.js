import { SUPPORTED_IMAGE_EXTENSIONS, MEDIA_PATH_PREFIX } from './constants';

export function findMediaFiles(zip) {
  const extensionPattern = new RegExp(
    `\\.(${SUPPORTED_IMAGE_EXTENSIONS.join('|')})$`, 
    'i'
  );
  
  return Object.keys(zip.files).filter(f => 
    f.startsWith(MEDIA_PATH_PREFIX) && 
    extensionPattern.test(f)
  );
}

export async function processMediaFile(zip, mediaPath, compressor) {  
  if (zip.files[mediaPath]) {  
      try {  
          const originalData = await zip.files[mediaPath].async('arraybuffer');  
          const compressedResult = await compressor(new Uint8Array(originalData));  
          zip.file(mediaPath, compressedResult.data, { binary: true });  
      } catch (error) {  
          // ... existing code ...
      }  
  }  
}