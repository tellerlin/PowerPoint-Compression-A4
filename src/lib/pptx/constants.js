export const SUPPORTED_IMAGE_EXTENSIONS = [
	'png',
	'jpg',
	'jpeg',
	'gif',
	'bmp',
	'webp',
    'tif',
    'tiff'
];

export const COMPRESSION_SETTINGS = {
	DEFAULT_QUALITY: 0.85,
    DIAGRAM_ICON_QUALITY_FACTOR: 0.75,
	MAX_IMAGE_SIZE: 1920,
    MIN_COMPRESSION_SIZE_BYTES: 10 * 1024, // 提高到10KB，避免压缩小图像
    MIN_RECOMPRESSION_SIZE_BYTES: 50 * 1024, // 提高到50KB
    MIN_SAVING_PERCENTAGE_THRESHOLD: 0.95, // 降低阈值到95%
	ZIP_COMPRESSION_LEVEL: 9, // 保持最高压缩级别
    DEFAULT_PRESET: 'standard'
};

export const MEDIA_PATH_PREFIX = 'ppt/media/';
export const PRESENTATION_PATH = 'ppt/presentation.xml';
export const SLIDE_LAYOUT_PREFIX = 'ppt/slideLayouts/';
export const SLIDE_MASTER_PREFIX = 'ppt/slideMasters/';
export const SLIDE_PREFIX = 'ppt/slides/';
export const NOTES_SLIDE_PREFIX = 'ppt/notesSlides/';
export const CONTENT_TYPES_PATH = '[Content_Types].xml';

export const COMPRESSION_PRESETS = {
  standard: {
    quality: 0.85,
    allowFormatConversion: true,
    allowDownsampling: true,
    maxImageSize: 1920,
    compressionMethod: 'mozjpeg'
  }
};
