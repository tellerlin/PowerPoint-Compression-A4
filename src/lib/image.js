// ... existing code ...

// 确保正确导入或定义loadImage函数
function loadImage(data) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = URL.createObjectURL(new Blob([data]));
  });
}

async function compressImage(imageData, quality = 0.8, maxWidth = null, maxHeight = null) {
  try {
    const img = await loadImage(imageData);
    
    // 计算新的尺寸
    let width = img.width;
    let height = img.height;
    
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
    
    // 转换为Blob
    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        URL.revokeObjectURL(img.src); // 清理
        resolve(blob);
      }, 'image/png', quality);
    });
  } catch (error) {
    console.error('Error compressing image:', error);
    throw error;
  }
}

// ... existing code ...