import { APP_CONFIG } from "../constants/app";
import { AppError, ErrorTypes } from "./error";
import JSZip from 'jszip';

export function validateFile(file) {
  // Basic validation
  if (!file) {
    throw new AppError(ErrorTypes.FILE_TYPE, "No file selected");
  }
  
  // Check file type
  const extension = `.${file.name.split(".").pop().toLowerCase()}`;
  
  if (!APP_CONFIG.SUPPORTED_EXTENSIONS.includes(extension)) {
    throw new AppError(ErrorTypes.FILE_TYPE, "Invalid file type");
  }
  
  // Check file size
  if (file.size > APP_CONFIG.MAX_FILE_SIZE) {
    throw new AppError(
      ErrorTypes.FILE_SIZE,
      `File size (${(file.size / 1024 / 1024).toFixed(2)}MB) exceeds limit`
    );
  }
  
  // Check for dangerous characters in filename
  if (/[<>:"/\\|?*\x00-\x1F]/.test(file.name)) {
    throw new AppError(ErrorTypes.FILE_TYPE, "File name contains invalid characters");
  }
  
  return true;
}

export function validateImageData(data) {
  if (!data || !(data instanceof Uint8Array)) throw new Error('Invalid image data');
  return true;
}

// Add deep validation function
export async function validatePPTXStructure(file) {
  try {
    // Load ZIP file
    const zip = await JSZip.loadAsync(file);
    
    // Check necessary files
    const requiredFiles = [
      'ppt/presentation.xml',
      '[Content_Types].xml',
      '_rels/.rels'
    ];
    
    const missingFiles = requiredFiles.filter(path => !zip.file(path));
    
    if (missingFiles.length > 0) {
      throw new Error(`Invalid PPTX file structure, missing required files: ${missingFiles.join(', ')}`);
    }
    
    // Check presentation XML
    const presentationXml = await zip.file('ppt/presentation.xml')?.async('string');
    if (!presentationXml || !presentationXml.includes('<p:presentation')) {
      throw new Error('Invalid PPTX file structure, presentation XML format error');
    }
    
    // Check slides
    const slideRefs = Object.keys(zip.files).filter(path => 
      path.startsWith('ppt/slides/slide') && path.endsWith('.xml')
    );
    
    if (slideRefs.length === 0) {
      throw new Error('PPTX file does not contain any slides');
    }
    
    return {
      valid: true,
      slideCount: slideRefs.length,
      hasMedia: Object.keys(zip.files).some(path => path.startsWith('ppt/media/')),
      structure: {
        slides: slideRefs,
        layouts: Object.keys(zip.files).filter(path => path.startsWith('ppt/slideLayouts/')),
        masters: Object.keys(zip.files).filter(path => path.startsWith('ppt/slideMasters/'))
      }
    };
  } catch (error) {
    if (error.message.includes('Invalid PPTX file structure')) {
      throw error;
    } else {
      throw new Error(`PPTX file structure validation failed: ${error.message}`);
    }
  }
}
