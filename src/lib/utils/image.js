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
  try {
    const cacheKey = data.byteLength + '-' + quality;
    if (imageCache.get(cacheKey)) {
      return imageCache.get(cacheKey);
    }

    validateImageData(data);
    const blob = new Blob([data]);

    if (quality < 0 || quality > 1) {
      console.warn('Invalid quality value, using default quality');
      quality = COMPRESSION_SETTINGS.DEFAULT_QUALITY;
    }

    try {
      const bitmap = await createImageBitmap(blob);
      const originalSize = data.byteLength;
      const originalFormat = await detectFormat(data);

      const { width, height } = calculateOptimalDimensions(bitmap.width, bitmap.height);
      const canvas = await resizeImage(bitmap, width, height);
      const imageData = await getImageData(canvas);
      const analysis = analyzeImage(imageData);

      // Use higher quality for small images
      if (data.byteLength < 50 * 1024) { // Images under 50KB
        quality = Math.min(0.92, quality + 0.03); // Slightly increase quality
      }
      
      let compressedBlob;
      // Use higher quality for transparent images
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

      // If compressed size is larger than original, keep original image
      const compressedSize = compressedBlob.size;
      if (compressedSize > originalSize) {
        return { data, format: originalFormat || 'original' };
      }

      // Ensure we return Uint8Array not Blob
      const compressedData = new Uint8Array(await compressedBlob.arrayBuffer());
      const result = { data: compressedData, format: compressedBlob.type.split('/').pop() };
      imageCache.set(cacheKey, result);
      return result;
    } catch (error) {
      console.error('Image processing failed:', error);
      return { data, format: 'original' }; // Return original data on error
    }
  } catch (error) {
    console.error('Image compression failed:', error);
    return { data, format: 'original' }; // Return original data on error
  }
}