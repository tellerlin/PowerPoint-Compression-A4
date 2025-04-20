export const SUPPORTED_IMAGE_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'bmp',
  'webp'
];

export const COMPRESSION_SETTINGS = {
  DEFAULT_QUALITY: 0.85,  // 提高默认质量，避免过度压缩
  MAX_IMAGE_SIZE: 1920,   // 调整最大图像尺寸
  ZIP_COMPRESSION_LEVEL: 6, // 降低压缩级别，提高兼容性
  // 添加更多细粒度控制
  PHOTO_QUALITY: 0.82,    // 提高照片质量
  DIAGRAM_QUALITY: 0.90,  // 提高图表质量
  ICON_QUALITY: 0.92,     // 提高图标质量
  // 新增设置
  WEBP_QUALITY: 0.88,     // 提高WebP格式的默认质量
  JPEG_QUALITY: 0.85,     // 提高JPEG格式的默认质量
  PNG_QUALITY: 0.92,      // 提高PNG格式的默认质量
  COLOR_THRESHOLD: 256,   // 颜色数量阈值，低于此值考虑使用索引色
  TRANSPARENCY_FORMATS: ['png', 'webp', 'gif'], // 支持透明度的格式
  MAX_CONCURRENT_COMPRESSION: 4  // 降低并发数，提高稳定性
};

export const MEDIA_PATH_PREFIX = 'ppt/media/';
export const PRESENTATION_PATH = 'ppt/presentation.xml';
export const SLIDE_PREFIX = 'ppt/slides/slide';

