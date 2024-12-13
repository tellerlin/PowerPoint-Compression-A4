import { COMPRESSION_SETTINGS } from '../pptx/constants';  
import { validateImageData } from './validation';  

// Helper to get image data  
async function getImageData(canvas) {  
    const ctx = canvas.getContext('2d');  
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);  
    return imageData;  
}  

// Function to check for alpha channel  
function checkAlphaChannel(imageData) {  
    const data = imageData.data;  
    for (let i = 3; i < data.length; i += 4) {  
        if (data[i] < 255) {  
            return true;  
        }  
    }  
    return false;  
}  

// Function to analyze image  
function analyzeImage(imageData) {  
    const hasAlpha = checkAlphaChannel(imageData);  
    const isAnimated = false; // Future enhancement: detect animated images  
    return { hasAlpha, isAnimated };  
}  

// Function to calculate optimal dimensions  
function calculateOptimalDimensions(originalWidth, originalHeight, maxWidth = 1366, maxHeight = 768) {  
    let width = originalWidth;  
    let height = originalHeight;  

    if (width > maxWidth) {  
        height = Math.round((height * maxWidth) / width);  
        width = maxWidth;  
    }  

    if (height > maxHeight) {  
        width = Math.round((width * maxHeight) / height);  
        height = maxHeight;  
    }  

    return { width, height };  
}  

// Function to resize image  
async function resizeImage(bitmap, targetWidth, targetHeight) {  
    const canvas = new OffscreenCanvas(targetWidth, targetHeight);  
    const ctx = canvas.getContext('2d');  

    if (!ctx) {  
        throw new Error('Failed to get canvas context');  
    }  

    ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);  
    return canvas;  
}  

// Function to detect image format  
async function detectFormat(data) {  
    const image = new Image();  
    const url = URL.createObjectURL(new Blob([data]));  
    image.src = url;  
    await image.decode();  
    URL.revokeObjectURL(url);  
    return image.complete ? image.naturalWidth > 0 ? image.src.split('.').pop() : 'unknown' : 'unknown';  
}  

// Main compression function  
export async function compressImage(data, quality = COMPRESSION_SETTINGS.DEFAULT_QUALITY) {  
  validateImageData(data);  

  const originalSize = data.byteLength;  
  const originalFormat = await detectFormat(data);  

  const blob = new Blob([data]);  
  const bitmap = await createImageBitmap(blob);  
  const { width, height } = calculateOptimalDimensions(bitmap.width, bitmap.height);  

  const canvas = await resizeImage(bitmap, width, height);  
  const imageData = await getImageData(canvas);  
  const analysis = analyzeImage(imageData);  

  let compressedBlob;  
  let format;  

  if (analysis.hasAlpha) {  
      compressedBlob = await canvas.convertToBlob({ type: 'image/webp', quality });  
      format = 'webp';  
  } else {  
      const [webpBlob, jpegBlob] = await Promise.all([  
          canvas.convertToBlob({ type: 'image/webp', quality }),  
          canvas.convertToBlob({ type: 'image/jpeg', quality })  
      ]);  

      const [webpBuffer, jpegBuffer] = await Promise.all([  
          webpBlob.arrayBuffer(),  
          jpegBlob.arrayBuffer()  
      ]);  

      const webpSize = webpBuffer.byteLength;  
      const jpegSize = jpegBuffer.byteLength;  

      if (webpSize <= jpegSize && webpSize < originalSize) {  
          compressedBlob = webpBlob;  
          format = 'webp';  
      } else if (jpegSize < originalSize) {  
          compressedBlob = jpegBlob;  
          format = 'jpeg';  
      } else {  
          compressedBlob = blob;  
          format = originalFormat;  
      }  
  }  

  return { data: compressedBlob, format };  
}