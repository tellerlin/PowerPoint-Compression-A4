export function validateFile(file) {
  if (!file) throw new Error('Please select a file');
  if (!file.name.toLowerCase().endsWith('.pptx')) throw new Error('Please select a valid PPTX file');
  if (file.size > 300 * 1024 * 1024) throw new Error('File size must be less than 300MB');
  return true;
}

export function validateImageData(data) {
  if (!data || !(data instanceof Uint8Array)) throw new Error('Invalid image data');
  return true;
}