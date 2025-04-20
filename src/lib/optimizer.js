// ... existing code ...

async function compressNext(mediaFiles, index, quality, memFS, progressCallback) {
  if (index >= mediaFiles.length) {
    return { compressedCount: 0, skippedCount: 0, failedCount: 0 };
  }
  
  const stats = await compressNext(mediaFiles, index + 1, quality, memFS, progressCallback);
  const file = mediaFiles[index];
  
  try {
    // 只处理图片文件
    if (!/\.(png|jpg|jpeg|gif)$/i.test(file)) {
      stats.skippedCount++;
      return stats;
    }
    
    const fileData = memFS.getFile(file);
    if (!fileData) {
      stats.skippedCount++;
      return stats;
    }
    
    // 使用修复后的compressImage函数
    const compressedBlob = await compressImage(fileData, quality);
    const compressedData = await compressedBlob.arrayBuffer();
    
    // 只有当压缩后的文件更小时才替换
    if (compressedData.byteLength < fileData.byteLength) {
      memFS.updateFile(file, new Uint8Array(compressedData));
      stats.compressedCount++;
      console.log(`Compressed ${file}: ${fileData.byteLength} -> ${compressedData.byteLength} bytes`);
    } else {
      stats.skippedCount++;
      console.log(`Skipped ${file}: compression would not reduce size`);
    }
  } catch (error) {
    console.error(`Error compressing ${file}:`, error);
    stats.failedCount++;
  }
  
  // 更新进度
  if (progressCallback) {
    progressCallback({
      fileIndex: index + 1,
      totalFiles: mediaFiles.length,
      compressedCount: stats.compressedCount,
      skippedCount: stats.skippedCount,
      failedCount: stats.failedCount
    });
  }
  
  return stats;
}

// ... existing code ...

async function optimizePPTX(pptxData, options = {}) {
  const defaultOptions = {
    cleanUnusedLayouts: true,
    cleanUnusedMedia: true,
    compressImages: true,
    imageQuality: 0.8,
    maxImageWidth: null,
    maxImageHeight: null
  };
  
  const opts = { ...defaultOptions, ...options };
  
  // ... existing code ...
  
  // 图片压缩
  if (opts.compressImages) {
    console.log('Starting image compression...');
    const mediaFiles = memFS.findFiles(/^ppt\/media\/.+\.(png|jpg|jpeg|gif)$/i);
    console.log(`Found ${mediaFiles.length} media files for potential compression.`);
    
    try {
      const compressionStats = await compressNext(mediaFiles, 0, opts.imageQuality, memFS, 
        (progress) => updateProgress('media', progress));
      
      console.log(`Image compression finished. Compressed ${compressionStats.compressedCount} files, skipped ${compressionStats.skippedCount}, failed ${compressionStats.failedCount}.`);
    } catch (error) {
      console.error('Image compression error:', error);
    }
  }
  
  // ... existing code ...
}

// ... existing code ...