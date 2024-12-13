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

export async function processMediaFile(zip, mediaPath, compressImage) {
  const file = zip.file(mediaPath);
  if (!file) return;
  
  const data = await file.async('uint8array');
  const compressedData = await compressImage(data);
  zip.file(mediaPath, compressedData);
}