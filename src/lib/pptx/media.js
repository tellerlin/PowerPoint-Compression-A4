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

// 检查 processMediaFile 函数的实现
export async function processMediaFile(zip, mediaPath, processor) {
  const file = zip.file(mediaPath);
  if (!file) return;
  
  try {
    const data = await file.async('uint8array');
    const processed = await processor(data);
    
    // 确保 processed 是 Uint8Array
    if (processed instanceof Uint8Array) {
      zip.file(mediaPath, processed);
    } else if (processed && processed.data instanceof Uint8Array) {
      zip.file(mediaPath, processed.data);
    } else {
      console.error('Invalid processed data type for', mediaPath);
    }
  } catch (error) {
    console.error(`Error processing ${mediaPath}:`, error);
    throw error;
  }
}