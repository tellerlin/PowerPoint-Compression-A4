import JSZip from 'jszip';

const decoder = new TextDecoder('utf-8');
const encoder = new TextEncoder();

export async function zipToMemFS(zip) {
  const memFS = {};
  const files = Object.keys(zip.files);
  for (const path of files) {
    const file = zip.file(path);
    if (file && !file.dir) {
      memFS[path] = await file.async('uint8array');
    }
  }
  console.log(`Converted zip to memFS with ${Object.keys(memFS).length} files.`);
  return memFS;
}

export function memFSToZip(memFS) {
  const zip = new JSZip();
  for (const path in memFS) {
    if (memFS.hasOwnProperty(path)) { // Ensure it's own property
        zip.file(path, memFS[path]);
    }
  }
  console.log(`Converted memFS back to zip with ${Object.keys(memFS).length} files.`);
  return zip;
}

export function readFileFromMemFS(memFS, path, format = 'string') {
    const data = memFS[path];
    if (!data) {
        console.warn(`File not found in memFS: ${path}`);
        return null;
    }
    if (format === 'string') {
        try {
            return decoder.decode(data);
        } catch (e) {
            console.error(`Error decoding file ${path} to string:`, e);
            return null; // Or handle error appropriately
        }
    } else if (format === 'uint8array') {
        return data;
    } else {
        console.error(`Unsupported read format: ${format}`);
        return null;
    }
}

export function writeFileToMemFS(memFS, path, data) {
    if (typeof data === 'string') {
        memFS[path] = encoder.encode(data);
    } else if (data instanceof Uint8Array) {
        memFS[path] = data;
    } else {
        console.error(`Unsupported data type for writing to memFS: ${typeof data}`);
    }
}

export function deleteFileFromMemFS(memFS, path) {
    if (memFS.hasOwnProperty(path)) {
        delete memFS[path];
        console.log(`Deleted file from memFS: ${path}`);
        return true;
    } else {
        console.warn(`Attempted to delete non-existent file from memFS: ${path}`);
        return false;
    }
}

export function fileExistsInMemFS(memFS, path) {
    return memFS.hasOwnProperty(path);
}

export function listFilesFromMemFS(memFS, prefix = '') {
    return Object.keys(memFS).filter(path => path.startsWith(prefix));
}