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
		console.log(`[optimizePPTX] Starting optimization for: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);

		try {
			console.log('[optimizePPTX] Loading ZIP file...');
			zip = await JSZip.loadAsync(file);
			console.log('[optimizePPTX] ZIP file loaded successfully.');
		} catch (zipError) {
			console.error('[optimizePPTX] ZIP loading error:', zipError.message);
			const errorMessage = zipError.message.includes('invalid') || zipError.message.includes('end of central directory record')
				? 'Invalid or corrupted file format. Please upload a valid PowerPoint file.'
				: `Failed to load file: ${zipError.message}`;
			throw new Error(errorMessage);
		}

		if (options.removeHiddenSlides) {
			onProgress('init', { percentage: 5, status: 'Removing hidden slides...' });
			console.log('[optimizePPTX] Starting hidden slide removal step...');
			try {
				await removeHiddenSlides(zip, onProgress); // Pass progress callback if needed
				console.log('[optimizePPTX] Hidden slide removal step finished.');
			} catch (error) {
				console.error('[optimizePPTX] Error during hidden slide removal:', error.message);
				// Decide whether to continue or stop. Continuing for now.
                onProgress('warning', { message: `Failed to remove hidden slides: ${error.message}` });
			}
		} else {
			console.log('[optimizePPTX] Skipping hidden slide removal.');
		}

		onProgress('init', { percentage: 15, status: 'Cleaning unused resources...' });
		console.log('[optimizePPTX] Starting unused resource cleanup step...');
		try {
            const cleanupSuccess = await cleanUnusedResources(zip, onProgress, {
                removeUnusedLayouts: options.removeUnusedLayouts,
                cleanMediaInUnusedLayouts: options.cleanMediaInUnusedLayouts,
            });
             if (cleanupSuccess) {
                console.log('[optimizePPTX] Unused resource cleanup step finished successfully.');
             } else {
                 console.warn('[optimizePPTX] Unused resource cleanup step finished with errors (check logs).');
                 onProgress('warning', { message: 'Resource cleanup encountered issues.' });
             }
        } catch(error) {
             console.error('[optimizePPTX] Critical error during resource cleanup:', error.message, error.stack);
             onProgress('warning', { message: `Resource cleanup failed: ${error.message}` });
        }


		if (options.preprocessImages) {
			onProgress('init', { percentage: 35, status: 'Preprocessing images...' });
			await preprocessImages(zip, { /* Options */ });
		}

		if (options.compressImages !== false) { // Default to true unless explicitly false
			console.log('[optimizePPTX] Starting media compression step...');
			const mediaFiles = findMediaFiles(zip);
			onProgress('mediaCount', { count: mediaFiles.length });

			let totalOriginalMediaSize = 0;
			let totalCompressedMediaSize = 0;
            let processedMediaCount = 0;
            let failedMediaCount = 0;

			if (mediaFiles.length > 0) {
                const batchSize = Math.min(mediaFiles.length, Math.max(4, cpuCount * 2)); // Increase batch size slightly
                console.log(`[optimizePPTX] Compressing ${mediaFiles.length} media files with batch size ${batchSize}...`);

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
											console.warn(`[optimizePPTX] Compression failed for ${mediaPath}: ${compressResult.error}`);
											error = compressResult.error;
											return data;
										}
										fileCompressedSize = compressResult.compressedSize;
										return compressResult.data;
									} else {
										if (!isSupportedImage) {
											console.log(`[optimizePPTX] Skipping compression for non-image file: ${mediaPath}`);
										} else {
											console.log(`[optimizePPTX] Skipping compression for small image: ${mediaPath} (${fileOriginalSize} bytes)`);
										}
										return data;
									}
								});
								success = error === null;
							} catch (processError) {
								console.error(`[optimizePPTX] Failed to process media file wrapper: ${mediaPath}`, processError.message);
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

                console.log(`[optimizePPTX] Media compression finished. Processed: ${processedMediaCount}, Failed: ${failedMediaCount}.`);
                console.log(`[optimizePPTX] Media Size Change: ${ (totalOriginalMediaSize / 1024 / 1024).toFixed(2)} MB -> ${(totalCompressedMediaSize / 1024 / 1024).toFixed(2)} MB (Saved ${finalStats.savedMediaPercentage}%)`);

			} else {
				console.log('[optimizePPTX] No media files found to compress.');
			}
		} else {
			console.log('[optimizePPTX] Skipping media compression step.');
		}


		onProgress('finalize', {
			status: `Rebuilding presentation...`,
			stats: finalStats
		});

		console.log('[optimizePPTX] Generating final ZIP file...');
		const compressedBlob = await zip.generateAsync({
			type: 'blob',
			compression: 'DEFLATE',
			compressionOptions: { level: COMPRESSION_SETTINGS.ZIP_COMPRESSION_LEVEL },
			mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
		});
		console.log(`[optimizePPTX] Final ZIP file generated: ${(compressedBlob.size / 1024 / 1024).toFixed(2)} MB`);

		finalStats.compressedSize = compressedBlob.size;
		finalStats.savedSize = finalStats.originalSize - compressedBlob.size;
		finalStats.savedPercentage = finalStats.originalSize > 0 ? (finalStats.savedSize / finalStats.originalSize * 100).toFixed(1) : 0;
		finalStats.processingTime = (Date.now() - startTime) / 1000;

		onProgress('complete', { stats: finalStats });
		console.log(`[optimizePPTX] Optimization process completed successfully in ${finalStats.processingTime.toFixed(1)}s. Saved ${finalStats.savedPercentage}%`);

		return compressedBlob;

	} catch (error) {
		console.error('[optimizePPTX] Optimization failed:', error.message, error.stack);
        finalStats.error = error.message;

		let userFriendlyMessage = 'An unexpected error occurred during optimization.';
        if (error.message.includes('Invalid or corrupted file format')) {
            userFriendlyMessage = error.message; // Use the specific message from ZIP loading
        } else if (error.message.includes('memory') || error.message.includes('buffer') || error instanceof RangeError) {
			userFriendlyMessage = 'Processing failed due to memory or size constraints. Try closing other tabs or using a smaller file.';
		} else if (error.message.includes('Invalid or unsupported image data')) {
            userFriendlyMessage = `Unsupported image found: ${error.message}. Please check image formats.`;
        } else if (error instanceof TypeError || error instanceof ReferenceError) {
			userFriendlyMessage = 'A programming error occurred. Please report this issue.';
            console.error("Internal Error Details:", error.name, error.message, error.stack);
		}


		finalStats.processingTime = (Date.now() - startTime) / 1000;
		onProgress('error', {
			message: userFriendlyMessage,
			details: error.message,
			stats: finalStats
		});

		throw error; // Re-throw the original error
	}
}
