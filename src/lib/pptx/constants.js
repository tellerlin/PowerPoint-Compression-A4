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
	DEFAULT_QUALITY: 0.90,
    DIAGRAM_ICON_QUALITY_FACTOR: 0.75, // Applied as min(DEFAULT_QUALITY, factor)
	MAX_IMAGE_SIZE: 1000, // Max width OR max height
    MIN_COMPRESSION_SIZE_BYTES: 10 * 1024, // 10KB - Skip compression entirely below this
    MIN_RECOMPRESSION_SIZE_BYTES: 50 * 1024, // 50KB - Skip recompression if no resize AND below this
    MIN_SAVING_PERCENTAGE_THRESHOLD: 0.95, // Compressed size must be < 95% of original to be kept
	ZIP_COMPRESSION_LEVEL: 9
};

export const MEDIA_PATH_PREFIX = 'ppt/media/';
export const PRESENTATION_PATH = 'ppt/presentation.xml';
export const SLIDE_LAYOUT_PREFIX = 'ppt/slideLayouts/';
export const SLIDE_MASTER_PREFIX = 'ppt/slideMasters/';
export const SLIDE_PREFIX = 'ppt/slides/';
export const NOTES_SLIDE_PREFIX = 'ppt/notesSlides/';
export const CONTENT_TYPES_PATH = '[Content_Types].xml';
