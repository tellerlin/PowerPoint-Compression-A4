import JSZip from 'jszip';
import { findMediaFiles, processMediaFile } from './media';
import { compressImage } from '../utils/image';
import { validateFile } from '../utils/validation';
import { COMPRESSION_SETTINGS } from './constants';
import { removeHiddenSlides } from './slides/index.js';
import PQueue from 'p-queue';

export async function optimizePPTX(file, options = {}) {
  try {
    // Step 1: Validate input file
    validateFile(file);
    
    const { onProgress = () => {} } = options;
    
    // Step 2: Load the PPTX file
    onProgress('init', { percentage: 0, status: '加载 PPTX 文件...' });
    const zip = await JSZip.loadAsync(file);
    onProgress('init', { percentage: 50, status: '分析文件结构...' });
    
    // Step 3: Remove hidden slides first
    if (options.removeHiddenSlides) {
      onProgress('init', { percentage: 75, status: '移除隐藏幻灯片...' });
      await removeHiddenSlides(zip);
    }
    
    // Step 4: Find all media files
    onProgress('init', { percentage: 90, status: '扫描媒体文件...' });
    const mediaFiles = findMediaFiles(zip);
    onProgress('mediaCount', { count: mediaFiles.length });
    onProgress('init', { percentage: 100, status: `找到 ${mediaFiles.length} 个媒体文件` });
    
    // Step 5: Process each media file with concurrency
    const concurrency = options.concurrency || 5;
    const queue = new PQueue({ concurrency });

    mediaFiles.forEach((mediaPath, i) => {
      queue.add(async () => {
        try {
          onProgress('media', {
            fileIndex: i + 1,
            fileName: mediaPath.split('/').pop(),
            totalFiles: mediaFiles.length
          });
          // Step 6: Compress each image
          const originalData = await zip.files[mediaPath].async('arraybuffer');
          const result = await compressImage(new Uint8Array(originalData), options.compressImages?.quality);
          zip.file(mediaPath, result.data, { binary: true });
        } catch (error) {
          console.warn(`处理 ${mediaPath} 失败:`, error);
          // Continue with other files even if one fails
        }
      });
    });

    await queue.onIdle();

    // Step 7: Generate final compressed file
    onProgress('finalize', { status: '重建演示文稿...' });
    return await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { 
        level: COMPRESSION_SETTINGS.ZIP_COMPRESSION_LEVEL 
      }
    });
    
  } catch (error) {
    console.error('优化失败:', error);
    throw error;
  }
}