import { APP_CONFIG } from "../constants/app";
import { AppError, ErrorTypes } from "./error";

export function validateFile(file) {
  if (!file) {
    throw new AppError(ErrorTypes.FILE_TYPE, "No file selected");
  }

  const extension = `.${file.name.split(".").pop().toLowerCase()}`;
  
  if (!APP_CONFIG.SUPPORTED_EXTENSIONS.includes(extension)) {
    throw new AppError(ErrorTypes.FILE_TYPE, "Invalid file type");
  }

  if (file.size > APP_CONFIG.MAX_FILE_SIZE) {
    throw new AppError(
      ErrorTypes.FILE_SIZE,
      `File size (${(file.size / 1024 / 1024).toFixed(2)}MB) exceeds limit`
    );
  }

  // 修改文件名验证逻辑，使用更宽松的规则
  // 只检查文件名中是否包含危险字符，而不是限制只能使用特定字符
  if (/[<>:"/\\|?*\x00-\x1F]/.test(file.name)) {
    throw new AppError(ErrorTypes.FILE_TYPE, "File name contains invalid characters");
  }

  return true;
}

export function validateImageData(data) {
  if (!data || !(data instanceof Uint8Array)) throw new Error('Invalid image data');
  return true;
}
