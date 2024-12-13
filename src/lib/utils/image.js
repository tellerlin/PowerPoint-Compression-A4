import { COMPRESSION_SETTINGS } from '../pptx/constants';
import { validateImageData } from './validation';

export async function compressImage(data, quality = COMPRESSION_SETTINGS.DEFAULT_QUALITY) {
  validateImageData(data);
  
  const blob = new Blob([data]);
  const bitmap = await createImageBitmap(blob);
  const { width, height } = calculateDimensions(bitmap);
  
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, width, height);
  
  const compressedBlob = await canvas.convertToBlob({ 
    type: 'image/jpeg', 
    quality 
  });
  return new Uint8Array(await compressedBlob.arrayBuffer());
}

function calculateDimensions(bitmap) {
  const maxSize = COMPRESSION_SETTINGS.MAX_IMAGE_SIZE;
  let { width, height } = bitmap;
  
  if (width > maxSize || height > maxSize) {
    const ratio = Math.min(maxSize / width, maxSize / height);
    width = Math.floor(width * ratio);
    height = Math.floor(height * ratio);
  }
  
  return { width, height };
}