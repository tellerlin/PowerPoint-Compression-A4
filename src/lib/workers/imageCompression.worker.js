// Image Compression Web Worker

// Import all required functions
self.hashCode = function(data) {
  let hash = 0;
  const step = Math.max(1, Math.floor(data.length / 100));
  for (let i = 0; i < data.length; i += step) {
    hash = ((hash << 5) - hash) + data[i];
    hash |= 0;
  }
  return hash.toString(16);
};

self.checkAlphaChannel = function(imageData) {
  const data = imageData.data;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true;
  }
  return false;
};

self.calculateOptimalDimensions = function(originalWidth, originalHeight, maxSize = 1920) {
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
  
  if (targetWidth > maxSize) {
    targetWidth = maxSize;
    targetHeight = Math.round(targetWidth / aspectRatio);
  }
  if (targetHeight > maxSize) {
    targetHeight = maxSize;
    targetWidth = Math.round(targetHeight * aspectRatio);
  }
  
  return { width: targetWidth, height: targetHeight };
};

self.detectFormat = async function(data) {
  if (data.length < 12) return 'unknown';
  const bytes = data.slice(0, 12);
  const header = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  
  if (header.startsWith('89504e470d0a1a0a')) return 'png';
  if (header.startsWith('ffd8ff')) return 'jpeg';
  if (header.startsWith('474946383761') || header.startsWith('474946383961')) return 'gif';
  if (header.startsWith('424d')) return 'bmp';
  if (header.startsWith('52494646') && header.indexOf('57454250') > 0) return 'webp';
  if (header.startsWith('49492a00') || header.startsWith('4d4d002a')) return 'tiff';
  
  return 'unknown';
};

self.processImage = async function(data, quality, originalFormat) {
  if (!(data instanceof Uint8Array)) {
    throw new TypeError('processImage: data must be a Uint8Array');
  }
  
  console.log(`[ImageCompressionWorker] Starting compression: size=${data.byteLength}, quality=${quality}, format=${originalFormat || 'auto'}`);
  
  const originalSize = data.byteLength;
  let format = originalFormat || await self.detectFormat(data);
  let compressedData = data;
  let outputFormat = format;
  let method = 'original';
  let originalWidth = 0;
  let originalHeight = 0;
  let targetWidth = 0;
  let targetHeight = 0;
  
  try {
    console.log(`[ImageCompressionWorker] Detected format: ${format}`);
    const blob = new Blob([data], { type: `image/${format}` });
    const bitmap = await createImageBitmap(blob).catch(err => {
      console.error(`[ImageCompressionWorker] Failed to create image bitmap: ${err.message}`);
      throw new Error(`Failed to create image bitmap: ${err.message}`);
    });
    
    originalWidth = bitmap.width;
    originalHeight = bitmap.height;
    console.log(`[ImageCompressionWorker] Image dimensions: ${originalWidth}x${originalHeight}`);
    
    const canvas = new OffscreenCanvas(originalWidth, originalHeight);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D context for canvas');
    }
    
    ctx.drawImage(bitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, originalWidth, originalHeight);
    
    const hasAlpha = self.checkAlphaChannel(imageData);
    console.log(`[ImageCompressionWorker] Image has alpha channel: ${hasAlpha}`);
    
    const dimensions = self.calculateOptimalDimensions(originalWidth, originalHeight);
    targetWidth = dimensions.width;
    targetHeight = dimensions.height;
    console.log(`[ImageCompressionWorker] Target dimensions: ${targetWidth}x${targetHeight}`);
    
    const blobs = [];
    
    try {
      const webpBlob = await canvas.convertToBlob({ type: 'image/webp', quality });
      console.log(`[ImageCompressionWorker] WebP compression result: ${webpBlob.size} bytes`);
      blobs.push({
        type: 'webp',
        blob: webpBlob
      });
    } catch (err) {
      console.error(`[ImageCompressionWorker] WebP compression failed: ${err.message}`);
    }
    
    if (!hasAlpha) {
      try {
        const jpegBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
        console.log(`[ImageCompressionWorker] JPEG compression result: ${jpegBlob.size} bytes`);
        blobs.push({
          type: 'jpeg',
          blob: jpegBlob
        });
      } catch (err) {
        console.error(`[ImageCompressionWorker] JPEG compression failed: ${err.message}`);
      }
    }
    
    if (hasAlpha) {
      try {
        const pngBlob = await canvas.convertToBlob({ type: 'image/png' });
        console.log(`[ImageCompressionWorker] PNG compression result: ${pngBlob.size} bytes`);
        blobs.push({
          type: 'png',
          blob: pngBlob
        });
      } catch (err) {
        console.error(`[ImageCompressionWorker] PNG compression failed: ${err.message}`);
      }
    }
    
    if (blobs.length > 0) {
      let best = blobs[0];
      for (const candidate of blobs) {
        if (candidate.blob && candidate.blob.size < best.blob.size) {
          best = candidate;
        }
      }
      
      console.log(`[ImageCompressionWorker] Best compression: ${best.type}, size: ${best.blob.size} bytes (${((1 - best.blob.size/originalSize) * 100).toFixed(1)}% reduction)`);
      
      if (best.blob.size < originalSize * 0.95) {
        compressedData = new Uint8Array(await best.blob.arrayBuffer());
        outputFormat = best.type;
        method = best.type;
      } else {
        console.log(`[ImageCompressionWorker] Compression not effective enough, keeping original`);
      }
    } else {
      console.warn(`[ImageCompressionWorker] No compression formats succeeded, keeping original`);
    }
    
    if ((targetWidth !== originalWidth || targetHeight !== originalHeight) && method === 'original') {
      console.log(`[ImageCompressionWorker] Trying resize from ${originalWidth}x${originalHeight} to ${targetWidth}x${targetHeight}`);
      const resizedCanvas = new OffscreenCanvas(targetWidth, targetHeight);
      const resizedCtx = resizedCanvas.getContext('2d');
      if (!resizedCtx) {
        throw new Error('Failed to get 2D context for resized canvas');
      }
      
      resizedCtx.imageSmoothingQuality = 'high';
      resizedCtx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
      
      const resizedBlobs = [];
      
      try {
        const webpBlob = await resizedCanvas.convertToBlob({ type: 'image/webp', quality });
        console.log(`[ImageCompressionWorker] Resized WebP result: ${webpBlob.size} bytes`);
        resizedBlobs.push({
          type: 'webp',
          blob: webpBlob
        });
      } catch (err) {
        console.error(`[ImageCompressionWorker] Resized WebP failed: ${err.message}`);
      }
      
      if (!hasAlpha) {
        try {
          const jpegBlob = await resizedCanvas.convertToBlob({ type: 'image/jpeg', quality });
          console.log(`[ImageCompressionWorker] Resized JPEG result: ${jpegBlob.size} bytes`);
          resizedBlobs.push({
            type: 'jpeg',
            blob: jpegBlob
          });
        } catch (err) {
          console.error(`[ImageCompressionWorker] Resized JPEG failed: ${err.message}`);
        }
      }
      
      if (hasAlpha) {
        try {
          const pngBlob = await resizedCanvas.convertToBlob({ type: 'image/png' });
          console.log(`[ImageCompressionWorker] Resized PNG result: ${pngBlob.size} bytes`);
          resizedBlobs.push({
            type: 'png',
            blob: pngBlob
          });
        } catch (err) {
          console.error(`[ImageCompressionWorker] Resized PNG failed: ${err.message}`);
        }
      }
      
      if (resizedBlobs.length > 0) {
        let best = resizedBlobs[0];
        for (const candidate of resizedBlobs) {
          if (candidate.blob && candidate.blob.size < best.blob.size) {
            best = candidate;
          }
        }
        
        console.log(`[ImageCompressionWorker] Best resized compression: ${best.type}, size: ${best.blob.size} bytes (${((1 - best.blob.size/originalSize) * 100).toFixed(1)}% reduction)`);
        
        if (best.blob.size < originalSize * 0.95) {
          compressedData = new Uint8Array(await best.blob.arrayBuffer());
          outputFormat = best.type;
          method = `resized-${best.type}`;
        } else {
          console.log(`[ImageCompressionWorker] Resized compression not effective enough, keeping original`);
        }
      }
    }
  } catch (error) {
    console.error(`[ImageCompressionWorker] Error during compression: ${error.message}`);
    compressedData = data;
    method = 'original';
  }
  
  const result = {
    data: compressedData,
    format: outputFormat,
    compressionMethod: method,
    originalSize: originalSize,
    compressedSize: compressedData.byteLength,
    originalDimensions: { width: originalWidth, height: originalHeight },
    finalDimensions: { width: targetWidth, height: targetHeight }
  };
  
  console.log(`[ImageCompressionWorker] Compression complete: originalSize=${result.originalSize}, compressedSize=${result.compressedSize}, method=${result.compressionMethod}`);
  return result;
};

// Handle messages from the main thread
self.onmessage = async function(event) {
  try {
    const { data, quality, format } = event.data;
    
    if (!data || !(data instanceof Uint8Array)) {
      throw new Error('Invalid data format. Expected Uint8Array.');
    }
    
    const result = await self.processImage(data, quality, format);
    
    // Send the result back to the main thread
    self.postMessage({
      success: true,
      result: {
        data: result.data,
        format: result.format,
        compressionMethod: result.compressionMethod,
        originalSize: result.originalSize,
        compressedSize: result.compressedSize,
        originalDimensions: result.originalDimensions,
        finalDimensions: result.finalDimensions
      }
    }, [result.data.buffer]);
    
  } catch (error) {
    console.error(`[ImageCompressionWorker] Worker error: ${error.message}`);
    self.postMessage({
      success: false,
      error: error.message
    });
  }
};