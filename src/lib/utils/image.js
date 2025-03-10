import { COMPRESSION_SETTINGS } from '../pptx/constants';
import { validateImageData } from './validation';
import { imageCache } from './cache';

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

function calculateOptimalDimensions(originalWidth, originalHeight, maxWidth = COMPRESSION_SETTINGS.MAX_IMAGE_SIZE, maxHeight = COMPRESSION_SETTINGS.MAX_IMAGE_SIZE) {
  // 如果图像已经足够小，保持原始尺寸
  if (originalWidth <= maxWidth && originalHeight <= maxHeight) {
    return { width: originalWidth, height: originalHeight };
  }
  
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

export async function compressImage(data, quality = COMPRESSION_SETTINGS.DEFAULT_QUALITY) {
  const cacheKey = data.byteLength + '-' + quality;
  if (imageCache.get(cacheKey)) {
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

    // 对于小图像，使用更高的质量
    if (data.byteLength < 50 * 1024) { // 50KB以下的图像
      quality = Math.min(0.92, quality + 0.03); // 稍微提高质量
    }
    
    let compressedBlob;
    // 对于透明图像，使用更高的质量
    if (analysis.hasAlpha) {
      compressedBlob = await canvas.convertToBlob({ type: 'image/webp', quality: Math.min(0.92, quality + 0.03) });
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

    // 如果压缩后的大小大于原始大小，保留原始图像
    const compressedSize = compressedBlob.size;
    if (compressedSize > originalSize) {
      return { data, format: originalFormat || 'original' };
    }

    // 确保返回的是 Uint8Array 而不是 Blob
    const compressedData = new Uint8Array(await compressedBlob.arrayBuffer());
    const result = { data: compressedData, format: compressedBlob.type.split('/').pop() };
    imageCache.set(cacheKey, result);
    return result;
  } catch (error) {
    throw new Error('Image processing failed: ' + error.message);
  }
}