import { SUPPORTED_IMAGE_EXTENSIONS, MEDIA_PATH_PREFIX } from './constants';

export function findMediaFiles(zip) {
	if (!zip || !zip.files) return [];
	const mediaFiles = [];
	const extensionPattern = new RegExp(
		`\\.(${SUPPORTED_IMAGE_EXTENSIONS.join('|')})$`,
		'i'
	);

	for (const filePath in zip.files) {
		if (filePath.startsWith(MEDIA_PATH_PREFIX) && !zip.files[filePath].dir) {
            // Basic check for common media types even if not in SUPPORTED_IMAGE_EXTENSIONS
            // Helps find audio/video if needed later, but compression only targets images for now.
             mediaFiles.push(filePath);
		}
	}
    // console.log(`[findMediaFiles] Found ${mediaFiles.length} files under ${MEDIA_PATH_PREFIX}`);
	return mediaFiles;
}


export async function processMediaFile(zip, mediaPath, processor) {
	const file = zip.file(mediaPath);
	if (!file) {
        console.warn(`[processMediaFile] File not found in zip: ${mediaPath}`);
        return;
    }

	let originalData;
	try {
		originalData = await file.async('uint8array');
        if (!originalData || originalData.byteLength === 0) {
             console.warn(`[processMediaFile] File is empty: ${mediaPath}`);
             return; // Don't process empty files
        }

		const processedResult = await processor(originalData); // Processor should return { data: Uint8Array, ... } or just Uint8Array

        let dataToWrite = null;
        if (processedResult instanceof Uint8Array) {
            dataToWrite = processedResult;
        } else if (processedResult && processedResult.data instanceof Uint8Array) {
            dataToWrite = processedResult.data;
        }


		if (dataToWrite && dataToWrite !== originalData) { // Only write if data changed
            // console.log(`[processMediaFile] Updating file in zip: ${mediaPath}`);
			zip.file(mediaPath, dataToWrite);
		} else if (!dataToWrite) {
             console.warn(`[processMediaFile] Processor returned invalid data type for ${mediaPath}`);
        }

	} catch (error) {
		console.error(`[processMediaFile] Error processing ${mediaPath}:`, error.message);
		// Do not re-throw, allow optimizer to continue with other files
        // Ensure original data remains in the zip
	}
}
