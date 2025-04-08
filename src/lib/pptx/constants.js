export const SUPPORTED_IMAGE_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'bmp',
  'webp'
];

export const COMPRESSION_SETTINGS = {
  DEFAULT_QUALITY: 0.80, // 降低默认质量以提高压缩率
  MAX_IMAGE_SIZE: 1200, // 降低最大图片尺寸
  ZIP_COMPRESSION_LEVEL: 9 // 保持最高压缩级别
};

export const MEDIA_PATH_PREFIX = 'ppt/media/';
export const PRESENTATION_PATH = 'ppt/presentation.xml';
export const SLIDE_PREFIX = 'ppt/slides/slide';