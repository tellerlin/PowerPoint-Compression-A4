// 图像压缩Web Worker

// 导入压缩所需的工具函数
importScripts('../utils/compression-utils.js');

// 图像压缩函数
import { processImage } from '../utils/imageCompressionUtils.js';

// 监听主线程消息
self.addEventListener('message', async (event) => {
  try {
    const { data, quality, format } = event.data;
    
    console.log(`[ImageCompressionWorker] Processing image: format=${format}, quality=${quality}, size=${data.byteLength} bytes`);
    
    // 执行图像压缩
    const result = await self.processImage(data, quality, format);
    
    console.log(`[ImageCompressionWorker] Compression complete: originalSize=${result.originalSize}, compressedSize=${result.compressedSize}, method=${result.compressionMethod}`);
    
    // 将结果发送回主线程
    self.postMessage({
      success: true,
      result
    });
  } catch (error) {
    console.error(`[ImageCompressionWorker] Error: ${error.message}`);
    // 发送错误信息回主线程
    self.postMessage({
      success: false,
      error: error.message
    });
  }
});

// 辅助函数
function checkAlphaChannel(imageData) {
  const data = imageData.data;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true;
  }
  return false;
}

function calculateOptimalDimensions(originalWidth, originalHeight, maxSize = 1920) {
  if (originalWidth <= maxSize && originalHeight <= maxSize) {
    return { width: originalWidth, height: originalHeight };
  }
  
  const aspectRatio = originalWidth / originalHeight;
  let targetWidth, targetHeight;
  
  if (originalWidth > originalHeight) {
    targetWidth = maxSize;
    targetHeight = Math.round(targetWidth / aspectRatio);
  } else {
    targetHeight = maxSize;
    targetWidth = Math.round(targetHeight * aspectRatio);
  }
  
  return { width: targetWidth, height: targetHeight };
}

async function detectFormat(data) {
  if (data.length < 12) return 'unknown';
  const bytes = data.slice(0, 12);
  const header = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  
  if (header.startsWith('89504e470d0a1a0a')) return 'png';
  if (header.startsWith('ffd8ff')) return 'jpeg';
  if (header.startsWith('474946383761') || header.startsWith('474946383961')) return 'gif';
  if (header.startsWith('424d')) return 'bmp';
  if (header.startsWith('52494646') && header.endsWith('57454250')) return 'webp';
  
  return 'unknown';
}