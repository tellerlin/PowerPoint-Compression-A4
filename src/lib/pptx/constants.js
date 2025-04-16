export const SUPPORTED_IMAGE_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'bmp',
  'webp'
];

export const COMPRESSION_SETTINGS = {
  DEFAULT_QUALITY: 0.90, // 将默认压缩质量从0.80提高到0.90
  MAX_IMAGE_SIZE: 1600, // 增加最大图像尺寸从1200到1600，保留更多细节
  ZIP_COMPRESSION_LEVEL: 9 // Maximum ZIP compression level
};

export const MEDIA_PATH_PREFIX = 'ppt/media/';
export const PRESENTATION_PATH = 'ppt/presentation.xml';
export const SLIDE_PREFIX = 'ppt/slides/slide';