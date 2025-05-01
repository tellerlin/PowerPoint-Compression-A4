import JSZip from 'jszip';
import { validateFile } from '../utils/validation';
import { compressImage } from '../utils/image';
import { COMPRESSION_SETTINGS, SUPPORTED_IMAGE_EXTENSIONS } from './constants';
import { findMediaFiles, processMediaFile } from './media'; // Use media.js directly
import { removeHiddenSlides } from './slides';
import { cleanUnusedResources } from './cleaner';

async function preprocessImages(zip, options = {}) {
	console.log('[preprocessImages] Preprocessing step (currently placeholder).');
	return true;
}


export async function optimizePPTX(file, options = {}) {
	let zip;
	const { onProgress = () => {} } = options;
	const startTime = Date.now();
	let finalStats = {
		originalSize: file?.size || 0,
		compressedSize: null,
		savedSize: 0,
		savedPercentage: 0,
		originalMediaSize: 0,
		compressedMediaSize: 0,
		savedMediaSize: 0,
		savedMediaPercentage: 0,
		processingTime: 0,
        error: null
	};

	try {
		validateFile(file);

		const hasHardwareConcurrency = typeof navigator !== 'undefined' && 'hardwareConcurrency' in navigator;
		const cpuCount = hasHardwareConcurrency ? navigator.hardwareConcurrency : 4;

		onProgress('fileInfo', { name: file.name, size: file.size });

		try {
			zip = await JSZip.loadAsync(file);
		} catch (zipError) {
			const errorMessage = zipError.message.includes('invalid') || zipError.message.includes('end of central directory record')
				? 'Invalid or corrupted file format. Please upload a valid PowerPoint file.'
				: `Failed to load file: ${zipError.message}`;
			throw new Error(errorMessage);
		}

		if (options.removeHiddenSlides) {
			onProgress('init', { percentage: 5, status: 'Removing hidden slides...' });
			try {
				await removeHiddenSlides(zip, onProgress);
			} catch (error) {
                onProgress('warning', { message: `Failed to remove hidden slides: ${error.message}` });
			}
		}

		onProgress('init', { percentage: 15, status: 'Cleaning unused resources...' });
		try {
            const cleanupSuccess = await cleanUnusedResources(zip, onProgress, {
                removeUnusedLayouts: options.removeUnusedLayouts,
                cleanMediaInUnusedLayouts: options.cleanMediaInUnusedLayouts,
            });
             if (!cleanupSuccess) {
                 onProgress('warning', { message: 'Resource cleanup encountered issues.' });
             }
        } catch(error) {
             onProgress('warning', { message: `Resource cleanup failed: ${error.message}` });
        }

		if (options.preprocessImages) {
			onProgress('init', { percentage: 35, status: 'Preprocessing images...' });
			await preprocessImages(zip, { /* Options */ });
		}

		if (options.compressImages !== false) {
			const mediaFiles = findMediaFiles(zip);
			onProgress('mediaCount', { count: mediaFiles.length });

			let totalOriginalMediaSize = 0;
			let totalCompressedMediaSize = 0;
            let processedMediaCount = 0;
            let failedMediaCount = 0;

			if (mediaFiles.length > 0) {
                const batchSize = Math.min(mediaFiles.length, Math.max(4, cpuCount * 2));

				for (let i = 0; i < mediaFiles.length; i += batchSize) {
					const batch = mediaFiles.slice(i, i + batchSize);
					const batchPromises = batch.map(mediaPath => {
						return (async () => {
							let fileOriginalSize = 0;
							let fileCompressedSize = 0;
							let success = false;
							let error = null;
							try {
								const fileExtension = mediaPath.split('.').pop()?.toLowerCase() || '';
								const isSupportedImage = SUPPORTED_IMAGE_EXTENSIONS.includes(fileExtension);
								await processMediaFile(zip, mediaPath, async (data) => {
									fileOriginalSize = data.byteLength;
									fileCompressedSize = fileOriginalSize;
									if (isSupportedImage && fileOriginalSize > COMPRESSION_SETTINGS.MIN_COMPRESSION_SIZE_BYTES) {
										const qualityOption = typeof options.compressImages === 'object' ? options.compressImages.quality : undefined;
										const adjustedQuality = qualityOption || COMPRESSION_SETTINGS.DEFAULT_QUALITY;
										const compressResult = await compressImage(data, adjustedQuality);
										if (compressResult.error) {
											error = compressResult.error;
											return data;
										}
										fileCompressedSize = compressResult.compressedSize;
										return compressResult.data;
									} else {
										return data;
									}
								});
								success = error === null;
							} catch (processError) {
								error = processError.message;
								try {
									const file = zip.file(mediaPath);
									if (file) fileOriginalSize = (await file.async('uint8array')).byteLength;
								} catch (e) {}
								fileCompressedSize = fileOriginalSize;
							}
							return { path: mediaPath, originalSize: fileOriginalSize, compressedSize: fileCompressedSize, success, error };
						})();
					});
					const batchResults = await Promise.all(batchPromises);
					batchResults.forEach(result => {
						totalOriginalMediaSize += result.originalSize || 0;
						totalCompressedMediaSize += result.compressedSize || 0;
						if (result.success) {
							processedMediaCount++;
						} else {
							failedMediaCount++;
						}
					});
					const elapsed = Date.now() - startTime;
					const currentProcessedTotal = processedMediaCount + failedMediaCount;
					const estimatedTotalTime = mediaFiles.length > 0 && currentProcessedTotal > 0 ? (elapsed / currentProcessedTotal) * mediaFiles.length : 0;
					const estimatedRemaining = Math.max(0, estimatedTotalTime - elapsed);
					onProgress('media', {
						fileIndex: Math.min(i + batchSize, mediaFiles.length),
						totalFiles: mediaFiles.length,
						processedFiles: batchResults.map(r => r.path.split('/').pop()),
						estimatedTimeRemaining: Math.round(estimatedRemaining / 1000)
					});
				}
				
				finalStats.originalMediaSize = totalOriginalMediaSize;
				finalStats.compressedMediaSize = totalCompressedMediaSize;
				finalStats.savedMediaSize = totalOriginalMediaSize - totalCompressedMediaSize;
				finalStats.savedMediaPercentage = totalOriginalMediaSize > 0 ? ((totalOriginalMediaSize - totalCompressedMediaSize) / totalOriginalMediaSize * 100).toFixed(1) : 0;
			}
		}

		onProgress('finalize', {
			status: `Rebuilding presentation...`,
			stats: finalStats
		});

		const compressedBlob = await zip.generateAsync({
			type: 'blob',
			compression: 'DEFLATE',
			compressionOptions: { level: COMPRESSION_SETTINGS.ZIP_COMPRESSION_LEVEL },
			mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
		});

		finalStats.compressedSize = compressedBlob.size;
		finalStats.savedSize = finalStats.originalSize - compressedBlob.size;
		finalStats.savedPercentage = finalStats.originalSize > 0 ? (finalStats.savedSize / finalStats.originalSize * 100).toFixed(1) : 0;
		finalStats.processingTime = (Date.now() - startTime) / 1000;

		onProgress('complete', { stats: finalStats });

		return compressedBlob;

	} catch (error) {
        finalStats.error = error.message;

		let userFriendlyMessage = 'An unexpected error occurred during optimization.';
        if (error.message.includes('Invalid or corrupted file format')) {
            userFriendlyMessage = error.message;
        } else if (error.message.includes('memory') || error.message.includes('buffer') || error instanceof RangeError) {
			userFriendlyMessage = 'Processing failed due to memory or size constraints. Try closing other tabs or using a smaller file.';
		} else if (error.message.includes('Invalid or unsupported image data')) {
            userFriendlyMessage = `Unsupported image found: ${error.message}. Please check image formats.`;
        } else if (error instanceof TypeError || error instanceof ReferenceError) {
			userFriendlyMessage = 'A programming error occurred. Please report this issue.';
		}

		finalStats.processingTime = (Date.now() - startTime) / 1000;
		onProgress('error', {
			message: userFriendlyMessage,
			details: error.message,
			stats: finalStats
		});

		throw error;
	}
}