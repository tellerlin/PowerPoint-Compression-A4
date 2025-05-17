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
	DEFAULT_QUALITY: 0.80,
    DIAGRAM_ICON_QUALITY_FACTOR: 0.65,
	MAX_IMAGE_SIZE: 1000,
    MIN_COMPRESSION_SIZE_BYTES: 5 * 1024, // 降低到5KB
    MIN_RECOMPRESSION_SIZE_BYTES: 20 * 1024, // 降低到20KB
    MIN_SAVING_PERCENTAGE_THRESHOLD: 0.98, // 提高阈值到98%
	ZIP_COMPRESSION_LEVEL: 9,
    DEFAULT_PRESET: 'balanced'
};

export const MEDIA_PATH_PREFIX = 'ppt/media/';
export const PRESENTATION_PATH = 'ppt/presentation.xml';
export const SLIDE_LAYOUT_PREFIX = 'ppt/slideLayouts/';
export const SLIDE_MASTER_PREFIX = 'ppt/slideMasters/';
export const SLIDE_PREFIX = 'ppt/slides/';
export const NOTES_SLIDE_PREFIX = 'ppt/notesSlides/';
export const CONTENT_TYPES_PATH = '[Content_Types].xml';

export const COMPRESSION_PRESETS = {
  balanced: {
    quality: 0.75,
    allowFormatConversion: true,
    allowDownsampling: true,
    maxImageSize: 1600,
    compressionMethod: 'mozjpeg'
  },
  aggressive: {
    quality: 0.60,
    allowFormatConversion: true,
    allowDownsampling: true,
    maxImageSize: 1024,
    compressionMethod: 'mozjpeg'
  },
  conservative: {
    quality: 0.85,
    allowFormatConversion: true,
    allowDownsampling: true,
    maxImageSize: 1920,
    compressionMethod: 'mozjpeg'
  }
};
