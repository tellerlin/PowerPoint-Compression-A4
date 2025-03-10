export const SUPPORTED_IMAGE_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'bmp',
  'webp'
];

export const COMPRESSION_SETTINGS = {
  DEFAULT_QUALITY: 0.85, // 降回到0.85，提供更好的压缩率
  MAX_IMAGE_SIZE: 1366, // 保持原始设置
  ZIP_COMPRESSION_LEVEL: 9 // 保持最高压缩级别
};

export const MEDIA_PATH_PREFIX = 'ppt/media/';
export const PRESENTATION_PATH = 'ppt/presentation.xml';
export const SLIDE_PREFIX = 'ppt/slides/slide';