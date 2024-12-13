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
      const originalData = await zip.files[mediaPath].async('arraybuffer');  
      const compressedResult = await compressor(new Uint8Array(originalData));  

      // Update the zip file with compressed data  
      zip.file(mediaPath, compressedResult.data, { binary: true });  
  }  
}