import { COMPRESSION_SETTINGS } from '../pptx/constants';
import { validateImageData } from './validation';
import { imageCache } from './cache';
// Remove Squoosh import as it's not compatible with SvelteKit
// import { ImagePool } from '@squoosh/lib';

// Keep existing hashCode function and other utility functions
function hashCode(data) {
  // 简化的哈希算法，仅使用数据的部分样本
  let hash = 0;
  const step = Math.max(1, Math.floor(data.length / 100)); // 采样以提高性能
  for (let i = 0; i < data.length; i += step) {
    hash = ((hash << 5) - hash) + data[i];
    hash |= 0; // 转换为32位整数
  }
  return hash.toString(16);
}

// 添加图像类型枚举
const ImageType = {
  PHOTO: 'photo',
  DIAGRAM: 'diagram',
  ICON: 'icon',
  UNKNOWN: 'unknown'
};

// 添加图像类型分析函数
// 改进图像类型分析
function analyzeImageType(imageData) {
  const { width, height, data } = imageData;
  
  // 检查是否为图标（小尺寸，通常有透明度）
  if (width < 128 && height < 128) {
    return ImageType.ICON;
  }
  
  // 计算边缘密度和颜色分布
  let colorCount = 0;
  const colorMap = new Map();
  const sampleStep = Math.max(1, Math.floor((data.length / 4) / 2000)); // 增加采样点
  
  let edgeCount = 0;
  let transparentPixels = 0;
  let lastR = 0, lastG = 0, lastB = 0;
  
  for (let i = 0; i < data.length; i += sampleStep * 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    
    // 检测透明像素
    if (a < 250) {
      transparentPixels++;
    }
    
    // 简单的边缘检测 - 检查相邻像素的颜色变化
    if (i > 0) {
      const colorDiff = Math.abs(r - lastR) + Math.abs(g - lastG) + Math.abs(b - lastB);
      if (colorDiff > 100) { // 阈值可以调整
        edgeCount++;
      }
    }
    
    lastR = r;
    lastG = g;
    lastB = b;
    
    const colorKey = `${Math.floor(r/10)},${Math.floor(g/10)},${Math.floor(b/10)}`;
    
    if (!colorMap.has(colorKey)) {
      colorMap.set(colorKey, 1);
      colorCount++;
    } else {
      colorMap.set(colorKey, colorMap.get(colorKey) + 1);
    }
  }
  
  // 计算采样点总数
  const totalSamples = Math.floor(data.length / (4 * sampleStep));
  
  // 计算边缘密度和透明度比例
  const edgeDensity = edgeCount / totalSamples;
  const transparencyRatio = transparentPixels / totalSamples;
  
  // 分析颜色分布 - 查找主要颜色
  let dominantColors = 0;
  let colorDistribution = [];
  
  for (const [color, count] of colorMap.entries()) {
    const ratio = count / totalSamples;
    colorDistribution.push({ color, ratio });
    if (ratio > 0.05) { // 如果某个颜色占比超过5%
      dominantColors++;
    }
  }
  
  // 根据特征判断图像类型
  if (edgeDensity > 0.2 && colorCount < 100) {
    return ImageType.DIAGRAM; // 高边缘密度，有限颜色 -> 图表/图形
  }
  
  if (dominantColors < 10 && colorCount < 200) {
    return ImageType.DIAGRAM; // 少量主要颜色 -> 可能是图表
  }
  
  if (transparencyRatio > 0.1) {
    // 有大量透明像素，可能是图标或图表
    return colorCount < 100 ? ImageType.ICON : ImageType.DIAGRAM;
  }
  
  // 默认为照片
  return ImageType.PHOTO;
}

function checkAlphaChannel(imageData) {
  const data = imageData.data;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  return false;
}

function analyzeImage(imageData) {
  return { hasAlpha: checkAlphaChannel(imageData), isAnimated: false };
}

function calculateOptimalDimensions(originalWidth, originalHeight, maxWidth = 1920, maxHeight = 1080, imageType = ImageType.UNKNOWN) {
  // 对于不同类型的图像使用不同的缩放策略
  
  // 如果是图标，保持原始尺寸或适当缩小
  if (imageType === ImageType.ICON) {
    if (originalWidth <= 256 && originalHeight <= 256) {
      return { width: originalWidth, height: originalHeight };
    }
    // 对于大图标，缩小到合理尺寸
    const scale = Math.min(1, 256 / Math.max(originalWidth, originalHeight));
    return {
      width: Math.round(originalWidth * scale),
      height: Math.round(originalHeight * scale)
    };
  }
  
  // 对于图表/图形，保持较高分辨率以保证清晰度
  if (imageType === ImageType.DIAGRAM) {
    // 如果原始尺寸已经合理，保持不变
    if (originalWidth <= maxWidth && originalHeight <= maxHeight) {
      return { width: originalWidth, height: originalHeight };
    }
    
    // 计算缩放比例，但对图表使用较高的最大尺寸
    const diagramMaxWidth = Math.min(maxWidth * 1.2, 2400);
    const diagramMaxHeight = Math.min(maxHeight * 1.2, 1800);
    
    const widthRatio = diagramMaxWidth / originalWidth;
    const heightRatio = diagramMaxHeight / originalHeight;
    const ratio = Math.min(widthRatio, heightRatio);
    
    return {
      width: Math.round(originalWidth * ratio),
      height: Math.round(originalHeight * ratio)
    };
  }
  
  // 对于照片，使用标准缩放策略
  if (originalWidth <= maxWidth && originalHeight <= maxHeight) {
    return { width: originalWidth, height: originalHeight };
  }
  
  const widthRatio = maxWidth / originalWidth;
  const heightRatio = maxHeight / originalHeight;
  const ratio = Math.min(widthRatio, heightRatio);
  
  return {
    width: Math.round(originalWidth * ratio),
    height: Math.round(originalHeight * ratio)
  };
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


function createCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      return new OffscreenCanvas(width, height);
    } catch (e) {
      // fallback
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function blobToArrayBuffer(blob) {
  if (blob.stream) {
    // Stream API for large blobs
    const reader = blob.stream().getReader();
    const chunks = [];
    let done, value;
    while ({ done, value } = await reader.read(), !done) {
      chunks.push(value);
    }
    let length = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
    let result = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result.buffer;
  } else {
    return await blob.arrayBuffer();
  }
}

// Add or update the loadImage function at the top of the file
// 改进loadImage函数的错误处理
export function loadImage(data) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => {
      console.warn('Image loading failed:', e);
      reject(new Error('Failed to load image: ' + (e.message || 'Image format not supported')));
    };
    
    try {
      if (typeof data !== 'string') {
        // 尝试检测图像类型
        let mimeType = 'image/png';
        // 简单的图像类型检测
        if (data.length > 2) {
          const header = new Uint8Array(data.slice(0, 4));
          if (header[0] === 0xFF && header[1] === 0xD8) {
            mimeType = 'image/jpeg';
          } else if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47) {
            mimeType = 'image/png';
          } else if (header[0] === 0x47 && header[1] === 0x49 && header[2] === 0x46) {
            mimeType = 'image/gif';
          }
        }
        
        const blob = new Blob([data], { type: mimeType });
        img.src = URL.createObjectURL(blob);
      } else {
        img.src = data;
      }
    } catch (error) {
      console.error('Error creating image URL:', error);
      reject(new Error('Failed to process image data: ' + error.message));
    }
    
    // 添加超时处理
    const timeout = setTimeout(() => {
      reject(new Error('Image loading timed out'));
    }, 10000); // 10秒超时
    
    img.onload = () => {
      clearTimeout(timeout);
      resolve(img);
    };
  });
}

export async function compressImage(imageData, quality = 0.8, options = {}) {
  const { maxWidth = 1920, maxHeight = 1080, forceCompress = false } = options;
  
  try {
    // 检查数据有效性
    if (!imageData || imageData.length === 0) {
      console.warn('Invalid image data received for compression');
      return null;
    }
    
    // 检查是否为SVG
    if (isSVG(imageData)) {
      console.log('SVG detected, skipping compression');
      return { data: imageData, width: 0, height: 0, skipped: true };
    }
    
    // 使用改进的loadImage函数
    const img = await loadImage(imageData);
    
    // 创建临时canvas分析图像
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = img.width;
    tempCanvas.height = img.height;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(img, 0, 0);
    const imgData = tempCtx.getImageData(0, 0, img.width, img.height);
    
    // 分析图像类型和特性
    const imageType = analyzeImageType(imgData);
    const analysis = analyzeImage(imgData);
    
    // 根据图像类型调整质量
    let targetQuality = quality;
    // 对于照片类型的图像，可以适当降低质量但保持视觉效果
    if (imageType === ImageType.PHOTO) {
      targetQuality = Math.min(quality, 0.85);
    } else if (imageType === ImageType.DIAGRAM || imageType === ImageType.ICON) {
      // 对于图表和图标，保持较高质量以保证清晰度
      targetQuality = Math.min(quality, 0.9);
    }
    
    // 计算新尺寸
    const { width, height } = calculateOptimalDimensions(
      img.width, 
      img.height, 
      maxWidth, 
      maxHeight,
      imageType
    );
    
    // 如果图像已经很小且不需要调整大小，可以考虑跳过压缩
    if (width === img.width && height === img.height && imageData.byteLength < 50 * 1024 && !forceCompress) {
      return { data: imageData, width, height, skipped: true };
    }
    
    // 创建canvas并绘制图像
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    
    // 对于图表和图标，使用更适合的渲染设置
    if (imageType === ImageType.DIAGRAM || imageType === ImageType.ICON) {
      ctx.imageSmoothingQuality = 'high';
      // 对于线条清晰的图像，禁用抗锯齿可能会更好
      if (width < img.width / 2 || height < img.height / 2) {
        ctx.imageSmoothingEnabled = false;
      }
    } else {
      // 对于照片，使用默认的平滑设置
      ctx.imageSmoothingQuality = 'medium';
    }
    
    ctx.drawImage(img, 0, 0, width, height);
    
    // 尝试多种格式，选择最佳结果
    const blobs = [];
    
    // 尝试AVIF (更高压缩率的现代格式)
    try {
      blobs.push({
        type: 'avif',
        blob: await new Promise(resolve => canvas.toBlob(blob => resolve(blob), 'image/avif', targetQuality))
      });
    } catch (e) {
      console.warn('AVIF compression failed:', e);
    }
    
    // 尝试WebP (现代浏览器支持较好的格式)
    try {
      blobs.push({
        type: 'webp',
        blob: await new Promise(resolve => canvas.toBlob(blob => resolve(blob), 'image/webp', targetQuality))
      });
    } catch (e) {
      console.warn('WebP compression failed:', e);
    }
    
    // 如果没有透明通道，尝试JPEG
    if (!analysis.hasAlpha) {
      try {
        // 对于照片类型，JPEG通常效果很好
        const jpegQuality = imageType === ImageType.PHOTO ? targetQuality : Math.min(targetQuality + 0.1, 0.95);
        blobs.push({
          type: 'jpeg',
          blob: await new Promise(resolve => canvas.toBlob(blob => resolve(blob), 'image/jpeg', jpegQuality))
        });
      } catch (e) {
        console.warn('JPEG compression failed:', e);
      }
    }
    
    // 对于图表和图标，PNG可能更合适
    if (imageType === ImageType.DIAGRAM || imageType === ImageType.ICON) {
      try {
        blobs.push({
          type: 'png',
          blob: await new Promise(resolve => canvas.toBlob(blob => resolve(blob), 'image/png'))
        });
      } catch (e) {
        console.warn('PNG compression failed:', e);
      }
    }
    
    // 始终尝试PNG作为备选
    if (!blobs.some(b => b.type === 'png')) {
      try {
        blobs.push({
          type: 'png',
          blob: await new Promise(resolve => canvas.toBlob(blob => resolve(blob), 'image/png'))
        });
      } catch (e) {
        console.warn('PNG compression failed:', e);
      }
    }
    
    // 选择最小的blob
    let best = blobs[0];
    for (const candidate of blobs) {
      if (candidate && candidate.blob && candidate.blob.size < best.blob.size) {
        best = candidate;
      }
    }
    
    // 如果压缩后大小没有显著减少，使用原始数据
    if (best.blob.size > imageData.byteLength * 0.9 && !forceCompress) {
      console.log(`Compression not beneficial, keeping original (${imageData.byteLength} bytes)`);
      return { data: imageData, width: img.width, height: img.height, skipped: true };
    }
    
    // 转换为Uint8Array
    const compressedBuffer = await best.blob.arrayBuffer();
    const compressedData = new Uint8Array(compressedBuffer);
    
    console.log(`Compressed image: ${imageData.byteLength} -> ${compressedData.byteLength} bytes (${Math.round(compressedData.byteLength / imageData.byteLength * 100)}%), format: ${best.type}`);
    
    return {
      data: compressedData,
      width,
      height,
      format: best.type,
      originalSize: imageData.byteLength,
      compressedSize: compressedData.byteLength
    };
  } catch (error) {
    console.error('Error compressing image:', error);
    return { data: imageData, error: error.message };
  }
}

// 添加SVG检测函数
function isSVG(data) {
  // Check for SVG signature in the first few bytes
  if (data.length < 10) return false;
  
  // Convert first bytes to string to check for SVG signature
  try {
    const header = new TextDecoder().decode(data.slice(0, 100)).trim().toLowerCase();
    return header.includes('<svg') || header.includes('<?xml') && header.includes('<svg');
  } catch (e) {
    return false;
  }
}