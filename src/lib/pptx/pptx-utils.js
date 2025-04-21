import { parseXmlWithNamespaces, buildXml, parseXml } from './xml/parser';
import { MEDIA_PATH_PREFIX } from './constants';
import { removeHiddenSlides as removeHiddenSlidesFromSlides } from './slides';

/**
 * Find all media files
 * @param {JSZip} zip PPTX ZIP object
 * @returns {Array<string>} Array of media file paths
 */
export function findMediaFiles(zip) {
  return Object.keys(zip.files)
    .filter(path => path.startsWith(MEDIA_PATH_PREFIX));
}

/**
 * Process a media file
 * @param {JSZip} zip PPTX ZIP object
 * @param {string} mediaPath Media file path
 * @param {Function} processor Processing function
 */
export async function processMediaFile(zip, mediaPath, processor) {
  const file = zip.file(mediaPath);
  if (!file) return;
  
  const data = await file.async('uint8array');
  const processedData = await processor(data);
  
  if (processedData) {
    zip.file(mediaPath, processedData);
  }
}

/**
 * Remove hidden slides
 * @param {JSZip} zip PPTX ZIP object
 */
export const removeHiddenSlides = removeHiddenSlidesFromSlides;

// Removed original removeHiddenSlides function implementation
// Using the function imported from slides.js instead