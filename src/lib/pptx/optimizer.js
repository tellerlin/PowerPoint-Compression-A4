import JSZip from 'jszip';
import { findMediaFiles, processMediaFile } from './media';
import { compressImage } from '../utils/image';
import { validateFile } from '../utils/validation';
import { COMPRESSION_SETTINGS, SUPPORTED_IMAGE_EXTENSIONS } from './constants';
import { removeHiddenSlides } from './slides';

export async function optimizePPTX(file, options = {}) {
  try {
    validateFile(file);
    
    const { onProgress = () => {} } = options;
    
    const zip = await JSZip.loadAsync(file);
    
    if (options.removeHiddenSlides) {
      onProgress('init', { percentage: 75, status: 'Removing hidden slides...' });
      await removeHiddenSlides(zip);
    }
    
    const mediaFiles = findMediaFiles(zip);
    onProgress('mediaCount', { count: mediaFiles.length });
    
    let totalOriginalSize = 0;
    let totalCompressedSize = 0;
    
    for (let i = 0; i < mediaFiles.length; i++) {
      const mediaPath = mediaFiles[i];
      try {
        // 检查是否为图像文件
        const fileExtension = mediaPath.split('.').pop().toLowerCase();
        const isImage = SUPPORTED_IMAGE_EXTENSIONS.includes(fileExtension);
        
        await processMediaFile(zip, mediaPath, async (data) => {
          onProgress('media', {
            fileIndex: i + 1,
            fileName: mediaPath.split('/').pop(),
            totalFiles: mediaFiles.length
          });
          
          // 只压缩图像文件
          if (isImage) {
            totalOriginalSize += data.byteLength;
            
            // 使用适当的质量设置 - 降低小图像的质量提升阈值
            let adjustedQuality = options.compressImages?.quality || COMPRESSION_SETTINGS.DEFAULT_QUALITY;
            if (data.byteLength < 100 * 1024) { // 100KB以下的图像
              adjustedQuality = Math.min(0.92, adjustedQuality + 0.02); // 降低质量提升幅度
            }
            
            const result = await compressImage(data, adjustedQuality);
            
            // 检查压缩是否有效
            if (result.data.byteLength < data.byteLength) {
              totalCompressedSize += result.data.byteLength;
              return result.data;
            } else {
              // 如果压缩后更大，保留原始数据
              totalCompressedSize += data.byteLength;
              return data;
            }
          }
          
          // 非图像文件直接返回原始数据
          return data;
        });
      } catch (error) {
        // Continue with other files even if one fails
        console.warn(`Failed to process ${mediaPath}:`, error);
      }
    }
    
    const savedSize = totalOriginalSize - totalCompressedSize;
    const savedPercentage = totalOriginalSize > 0 ? (savedSize / totalOriginalSize * 100).toFixed(1) : 0;
    
    onProgress('finalize', { 
      status: `Rebuilding presentation... Saved ${(savedSize / (1024 * 1024)).toFixed(2)}MB (${savedPercentage}%)`
    });
    
    return await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { 
        level: COMPRESSION_SETTINGS.ZIP_COMPRESSION_LEVEL 
      }
    });
    
  } catch (error) {
    console.error('Optimization failed:', error);
    throw error;
  }
}