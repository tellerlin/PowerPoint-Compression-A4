// Add the missing loadImage function
function loadImage(data) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error('Failed to load image: ' + e.message));
    
    // Convert data to a blob URL if it's not already a string
    if (typeof data !== 'string') {
      const blob = new Blob([data], { type: 'image/png' });
      img.src = URL.createObjectURL(blob);
    } else {
      img.src = data;
    }
  });
}

// Make sure this function is exported
export { loadImage };

// Your existing compressImage function should use the loadImage function
export async function compressImage(imageData, options = {}) {
  const { quality = 0.8, maxWidth = null, maxHeight = null } = options;
  
  try {
    // Use the loadImage function we defined above
    const img = await loadImage(imageData);
    
    // Calculate new dimensions if needed
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
    
    // Create canvas and draw image
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);
    
    // Convert to blob with specified quality
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        // Clean up the object URL if we created one
        if (typeof imageData !== 'string') {
          URL.revokeObjectURL(img.src);
        }
        
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to create blob from canvas'));
        }
      }, 'image/png', quality);
    });
  } catch (error) {
    console.error('Error compressing image:', error);
    throw error;
  }
}

// Other image-related functions...