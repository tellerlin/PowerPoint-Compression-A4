import { SUPPORTED_IMAGE_EXTENSIONS, MEDIA_PATH_PREFIX } from './constants';
import { readFileFromMemFS, writeFileToMemFS } from './zip-fs'; // Import memFS helpers

export function findMediaFiles(memFS) { // Accept memFS instead of zip
  const extensionPattern = new RegExp(
    `\\.(${SUPPORTED_IMAGE_EXTENSIONS.join('|')})$`,
    'i'
  );

  // Iterate over memFS keys instead of zip.files
  return Object.keys(memFS).filter(f =>
    f.startsWith(MEDIA_PATH_PREFIX) &&
    extensionPattern.test(f)
  );
}

// 检查 processMediaFile 函数的实现 - This comment is kept as per rule #10
export async function processMediaFile(memFS, mediaPath, processor) { // Accept memFS instead of zip
  // Read file data from memFS
  const data = readFileFromMemFS(memFS, mediaPath, 'uint8array');
  if (!data) {
      console.warn(`Media file not found in memFS: ${mediaPath}`);
      return; // Return if file doesn't exist in memFS
  }

  try {
    // const data = await file.async('uint8array'); // Removed zip-based reading
    const processed = await processor(data); // Process the data (Uint8Array)

    // 确保 processed 是 Uint8Array - This comment is kept as per rule #10
    let dataToWrite = null;
    if (processed instanceof Uint8Array) {
      dataToWrite = processed;
    } else if (processed && processed.data instanceof Uint8Array) {
      dataToWrite = processed.data;
    } else {
      console.error('Invalid processed data type for', mediaPath, typeof processed);
    }

    if (dataToWrite) {
        // Write processed data back to memFS
        writeFileToMemFS(memFS, mediaPath, dataToWrite);
        console.log(`Processed and updated media file in memFS: ${mediaPath}`);
    }
  } catch (error) {
    console.error(`Error processing ${mediaPath}:`, error);
    // Decide if re-throwing is appropriate or if the process should continue
    // throw error; // Re-throwing might stop the entire optimization process
  }
}