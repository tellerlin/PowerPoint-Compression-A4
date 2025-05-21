// Shared image compression utility functions
import { checkAlphaChannel, getFFmpegInstance } from './image';

// 添加 hashCode 函数
export function hashCode(data) {
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data[i];
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(16);
}

export const ImageType = {
  PHOTO: 'photo',
  DIAGRAM: 'diagram',
  ICON: 'icon',
  UNKNOWN: 'unknown'
};

export function analyzeImageType(imageData) {
  const { width, height, data } = imageData;
  if (width < 128 && height < 128) {
    return ImageType.ICON;
  }
  let colorCount = 0;
  const colorMap = new Map();
  const sampleStep = Math.max(1, Math.floor((data.length / 4) / 1000));
  for (let i = 0; i < data.length; i += sampleStep * 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const colorKey = `${r},${g},${b}`;
    if (!colorMap.has(colorKey)) {
      colorMap.set(colorKey, 1);
      colorCount++;
      if (colorCount > 50) break;
    }
  }
  if (colorCount < 50) {
    return ImageType.DIAGRAM;
  }
  return ImageType.PHOTO;
}

export function analyzeImage(imageData) {
  const type = analyzeImageType(imageData);
  const { width, height } = imageData;
  const aspectRatio = width / height;
  
  return {
    type,
    width,
    height,
    aspectRatio,
    isLandscape: aspectRatio > 1,
    isPortrait: aspectRatio < 1,
    isSquare: Math.abs(aspectRatio - 1) < 0.1,
    isSmall: width < 128 && height < 128,
    isLarge: width > 1920 || height > 1920
  };
}

export function calculateOptimalDimensions(originalWidth, originalHeight, maxSize = 1920) {
  if (originalWidth <= maxSize && originalHeight <= maxSize) {
    return { width: originalWidth, height: originalHeight };
  }
  
  // 优化：使用一次性计算而不是多次条件判断
  const aspectRatio = originalWidth / originalHeight;
  let targetWidth, targetHeight;
  
  if (originalWidth > originalHeight) {
    targetWidth = Math.min(maxSize, originalWidth);
    targetHeight = Math.round(targetWidth / aspectRatio);
  } else {
    targetHeight = Math.min(maxSize, originalHeight);
    targetWidth = Math.round(targetHeight * aspectRatio);
  }
  
  // 确保两个维度都不超过maxSize
  if (targetWidth > maxSize) {
    targetWidth = maxSize;
    targetHeight = Math.round(targetWidth / aspectRatio);
  }
  
  // 避免放大小图像
  return {
    width: Math.min(targetWidth, originalWidth),
    height: Math.min(targetHeight, originalHeight)
  };
}

export function getExtensionFromPath(path) {
  if (!path) return '';
  const parts = path.split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : '';
}

export async function detectFormat(data) {
  if (!data || data.length < 4) {
    console.warn('[detectFormat] Invalid image data');
    return 'unknown';
  }

  // 检查文件头
  const header = new Uint8Array(data.slice(0, 16));
  const headerHex = Array.from(header).map(b => b.toString(16).padStart(2, '0')).join('');

  // 扩展支持的格式列表，针对 PowerPoint 中常见的格式
  const formatSignatures = {
    // 常见格式
    '89504E47': 'png',  // PNG
    'FFD8FF': 'jpeg',   // JPEG
    '47494638': 'gif',  // GIF
    '52494646': 'webp', // WebP
    '424D': 'bmp',      // BMP
    
    // TIFF 格式 (支持多种变体)
    '49492A00': 'tiff', // Intel TIFF
    '4D4D002A': 'tiff', // Motorola TIFF
    
    // 其他 FFmpeg 支持的格式
    '00000100': 'tga',  // TGA
    '00000200': 'tga',  // TGA
    '00000300': 'tga',  // TGA
    '00000A00': 'tga',  // TGA
    '00000A02': 'tga',  // TGA
    
    // ICO/CUR 格式
    '00000100': 'ico',  // ICO
    '00000200': 'ico',  // ICO
    
    // PCX 格式
    '0A0501': 'pcx',    // PCX
    
    // PPM 格式
    '5033': 'ppm',      // PPM
    '5036': 'ppm',      // PPM
    
    // PGM 格式
    '5032': 'pgm',      // PGM
    '5035': 'pgm',      // PGM
    
    // PBM 格式
    '5031': 'pbm',      // PBM
    '5034': 'pbm',      // PBM
    
    // SGI 格式
    '01DA': 'sgi',      // SGI
    
    // Sun Raster 格式
    '59A66A95': 'sun',  // Sun Raster
  };

  // 检查所有可能的格式签名
  for (const [signature, format] of Object.entries(formatSignatures)) {
    if (headerHex.startsWith(signature)) {
      console.log(`[detectFormat] Detected format ${format} from signature`);
      return format;
    }
  }

  // 如果文件有路径，尝试从扩展名获取格式（优先于其他方法）
  if (data.path) {
    const extension = getExtensionFromPath(data.path);
    if (extension && ['png', 'jpeg', 'jpg', 'gif', 'bmp', 'webp', 'tiff', 'tga', 'pcx', 'ppm', 'pgm', 'pbm', 'sgi', 'sun'].includes(extension)) {
      console.log(`[detectFormat] Detected format ${extension} from file extension`);
      return extension === 'jpg' ? 'jpeg' : extension;
    }
  }

  // 尝试使用 MIME 类型
  try {
    const blob = new Blob([data]);
    const mimeType = blob.type;
    if (mimeType) {
      const format = mimeType.split('/')[1];
      if (format && ['png', 'jpeg', 'jpg', 'gif', 'bmp', 'webp', 'tiff', 'tga', 'pcx', 'ppm', 'pgm', 'pbm', 'sgi', 'sun'].includes(format)) {
        console.log(`[detectFormat] Detected format ${format} from MIME type`);
        return format === 'jpg' ? 'jpeg' : format;
      }
    }
  } catch (error) {
    console.warn('[detectFormat] Failed to detect format from MIME type:', error);
  }

  // 尝试使用 FFmpeg 检测
  try {
    const ffmpeg = await getFFmpegInstance();
    const inputFileName = `input_${Math.random().toString(36).substring(2, 15)}.bin`;
    ffmpeg.FS('writeFile', inputFileName, data);
    
    try {
      await ffmpeg.run('-i', inputFileName, '-f', 'null', '-');
      const probeData = ffmpeg.FS('readFile', inputFileName);
      const format = probeData.toString().match(/Input #0, ([^,]+)/)?.[1];
      if (format) {
        const detectedFormat = format.toLowerCase();
        console.log(`[detectFormat] Detected format ${detectedFormat} from FFmpeg`);
        return detectedFormat;
      }
    } catch (error) {
      console.warn('[detectFormat] FFmpeg format detection failed:', error);
    } finally {
      ffmpeg.FS('unlink', inputFileName);
    }
  } catch (error) {
    console.warn('[detectFormat] FFmpeg instance creation failed:', error);
  }

  // 如果所有方法都失败，尝试使用 Canvas API
  try {
    const blob = new Blob([data]);
    const img = new Image();
    const canvas = new OffscreenCanvas(1, 1);
    const ctx = canvas.getContext('2d');
    
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = URL.createObjectURL(blob);
    });
    
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(img.src);
    
    // 根据图片数据特征判断格式
    const imageData = ctx.getImageData(0, 0, 1, 1);
    const hasAlpha = imageData.data[3] < 255;
    
    // 根据数据特征和大小推测格式
    if (data.length > 1000000) { // 大于1MB
      return hasAlpha ? 'png' : 'jpeg';
    } else if (data.length > 100000) { // 大于100KB
      return hasAlpha ? 'png' : 'jpeg';
    } else {
      return hasAlpha ? 'png' : 'jpeg';
    }
  } catch (error) {
    console.warn('[detectFormat] Canvas detection failed:', error);
  }

  // 如果仍然无法识别格式，返回 'unknown'
  console.warn('[detectFormat] Unable to detect image format');
  return 'unknown';
}

// 添加批量处理透明PNG的配置
const TRANSPARENT_PNG_CONFIG = {
  BATCH_SIZE: 5,
  COMPRESSION_THRESHOLD: 0.9,
  MAX_SIZE_MB: 1,
  INITIAL_QUALITY: 0.9
};

// 添加图片增强配置
const ENHANCE_CONFIG = {
  SMALL_IMAGE: {
    maxPixels: 250000, // 500x500
    filter: 'unsharp=3:3:0.4:3:3:0.4,eq=contrast=1.02:brightness=0.005'
  },
  MEDIUM_IMAGE: {
    maxPixels: 500000, // 707x707
    filter: 'unsharp=3:3:0.5:3:3:0.5,eq=contrast=1.03:brightness=0.008:saturation=1.03'
  },
  LARGE_IMAGE: {
    maxPixels: Infinity,
    filter: 'unsharp=3:3:0.6:3:3:0.6,eq=contrast=1.04:brightness=0.01:saturation=1.04'
  }
};

// 添加压缩配置
const COMPRESSION_CONFIG = {
  JPEG: {
    QUALITY_THRESHOLD: 0.85,
    MIN_QUALITY: 0.6,
    MAX_QUALITY: 0.95,
    SIZE_THRESHOLDS: {
      SMALL: 100 * 1024,    // 100KB
      MEDIUM: 500 * 1024,   // 500KB
      LARGE: 1024 * 1024    // 1MB
    }
  },
  PNG: {
    COMPRESSION_LEVEL: 9,
    STRATEGY: 'mixed',
    FILTER: 'adaptive'
  },
  WEBP: {
    QUALITY_THRESHOLD: 0.8,
    MIN_QUALITY: 0.5,
    MAX_QUALITY: 0.9,
    METHOD: 4
  }
};

// 优化预处理函数
async function preprocessImage(data, maxWidth = 1600, maxHeight = 900) {
  try {
    const format = await detectFormat(data);
    if (!['png', 'jpeg', 'jpg', 'webp'].includes(format)) {
      console.log(`[preprocessImage] Skipping preprocessing for unsupported format: ${format}`);
      return { data, format, dimensions: { width: 0, height: 0 } };
    }

    // 使用 ImageBitmap 进行更高效的解码
    const blob = new Blob([data], { type: `image/${format}` });
    const bitmap = await createImageBitmap(blob);
    const { width, height } = bitmap;

    // 如果图片尺寸已经小于目标尺寸，直接返回
    if (width <= maxWidth && height <= maxHeight) {
      console.log(`[preprocessImage] Image size ${width}x${height} is within limits`);
      bitmap.close();
      return { 
        data, 
        format, 
        dimensions: { width, height },
        preprocessed: false
      };
    }

    // 计算等比例缩放后的尺寸
    const scale = Math.min(maxWidth / width, maxHeight / height);
    const targetWidth = Math.round(width * scale);
    const targetHeight = Math.round(height * scale);

    console.log(`[preprocessImage] Resizing from ${width}x${height} to ${targetWidth}x${targetHeight}`);

    // 使用 OffscreenCanvas 进行高效的缩放
    const canvas = new OffscreenCanvas(targetWidth, targetHeight);
    const ctx = canvas.getContext('2d', { alpha: format === 'png' });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
    bitmap.close();

    // 导出为原始格式
    const blobOut = await canvas.convertToBlob({ 
      type: `image/${format}`,
      quality: format === 'png' ? 1 : 0.9
    });
    const processedData = new Uint8Array(await blobOut.arrayBuffer());

    return {
      data: processedData,
      format,
      dimensions: { width: targetWidth, height: targetHeight },
      preprocessed: true,
      originalDimensions: { width, height }
    };
  } catch (error) {
    console.warn('[preprocessImage] Error:', error);
    return { data, format: 'unknown', dimensions: { width: 0, height: 0 }, preprocessed: false };
  }
}

// 优化图片增强函数
async function enhanceImage(data, format, dimensions) {
  try {
    const totalPixels = dimensions.width * dimensions.height;
    let filterComplex;

    // 根据图片尺寸选择合适的滤镜
    if (totalPixels <= ENHANCE_CONFIG.SMALL_IMAGE.maxPixels) {
      filterComplex = ENHANCE_CONFIG.SMALL_IMAGE.filter;
    } else if (totalPixels <= ENHANCE_CONFIG.MEDIUM_IMAGE.maxPixels) {
      filterComplex = ENHANCE_CONFIG.MEDIUM_IMAGE.filter;
    } else {
      filterComplex = ENHANCE_CONFIG.LARGE_IMAGE.filter;
    }

    console.log(`[enhanceImage] Processing image ${dimensions.width}x${dimensions.height}`);
    console.log(`[enhanceImage] Using filter: ${filterComplex}`);

    const ffmpeg = await getFFmpegInstance();
    const inputFileName = `input_${Math.random().toString(36).substring(2, 15)}.${format}`;
    const outputFileName = `output_${Math.random().toString(36).substring(2, 15)}.${format}`;

    ffmpeg.FS('writeFile', inputFileName, data);

    const args = [
      '-i', inputFileName,
      '-vf', filterComplex,
      '-c:v', format === 'webp' ? 'libwebp' : format === 'png' ? 'png' : 'mjpeg',
      '-y',
      outputFileName
    ];

    try {
      await ffmpeg.run(...args);
    } catch (error) {
      if (error.message.includes('OOM') || error.message.includes('Out of memory')) {
        console.warn('[enhanceImage] Memory overflow, skipping enhancement');
        return data;
      }
      throw error;
    }

    const outputData = ffmpeg.FS('readFile', outputFileName);
    ffmpeg.FS('unlink', inputFileName);
    ffmpeg.FS('unlink', outputFileName);

    if (!outputData || outputData.length === 0) {
      console.warn('[enhanceImage] Empty output file');
      return data;
    }

    return new Uint8Array(outputData.buffer);
  } catch (error) {
    console.warn('[enhanceImage] Error:', error);
    return data;
  }
}

// 优化批量处理透明PNG的函数
async function processTransparentPNGs() {
  if (transparentPNGs.size === 0) return [];
  
  console.log(`[processTransparentPNGs] Processing ${transparentPNGs.size} transparent PNGs`);
  
  const results = await Promise.all(
    Array.from(transparentPNGs.entries()).map(async ([key, { data, dimensions }]) => {
      try {
        const blob = new Blob([data], { type: 'image/png' });
        
        // 验证尺寸
        if (!dimensions || !dimensions.width || !dimensions.height || 
            dimensions.width <= 0 || dimensions.height <= 0) {
          console.warn(`[processTransparentPNGs] Invalid dimensions for ${key}`);
          return {
            key,
            data,
            originalSize: data.length,
            compressedSize: data.length,
            dimensions: dimensions || { width: 0, height: 0 }
          };
        }

        // 设置压缩选项
        const options = {
          maxSizeMB: TRANSPARENT_PNG_CONFIG.MAX_SIZE_MB,
          maxWidthOrHeight: Math.max(dimensions.width, dimensions.height),
          useWebWorker: true,
          fileType: 'image/png',
          preserveHeaders: true,
          initialQuality: TRANSPARENT_PNG_CONFIG.INITIAL_QUALITY,
          alwaysKeepResolution: true
        };

        // 使用 browser-image-compression 压缩
        const compressedBlob = await imageCompression(blob, options);
        const compressedData = new Uint8Array(await compressedBlob.arrayBuffer());
        
        // 检查压缩效果
        const compressionRatio = compressedData.length / data.length;
        console.log(`[processTransparentPNGs] ${key}: ${data.length} -> ${compressedData.length} bytes (${compressionRatio.toFixed(2)})`);
        
        // 如果压缩效果显著，则使用压缩后的数据
        if (compressionRatio < TRANSPARENT_PNG_CONFIG.COMPRESSION_THRESHOLD) {
          return {
            key,
            data: compressedData,
            originalSize: data.length,
            compressedSize: compressedData.length,
            dimensions
          };
        }
        
        return {
          key,
          data,
          originalSize: data.length,
          compressedSize: data.length,
          dimensions
        };
      } catch (error) {
        console.warn(`[processTransparentPNGs] Failed to process ${key}:`, error);
        return {
          key,
          data,
          originalSize: data.length,
          compressedSize: data.length,
          dimensions: dimensions || { width: 0, height: 0 }
        };
      }
    })
  );
  
  transparentPNGs.clear();
  return results;
}

// 优化压缩函数
async function compressImageWithFFmpeg(data, quality, format) {
  let inputFileName = null;
  let outputFileName = null;
  
  try {
    const ffmpeg = await getFFmpegInstance();
    inputFileName = `input_${Math.random().toString(36).substring(2, 15)}.${format}`;
    outputFileName = `output_${Math.random().toString(36).substring(2, 15)}.${format}`;

    ffmpeg.FS('writeFile', inputFileName, data);
    
    // 根据文件大小和格式调整压缩参数
    const fileSize = data.length;
    let args = ['-i', inputFileName];
    
    switch (format) {
      case 'jpeg':
      case 'jpg':
        // 根据文件大小动态调整质量
        let jpegQuality = quality;
        if (fileSize > COMPRESSION_CONFIG.JPEG.SIZE_THRESHOLDS.LARGE) {
          jpegQuality = Math.max(COMPRESSION_CONFIG.JPEG.MIN_QUALITY, quality * 0.8);
        } else if (fileSize > COMPRESSION_CONFIG.JPEG.SIZE_THRESHOLDS.MEDIUM) {
          jpegQuality = Math.max(COMPRESSION_CONFIG.JPEG.MIN_QUALITY, quality * 0.9);
        }
        
        args.push(
          '-c:v', 'mjpeg',
          '-q:v', jpegQuality.toString(),
          '-threads', '1',
          '-color_range', 'jpeg',
          '-colorspace', 'bt709'
        );
        break;
        
      case 'png':
        args.push(
          '-c:v', 'png',
          '-compression_level', COMPRESSION_CONFIG.PNG.COMPRESSION_LEVEL.toString(),
          '-threads', '1',
          '-pred', COMPRESSION_CONFIG.PNG.STRATEGY,
          '-vf', `format=rgb24,scale=trunc(iw/2)*2:trunc(ih/2)*2`
        );
        break;
        
      case 'webp':
        // 根据文件大小动态调整质量
        let webpQuality = quality;
        if (fileSize > COMPRESSION_CONFIG.WEBP.SIZE_THRESHOLDS.LARGE) {
          webpQuality = Math.max(COMPRESSION_CONFIG.WEBP.MIN_QUALITY, quality * 0.8);
        } else if (fileSize > COMPRESSION_CONFIG.WEBP.SIZE_THRESHOLDS.MEDIUM) {
          webpQuality = Math.max(COMPRESSION_CONFIG.WEBP.MIN_QUALITY, quality * 0.9);
        }
        
        args.push(
          '-c:v', 'libwebp',
          '-quality', webpQuality.toString(),
          '-lossless', '0',
          '-method', COMPRESSION_CONFIG.WEBP.METHOD.toString(),
          '-threads', '1',
          '-pix_fmt', 'yuv420p',
          '-color_range', 'jpeg',
          '-colorspace', 'bt709'
        );
        break;
        
      default:
        // 默认使用PNG压缩参数
        args.push(
          '-c:v', 'png',
          '-compression_level', '9',
          '-threads', '1'
        );
    }
    
    args.push('-y', outputFileName);
    
    try {
      await ffmpeg.run(...args);
    } catch (error) {
      if (error.message.includes('OOM') || error.message.includes('Out of memory')) {
        console.warn('[compressImageWithFFmpeg] Memory overflow, using original data');
        return data;
      }
      throw error;
    }
    
    const outputData = ffmpeg.FS('readFile', outputFileName);
    ffmpeg.FS('unlink', inputFileName);
    ffmpeg.FS('unlink', outputFileName);
    
    if (!outputData || outputData.length === 0) {
      console.warn('[compressImageWithFFmpeg] Empty output file');
      return data;
    }
    
    // 检查压缩效果
    const compressionRatio = outputData.length / data.length;
    if (compressionRatio >= 0.95) {
      console.warn(`[compressImageWithFFmpeg] Poor compression ratio: ${compressionRatio.toFixed(2)}`);
      
      // 如果压缩效果不理想，尝试使用更激进的压缩
      if (format === 'jpeg' || format === 'jpg') {
        const aggressiveQuality = Math.max(COMPRESSION_CONFIG.JPEG.MIN_QUALITY, quality * 0.7);
        if (aggressiveQuality < quality) {
          console.log(`[compressImageWithFFmpeg] Retrying with aggressive quality: ${aggressiveQuality}`);
          return compressImageWithFFmpeg(data, aggressiveQuality, format);
        }
      }
    }
    
    return new Uint8Array(outputData.buffer);
  } catch (error) {
    console.error('[compressImageWithFFmpeg] Error:', error);
    return data;
  }
}

// 修改 processImage 函数
export async function processImage(data, quality, originalFormat) {
  if (!(data instanceof Uint8Array)) {
    throw new TypeError('processImage: data must be a Uint8Array');
  }

  // 1. 预处理阶段
  console.log('[processImage] Starting preprocessing...');
  const preprocessResult = await preprocessImage(data);
  const { data: preprocessedData, format, dimensions, preprocessed, originalDimensions } = preprocessResult;
  
  if (preprocessed) {
    console.log(`[processImage] Image preprocessed from ${originalDimensions.width}x${originalDimensions.height} to ${dimensions.width}x${dimensions.height}`);
  }

  // 2. 分析阶段
  console.log('[processImage] Starting image analysis...');
  let imageType = ImageType.UNKNOWN;
  let hasAlpha = false;
  
  try {
    const blob = new Blob([preprocessedData], { type: `image/${format}` });
    const img = new Image();
    
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = URL.createObjectURL(blob);
    });

    const canvas = new OffscreenCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(img.src);

    const imageData = ctx.getImageData(0, 0, img.width, img.height);
    imageType = analyzeImageType(imageData);
    hasAlpha = await checkAlphaChannel(preprocessedData);
  } catch (error) {
    console.warn('[processImage] Analysis failed:', error);
  }

  // 3. 压缩阶段
  console.log('[processImage] Starting compression...');
  let compressedData = preprocessedData;
  let outputFormat = format;
  let method = preprocessed ? 'preprocessed' : 'original';

  try {
    // 根据图片类型和特征选择最佳压缩方法
    if (format === 'png' && !hasAlpha) {
      // 无透明度的PNG可以转换为其他格式
      const results = [];
      
      try {
        const webpBlob = await canvas.convertToBlob({ type: 'image/webp', quality });
        results.push({ type: 'webp', blob: webpBlob });
      } catch (error) {
        console.warn('[processImage] WebP conversion failed:', error);
      }

      try {
        const jpegBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
        results.push({ type: 'jpeg', blob: jpegBlob });
      } catch (error) {
        console.warn('[processImage] JPEG conversion failed:', error);
      }

      if (results.length > 0) {
        const bestResult = results.reduce((a, b) => (a.blob.size < b.blob.size ? a : b));
        compressedData = new Uint8Array(await bestResult.blob.arrayBuffer());
        outputFormat = bestResult.type;
        method = `converted-${bestResult.type}`;
      }
    } else {
      // 使用原始格式压缩
      const adjustedQuality = await adjustQualityByContent(preprocessedData, format, quality);
      compressedData = await compressImageWithFFmpeg(preprocessedData, adjustedQuality, format);
      method = 'ffmpeg';
    }
  } catch (error) {
    console.warn('[processImage] Compression failed:', error);
  }

  // 4. 结果处理
  const result = {
    data: compressedData,
    format: outputFormat,
    compressionMethod: method,
    originalSize: data.byteLength,
    compressedSize: compressedData.byteLength,
    originalDimensions: originalDimensions || dimensions,
    finalDimensions: dimensions,
    imageType,
    hasAlpha,
    preprocessed
  };

  console.log(`[processImage] Processing complete: ${result.originalSize} -> ${result.compressedSize} bytes`);
  return result;
}