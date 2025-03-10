import { COMPRESSION_SETTINGS } from '../pptx/constants';
import { validateImageData } from './validation';

async function getImageData(canvas) {
  return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
}

function checkAlphaChannel(imageData) {
  const data = imageData.data;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  return false;
}

function analyzeImage(imageData) {
  return { hasAlpha: checkAlphaChannel(imageData), isAnimated: false };
}

function calculateOptimalDimensions(originalWidth, originalHeight, maxWidth = 1366, maxHeight = 768) {
  let width = originalWidth, height = originalHeight;
  if (width > maxWidth) { height = Math.round((height * maxWidth) / width); width = maxWidth; }
  if (height > maxHeight) { width = Math.round((width * maxHeight) / height); height = maxHeight; }
  return { width, height };
}

async function resizeImage(bitmap, targetWidth, targetHeight) {
  const canvas = new OffscreenCanvas(targetWidth, targetHeight);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get canvas context');
  ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
  return canvas;
}

async function detectFormat(data) {
  try {
    const image = new Image();
    const url = URL.createObjectURL(new Blob([data]));
    image.src = url;
    await image.decode();
    URL.revokeObjectURL(url);
    return image.complete ? image.naturalWidth > 0 ? image.src.split('.').pop() : 'unknown' : 'unknown';
  } catch (error) {
    console.warn('Format detection failed:', error);
    return 'unknown';
  }
}

const imageCache = new Map();

export async function compressImage(data, quality = COMPRESSION_SETTINGS.DEFAULT_QUALITY) {
  const cacheKey = data.byteLength + quality;
  if (imageCache.has(cacheKey)) {
    return imageCache.get(cacheKey);
  }

  validateImageData(data);
  const blob = new Blob([data]);

  if (quality < 0 || quality > 1) {
    throw new Error('Quality must be between 0 and 1.');
  }

  try {
    const bitmap = await createImageBitmap(blob);
    const originalSize = data.byteLength;
    const originalFormat = await detectFormat(data);

    const { width, height } = calculateOptimalDimensions(bitmap.width, bitmap.height);
    const canvas = await resizeImage(bitmap, width, height);
    const imageData = await getImageData(canvas);
    const analysis = analyzeImage(imageData);

    let compressedBlob;
    if (analysis.hasAlpha) {
      compressedBlob = await canvas.convertToBlob({ type: 'image/webp', quality });
    } else {
      const [webpBlob, jpegBlob] = await Promise.all([
        canvas.convertToBlob({ type: 'image/webp', quality }),
        canvas.convertToBlob({ type: 'image/jpeg', quality })
      ]);
      const webpBuffer = await webpBlob.arrayBuffer();
      const jpegBuffer = await jpegBlob.arrayBuffer();

      compressedBlob = (webpBuffer.byteLength < jpegBuffer.byteLength && webpBuffer.byteLength < originalSize)
        ? webpBlob
        : jpegBlob;
    }

    // 确保返回的是 Uint8Array 而不是 Blob
    const compressedData = new Uint8Array(await compressedBlob.arrayBuffer());
    return { data: compressedData, format: compressedBlob.type.split('/').pop() };
  } catch (error) {
    throw new Error('Image processing failed: ' + error.message);
  }
}
