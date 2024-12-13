export function createDownloadLink(blob, originalName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = getCompressedFileName(originalName);
  return { url, a };
}

export function cleanupDownload(url) {
  URL.revokeObjectURL(url);
}

function getCompressedFileName(originalName) {
  const baseName = originalName.replace(/\.pptx$/i, '');
  return `${baseName}_compressed.pptx`;
}