import JSZip from 'jszip';
import { parseStringPromise } from 'xml2js';

export async function optimizePPTX(file, options = {}) {
  const zip = await JSZip.loadAsync(file);
  const mediaFiles = Object.keys(zip.files).filter(f => f.startsWith('ppt/media/'));

  for (const mediaPath of mediaFiles) {
    const file = zip.file(mediaPath);
    if (!file) continue;
    const data = await file.async('uint8array');
    zip.file(mediaPath, await compressImage(data));
  }

  return await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 }
  });
}

async function compressImage(data) {
  const blob = new Blob([data]);
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 })).arrayBuffer());
}