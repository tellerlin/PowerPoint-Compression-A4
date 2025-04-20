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

/**
 * 分析图像特征以确定最佳压缩策略
 * @param {Uint8Array} data 图像数据
 * @param {string} fileExt 文件扩展名
 * @returns {Object} 图像分析结果
 */
export async function analyzeImage(data, fileExt) {
  try {
    const img = await loadImage(data);
    
    // 创建canvas以分析图像
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    
    // 分析透明度
    let isTransparent = false;
    if (fileExt === 'png' || fileExt === 'webp' || fileExt === 'gif') {
      // 采样检查透明度
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const pixels = imageData.data;
      const sampleSize = Math.min(10000, pixels.length / 4); // 最多检查10000个像素
      const step = Math.max(1, Math.floor(pixels.length / 4 / sampleSize));
      
      for (let i = 3; i < pixels.length; i += 4 * step) {
        if (pixels[i] < 255) {
          isTransparent = true;
          break;
        }
      }
    }
    
    // 分析颜色数量
    let colorCount = 0;
    const colorMap = new Map();
    // 采样分析颜色
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = imageData.data;
    const sampleSize = Math.min(10000, pixels.length / 4);
    const step = Math.max(1, Math.floor(pixels.length / 4 / sampleSize));
    
    for (let i = 0; i < pixels.length; i += 4 * step) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const a = pixels[i + 3];
      
      // 忽略完全透明的像素
      if (a === 0) continue;
      
      // 使用颜色值作为键
      const colorKey = `${r},${g},${b},${a}`;
      if (!colorMap.has(colorKey)) {
        colorMap.set(colorKey, 1);
        colorCount++;
        
        // 如果颜色数量超过阈值，可以提前结束
        if (colorCount > 256) break;
      }
    }
    
    // 判断是否为照片
    // 照片通常有大量颜色变化和渐变
    const isPhoto = colorCount > 256 && (fileExt === 'jpg' || fileExt === 'jpeg' || colorCount > 1000);
    
    // 清理资源
    URL.revokeObjectURL(img.src);
    
    return {
      width: img.width,
      height: img.height,
      isTransparent,
      colorCount,
      isPhoto,
      // 添加更多可能有用的特征
      aspectRatio: img.width / img.height,
      isLarge: img.width > 1000 || img.height > 1000,
      isProbablyDiagram: colorCount < 100 && !isPhoto
    };
  } catch (error) {
    console.error('Error analyzing image:', error);
    // 返回默认分析结果
    return {
      isTransparent: false,
      colorCount: 1000,
      isPhoto: fileExt === 'jpg' || fileExt === 'jpeg',
      width: 0,
      height: 0
    };
  }
}

// 增强compressImage函数以支持多格式压缩和索引色PNG
// 修复compressImage函数，确保返回与原始格式兼容的数据
export async function compressImage(data, quality = 0.8, options = {}) {
  try {
    const img = await loadImage(data);
    
    // 计算新的尺寸
    let width = img.width;
    let height = img.height;
    
    const maxWidth = options.maxWidth || null;
    const maxHeight = options.maxHeight || null;
    
    if (maxWidth && width > maxWidth) {
      height = Math.round(height * (maxWidth / width));
      width = maxWidth;
    }
    
    if (maxHeight && height > maxHeight) {
      width = Math.round(width * (maxHeight / height));
      height = maxHeight;
    }
    
    // 创建canvas并绘制图像
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);
    
    // 准备存储不同格式的结果
    const results = [];
    
    // 获取原始文件格式
    const fileExt = options.fileType || 'png';
    const isTransparent = options.preserveTransparency || false;
    
    // 始终尝试原始格式，确保兼容性
    try {
      let originalFormatMime;
      switch(fileExt.toLowerCase()) {
        case 'jpg':
        case 'jpeg':
          originalFormatMime = 'image/jpeg';
          break;
        case 'png':
          originalFormatMime = 'image/png';
          break;
        case 'gif':
          originalFormatMime = 'image/gif';
          break;
        case 'webp':
          originalFormatMime = 'image/webp';
          break;
        default:
          originalFormatMime = 'image/png';
      }
      
      const originalFormatBlob = await new Promise(resolve => {
        canvas.toBlob(blob => resolve(blob), originalFormatMime, quality);
      });
      
      if (originalFormatBlob) {
        results.push({
          format: fileExt,
          data: new Uint8Array(await originalFormatBlob.arrayBuffer()),
          size: originalFormatBlob.size
        });
      }
    } catch (e) {
      console.warn(`Original format (${fileExt}) compression failed:`, e);
    }
    
    // 尝试WebP格式（如果浏览器支持且选项允许）
    if (options.tryWebp !== false) {
      try {
        const webpBlob = await new Promise(resolve => {
          canvas.toBlob(blob => resolve(blob), 'image/webp', quality);
        });
        
        if (webpBlob) {
          // 只有当WebP比原始格式小很多时才使用它
          // 这里设置一个阈值，例如至少小20%
          const originalResult = results.find(r => r.format === fileExt);
          if (!originalResult || webpBlob.size < originalResult.size * 0.8) {
            results.push({
              format: 'webp',
              data: new Uint8Array(await webpBlob.arrayBuffer()),
              size: webpBlob.size
            });
          }
        }
      } catch (e) {
        console.warn('WebP compression failed:', e);
      }
    }
    
    // 尝试JPEG格式（如果图像没有透明度且选项允许）
    if (!isTransparent && fileExt !== 'jpeg' && fileExt !== 'jpg') {
      try {
        const jpegBlob = await new Promise(resolve => {
          canvas.toBlob(blob => resolve(blob), 'image/jpeg', quality);
        });
        
        if (jpegBlob) {
          // 只有当JPEG比原始格式小很多时才使用它
          const originalResult = results.find(r => r.format === fileExt);
          if (!originalResult || jpegBlob.size < originalResult.size * 0.8) {
            results.push({
              format: 'jpeg',
              data: new Uint8Array(await jpegBlob.arrayBuffer()),
              size: jpegBlob.size
            });
          }
        }
      } catch (e) {
        console.warn('JPEG compression failed:', e);
      }
    }
    
    // 清理资源
    URL.revokeObjectURL(img.src);
    
    // 如果没有成功压缩任何格式，返回原始数据
    if (results.length === 0) {
      return {
        data,
        skipped: true,
        format: fileExt
      };
    }
    
    // 选择最小的格式
    results.sort((a, b) => a.size - b.size);
    const bestResult = results[0];
    
    // 如果最佳结果比原始数据大，且不强制压缩，则跳过
    if (bestResult.size >= data.byteLength && !options.forceCompress) {
      return {
        data,
        skipped: true,
        format: fileExt
      };
    }
    
    console.log(`Compressed image: ${data.byteLength} -> ${bestResult.size} bytes (${Math.round((1 - bestResult.size / data.byteLength) * 100)}%), format: ${bestResult.format}`);
    
    // 重要：始终保持原始格式，避免引用问题
    return {
      data: bestResult.data,
      skipped: false,
      format: fileExt // 返回原始格式，而不是bestResult.format
    };
  } catch (error) {
    console.error('Error compressing image:', error);
    // 出错时返回原始数据
    return {
      data,
      skipped: true,
      error: error.message,
      format: options.fileType
    };
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