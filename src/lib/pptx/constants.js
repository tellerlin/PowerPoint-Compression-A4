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
	MAX_IMAGE_SIZE: 1920,
    MIN_COMPRESSION_SIZE_BYTES: 10 * 1024, // 10KB minimum to avoid compressing small images
	ZIP_COMPRESSION_LEVEL: 9, // Maximum compression level
    DEFAULT_PRESET: 'standard',
    // Compression preset options
    quality: 0.85,
    allowFormatConversion: true,
    allowDownsampling: true,
    maxImageSize: 1920,
    compressionMethod: 'mozjpeg'
};

export const MEDIA_PATH_PREFIX = 'ppt/media/';
export const PRESENTATION_PATH = 'ppt/presentation.xml';

export const COMPRESSION_PRESETS = {
  standard: {
    quality: 0.85,
    allowFormatConversion: true,
    allowDownsampling: true,
    maxImageSize: 1920,
    compressionMethod: 'mozjpeg'
  }
};
