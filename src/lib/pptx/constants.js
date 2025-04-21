export const SUPPORTED_IMAGE_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'bmp',
  'webp'
];

export const COMPRESSION_SETTINGS = {
  DEFAULT_QUALITY: 0.82,  // 略微调整默认质量
  MAX_IMAGE_SIZE: 1600,   // 调整最大图像尺寸
  ZIP_COMPRESSION_LEVEL: 9,
  // 添加更多细粒度控制
  PHOTO_QUALITY: 0.80,    // 照片可以使用较低质量
  DIAGRAM_QUALITY: 0.88,  // 图表需要更高质量
  ICON_QUALITY: 0.90      // 图标需要最高质量
};

export const MEDIA_PATH_PREFIX = 'ppt/media/';
export const PRESENTATION_PATH = 'ppt/presentation.xml';
export const SLIDE_PREFIX = 'ppt/slides/slide';

