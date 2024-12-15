import JSZip from 'jszip';
import { compressImage } from './utils/image';

export async function optimizePPTX(file, options = {}) {
  const zip = await JSZip.loadAsync(file);
  const mediaFiles = Object.keys(zip.files).filter(f => f.startsWith('ppt/media/'));
  for (const mediaPath of mediaFiles) {
    const file = zip.file(mediaPath);
    if (!file) continue;
    const data = await file.async('uint8array');
    const compressedData = await compressImage(data);
    zip.file(mediaPath, compressedData.data);
  }
  return await zip.generateAsync({type: 'blob', compression: 'DEFLATE', compressionOptions: {level: 9}});
}
