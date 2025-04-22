import { parseXml, buildXml } from './xml/parser'; // Uses the updated parser
import { PRESENTATION_PATH, MEDIA_PATH_PREFIX } from './constants';
import {
	removeUnusedLayouts as performLayoutRemoval,
	getLayoutMaster,
	getUsedLayoutsAndMasters as analyzeUsedLayoutsMasters
} from './layout-cleaner';
import { findMediaFiles } from './media';

export async function cleanUnusedResources(zip, onProgress = () => {}, options = {}) {
	let successfulLayoutRemoval = false;
	let finalUsedLayouts = new Set();
	let finalUsedMasters = new Set();

	try {
		console.log('[Cleaner] Starting resource cleanup process...');

		const cleanOptions = {
			removeUnusedLayouts: options.removeUnusedLayouts !== false,
			cleanMediaInUnusedLayouts: options.cleanMediaInUnusedLayouts !== false,
			...options
		};

		onProgress('init', { percentage: 10, status: 'Analyzing presentation structure...' });
		const usedSlides = await getUsedSlides(zip);
		if (usedSlides.length === 0) {
			console.warn('[Cleaner] No used slides found in the presentation. Cleanup might be limited.');
		} else {
            console.log(`[Cleaner] Found ${usedSlides.length} slides marked as used in presentation.xml.rels.`);
        }

		if (cleanOptions.removeUnusedLayouts) {
			console.log('[Cleaner] Layout/master removal is enabled. Executing cleanup...');
			const layoutResult = await performLayoutRemoval(zip, onProgress);
			if (layoutResult.success) {
				console.log('[Cleaner] Layout/master cleanup step completed successfully.');
				successfulLayoutRemoval = true;
				finalUsedLayouts = layoutResult.usedLayouts instanceof Set ? layoutResult.usedLayouts : new Set();
				finalUsedMasters = layoutResult.usedMasters instanceof Set ? layoutResult.usedMasters : new Set();
			} else {
				console.error('[Cleaner] Layout/master cleanup step failed. Analyzing current state instead.');
				// Re-analyze to get the current state even if removal failed partially
				const analysisResult = await analyzeUsedLayoutsMasters(zip, usedSlides);
				finalUsedLayouts = analysisResult.usedLayouts instanceof Set ? analysisResult.usedLayouts : new Set();
				finalUsedMasters = analysisResult.usedMasters instanceof Set ? analysisResult.usedMasters : new Set();
			}
		} else {
			console.log('[Cleaner] Layout removal is disabled. Analyzing existing layouts/masters...');
			const analysisResult = await analyzeUsedLayoutsMasters(zip, usedSlides);
			finalUsedLayouts = analysisResult.usedLayouts instanceof Set ? analysisResult.usedLayouts : new Set();
			finalUsedMasters = analysisResult.usedMasters instanceof Set ? analysisResult.usedMasters : new Set();
		}

        console.log(`[Cleaner] Final analysis results - Used Layouts: ${finalUsedLayouts.size}, Used Masters: ${finalUsedMasters.size}`);


		onProgress('init', { percentage: 70, status: 'Analyzing media file usage...' });

		let layoutsMediaToKeep = new Set();
		const layoutsToCheckForMedia = [];
		if (cleanOptions.cleanMediaInUnusedLayouts && successfulLayoutRemoval) {
			// Only check *remaining* used layouts if cleanup was successful and option is enabled
			layoutsToCheckForMedia.push(...Array.from(finalUsedLayouts));
			console.log(`[Cleaner] Analyzing media from ${finalUsedLayouts.size} remaining used layouts.`);
		} else {
			// Check *all currently existing* layouts if cleanup was skipped, failed, or option disabled
			const currentLayoutFiles = Object.keys(zip.files)
				.filter(path => path.startsWith('ppt/slideLayouts/') &&
						path.endsWith('.xml') &&
						!path.includes('/_rels/'));
			layoutsToCheckForMedia.push(...currentLayoutFiles);
			if (successfulLayoutRemoval) {
                console.log(`[Cleaner] Analyzing media from all ${currentLayoutFiles.length} current layouts (option cleanMediaInUnusedLayouts is false).`);
            } else {
                console.log(`[Cleaner] Analyzing media from all ${currentLayoutFiles.length} current layouts (layout removal was skipped or failed).`);
            }
		}
		layoutsMediaToKeep = await getMediaFromLayouts(zip, layoutsToCheckForMedia);


		const usedMedia = await collectUsedMedia(zip, usedSlides, finalUsedLayouts, finalUsedMasters, layoutsMediaToKeep);

		const allMediaPaths = findMediaFiles(zip); // From media.js
		const unusedMediaPaths = allMediaPaths.filter(path => !usedMedia.has(path));
		console.log('[Cleaner] Media Usage Summary:', {
            totalFound: allMediaPaths.length,
            identifiedAsUsed: usedMedia.size,
            identifiedAsUnused: unusedMediaPaths.length
        });


		await removeUnusedMedia(zip, usedMedia);


		onProgress('init', { percentage: 95, status: 'Updating content types...' });
		await updateContentTypes(zip);

		console.log('[Cleaner] Resource cleanup process finished.');
		return true; // Indicate overall success (individual steps might have warnings)
	} catch (error) {
		console.error('[Cleaner] Critical error during resource cleanup:', error.message, error.stack);
		onProgress('error', { message: `Cleanup failed: ${error.message}` });
		return false; // Indicate overall failure
	}
}

async function getMediaFromLayouts(zip, layoutPaths) {
	const mediaSet = new Set();
	if (!layoutPaths || layoutPaths.length === 0) {
		console.log('[getMediaFromLayouts] No layout paths provided to check for media.');
		return mediaSet;
	}
	try {
		for (const layoutPath of layoutPaths) {
			// Derive the relationship file path relative to the layout file
            // e.g., ppt/slideLayouts/slideLayout1.xml -> ppt/slideLayouts/_rels/slideLayout1.xml.rels
			const layoutRelsPath = layoutPath.replace(/^(.*\/slideLayouts\/)([^/]+)$/, '$1_rels/$2.rels');
			const layoutRelsFile = zip.file(layoutRelsPath);
			if (!layoutRelsFile) continue; // No rels file exists for this layout

			const layoutRelsXml = await layoutRelsFile.async('string');
			if (!layoutRelsXml) continue;

			const layoutRelsObj = await parseXml(layoutRelsXml); // Use updated parser
			// Check for parse failure or absence of the expected structure
			if (layoutRelsObj._parseFailed || !layoutRelsObj?.Relationships?.Relationship) continue;

			// Ensure 'Relationship' is treated as an array, even if there's only one
            const relationships = Array.isArray(layoutRelsObj.Relationships.Relationship)
                ? layoutRelsObj.Relationships.Relationship
                : [layoutRelsObj.Relationships.Relationship];

			for (const rel of relationships) {
                if (!rel) continue; // Skip potentially null/undefined entries if array handling was imperfect
				const relType = rel['@_Type']; // Use attribute prefix from parser config
				const target = rel['@_Target'];
				// Check if the relationship type indicates media and a target exists
				if (relType && target && (relType.includes('/image') || relType.includes('/audio') || relType.includes('/video'))) {
					const mediaPath = resolveTargetPath(layoutRelsPath, target);
					if (mediaPath) mediaSet.add(mediaPath);
				}
			}
		}
		console.log(`[getMediaFromLayouts] Found ${mediaSet.size} unique media files referenced by ${layoutPaths.length} analyzed layouts.`);
	} catch (error) {
		console.error('[getMediaFromLayouts] Error getting media from layouts:', error.message);
	}
	return mediaSet;
}

async function collectUsedMedia(zip, usedSlides, usedLayouts, usedMasters, initialMedia = new Set()) {
	const usedMedia = new Set(initialMedia);
	const startTime = performance.now();

	try {
		console.log(`[collectUsedMedia] Starting media collection. Initial count: ${initialMedia.size}. Analyzing ${usedSlides.length} slides, ${usedLayouts.size} layouts, ${usedMasters.size} masters.`);

		// Process relationships specific to the used slides, layouts, and masters
		await processRelationshipFiles(zip, usedSlides, usedLayouts, usedMasters, usedMedia);

        // Also check theme relationship files for media (e.g., background images)
        const themeRelsFiles = Object.keys(zip.files).filter(p => p.match(/^ppt\/theme\/_rels\/theme\d+\.xml\.rels$/));
        await processGenericRelationshipFiles(zip, themeRelsFiles, usedMedia, "theme");

		const duration = performance.now() - startTime;
		console.log(`[collectUsedMedia] Media collection finished in ${duration.toFixed(0)} ms. Final count: ${usedMedia.size}`);

	} catch (error) {
		console.error('[collectUsedMedia] Error collecting used media files:', error.message);
	}

	return usedMedia;
}

// Helper function to resolve target paths relative to the .rels file location
function resolveTargetPath(relsPath, target) {
    if (!target || typeof target !== 'string') return null;
    try {
        // Directory containing the .rels file (e.g., ppt/slides/_rels)
        const relsDir = relsPath.substring(0, relsPath.lastIndexOf('/'));
        // Base directory for the related XML file (e.g., ppt/slides)
        const baseDir = relsDir.substring(0, relsDir.lastIndexOf('/'));

        let resolvedPath;
        if (target.startsWith('../')) {
            // Path is relative to the parent of baseDir (e.g., ../media/image1.png relative to ppt/slides -> ppt/media/image1.png)
            const parentDir = baseDir.substring(0, baseDir.lastIndexOf('/')); // e.g., ppt
            // Construct path by taking parent dir and appending the target part after '../'
            resolvedPath = parentDir + '/' + target.substring(target.indexOf('/') + 1);
        } else if (target.startsWith('/')) {
             // Absolute path within the package (e.g., /ppt/media/image1.png) - remove leading slash
             resolvedPath = target.substring(1);
        } else {
            // Path is relative to the baseDir (e.g., media/image1.png relative to ppt/slides -> ppt/slides/media/image1.png)
            // This case is less common for media but possible. More common: target IS ../media/...
            // Let's assume targets like "media/image.png" should be relative to the parent (ppt) like ../media/image.png
            // If target doesn't start with ../ assume it's relative to parent of baseDir
             const parentDir = baseDir.substring(0, baseDir.lastIndexOf('/')); // e.g., ppt
             resolvedPath = parentDir + '/' + target;
            // Original stricter interpretation (relative to baseDir): resolvedPath = baseDir + '/' + target;
        }

        // Normalize path separators and remove potential double slashes
        return resolvedPath.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
    } catch (e) {
        console.error(`[resolveTargetPath] Error resolving target "${target}" relative to "${relsPath}": ${e.message}`);
        // Return null or the original target? Returning null is safer.
        return null;
    }
}


async function processRelationshipFiles(zip, usedSlides, usedLayouts, usedMasters, usedMedia) {
    // Generate paths for .rels files corresponding to used slides, layouts, and masters
    const slideRelsFiles = usedSlides.map(slide => slide.path.replace(/^(.*\/slides\/)([^/]+)$/, '$1_rels/$2.rels'));
    const layoutRelsFiles = Array.from(usedLayouts).map(layout => layout.replace(/^(.*\/slideLayouts\/)([^/]+)$/, '$1_rels/$2.rels'));
    const masterRelsFiles = Array.from(usedMasters).map(master => master.replace(/^(.*\/slideMasters\/)([^/]+)$/, '$1_rels/$2.rels'));

    // Combine and deduplicate the list of .rels files to check
    const relsFilesToCheck = Array.from(new Set([
        ...slideRelsFiles,
        ...layoutRelsFiles,
        ...masterRelsFiles,
    ])).filter(path => zip.file(path)); // Ensure the .rels file actually exists in the zip

    console.log(`[processRelationshipFiles] Analyzing ${relsFilesToCheck.length} relationship files for slides/layouts/masters.`);
    // Process these files using the generic relationship processor
    await processGenericRelationshipFiles(zip, relsFilesToCheck, usedMedia, "slide/layout/master");
}

// Generic function to process a list of relationship files and add media targets to the usedMedia set
async function processGenericRelationshipFiles(zip, relsFilePaths, usedMedia, context = "generic") {
     await Promise.all(relsFilePaths.map(async (relsPath) => {
        try {
            const relsXml = await zip.file(relsPath)?.async('string');
            if (!relsXml) return; // Skip if file doesn't exist or is empty

            const relsObj = await parseXml(relsXml); // Use updated parser
             // Skip if parsing failed or the basic structure is missing
             if (relsObj._parseFailed || !relsObj?.Relationships?.Relationship) return;

            // Ensure Relationship is treated as an array
            const relationships = Array.isArray(relsObj.Relationships.Relationship)
                ? relsObj.Relationships.Relationship
                : [relsObj.Relationships.Relationship];

            relationships.forEach(rel => {
                if (!rel) return; // Skip invalid entries
                const relType = rel['@_Type'];
                const target = rel['@_Target'];
                const targetMode = rel['@_TargetMode']; // Check if it's an external link

                // Check for various media types and ensure it's not an external resource
                if (relType && target && targetMode !== 'External' && (
                    relType.includes('/image') ||
                    relType.includes('/audio') ||
                    relType.includes('/video') ||
                    relType.includes('/media') || // Catch generic media
                    relType.includes('/oleObject') // Potentially embedded media
                )) {
                    const resolvedPath = resolveTargetPath(relsPath, target);
                    // Add the resolved path if it's valid and not already present
                    if (resolvedPath && !usedMedia.has(resolvedPath)) {
                         // console.log(`[processRelationshipFiles] Adding used media (${context}): ${resolvedPath} (from ${relsPath})`);
                         usedMedia.add(resolvedPath);
                    } else if (!resolvedPath) {
                        console.warn(`[processRelationshipFiles] Could not resolve target path for "${target}" in ${relsPath}`);
                    }
                }
            });
        } catch (error) {
            console.error(`[processRelationshipFiles] Error processing ${context} relationship file ${relsPath}:`, error.message);
        }
    }));
}


// Function to get the list of slides referenced in the main presentation relationships
async function getUsedSlides(zip) {
	try {
		const relsPath = 'ppt/_rels/presentation.xml.rels';
		const relsFile = zip.file(relsPath);
		if (!relsFile) {
			console.warn('[getUsedSlides] Presentation relationships file not found:', relsPath);
			return [];
		}
		const relsXml = await relsFile.async('string');
		if (!relsXml) return [];

		const relsObj = await parseXml(relsXml); // Use updated parser
		if (relsObj._parseFailed || !relsObj?.Relationships?.Relationship) return [];

		// Ensure Relationship is an array
		const relationships = Array.isArray(relsObj.Relationships.Relationship)
			? relsObj.Relationships.Relationship
			: [relsObj.Relationships.Relationship];

		const slides = relationships
            // Filter for relationships of type 'slide'
			.filter(rel => {
                if (!rel) return false;
				const relType = rel['@_Type'];
				return relType === 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide';
			})
            // Map to an object containing rId and resolved path
			.map(rel => {
				const target = rel['@_Target'];
				const resolvedPath = target ? resolveTargetPath(relsPath, target) : null;
				return {
					rId: rel['@_Id'],
					path: resolvedPath
				};
			})
            // Filter out entries where path resolution failed or the target file doesn't exist
			.filter(slide => slide.path !== null && zip.file(slide.path));

		console.log(`[getUsedSlides] Found ${slides.length} valid slide relationships in presentation.xml.rels.`);
		return slides;
	} catch (error) {
		console.error('[getUsedSlides] Error getting used slides:', error.message);
		return [];
	}
}


// Function to remove media files not present in the usedMedia set
async function removeUnusedMedia(zip, usedMedia) {
	try {
		const allMediaPaths = findMediaFiles(zip); // Get all files currently in ppt/media/
		console.log(`[removeUnusedMedia] Checking media usage. Total files in ${MEDIA_PATH_PREFIX}: ${allMediaPaths.length}. Used count: ${usedMedia.size}`);

		// Sanity check: Verify that all 'used' media files actually exist in the zip
		const missingMedia = [];
		for (const mediaPath of usedMedia) {
			if (!zip.file(mediaPath)) {
				console.warn(`[removeUnusedMedia] Referenced media file not found in ZIP: ${mediaPath}`);
				missingMedia.push(mediaPath);
			}
		}
		// Remove non-existent files from the 'used' set
		missingMedia.forEach(path => usedMedia.delete(path));
		if (missingMedia.length > 0) {
			console.log(`[removeUnusedMedia] Adjusted used media count after existence check: ${usedMedia.size}`);
		}

		// Determine which media files are unused
		const unusedMediaPaths = allMediaPaths.filter(path => !usedMedia.has(path));
		console.log(`[removeUnusedMedia] Identified ${unusedMediaPaths.length} unused media files for potential removal.`);

		// Apply safety checks before removing files
		if (shouldSkipMediaRemoval(allMediaPaths.length, unusedMediaPaths.length, usedMedia.size)) {
			console.warn('[removeUnusedMedia] Skipping media removal due to safety checks.');
			return; // Exit without removing if checks fail
		}

		let removedCount = 0;
		let failedToRemoveCount = 0;
		// Iterate through unused paths and remove them
		for (const mediaPath of unusedMediaPaths) {
			try {
				zip.remove(mediaPath);
				removedCount++;
				// console.log(`[removeUnusedMedia] Removed: ${mediaPath}`);
			} catch (removeError) {
                failedToRemoveCount++;
				console.error(`[removeUnusedMedia] Error removing media file ${mediaPath}:`, removeError.message);
			}
		}

        // Log summary of removal operation
        if (removedCount > 0) {
		    console.log(`[removeUnusedMedia] Successfully removed ${removedCount} unused media files.`);
        }
        if (failedToRemoveCount > 0) {
            console.warn(`[removeUnusedMedia] Failed to remove ${failedToRemoveCount} unused media files.`);
        }
        if (removedCount === 0 && failedToRemoveCount === 0 && unusedMediaPaths.length > 0) {
            console.log(`[removeUnusedMedia] Identified ${unusedMediaPaths.length} unused media files, but none were removed (check logs).`);
        }
        if (unusedMediaPaths.length === 0) {
             console.log(`[removeUnusedMedia] No unused media files found to remove.`);
        }

		// Log the number of media files remaining after the operation
		const remainingMedia = findMediaFiles(zip).length;
		console.log(`[removeUnusedMedia] Remaining media files after removal attempt: ${remainingMedia}`);

	} catch (error) {
		console.error('[removeUnusedMedia] Error during unused media removal process:', error.message);
	}
}

// Safety checks to prevent accidental removal of too many media files
function shouldSkipMediaRemoval(totalCount, unusedCount, usedCount) {
	// No need to skip if there's nothing to remove or no media files at all
	if (totalCount === 0 || unusedCount <= 0) {
		return false;
	}

    // Safety Check 1: Avoid removing ALL media if some were initially identified as used.
    // This suggests a potential failure in the usage detection logic.
	if (unusedCount === totalCount && usedCount > 0) {
        console.warn(`[shouldSkipMediaRemoval] Safety Check Triggered: Attempting to remove ALL (${totalCount}) media files, but ${usedCount} were initially marked as used. This might indicate an error in usage detection. Skipping removal.`);
		return true;
	}
    // Allow removing all media only if *none* were identified as used (e.g., empty presentation with default theme media)
    if (unusedCount === totalCount && usedCount === 0) {
        console.log(`[shouldSkipMediaRemoval] Note: Removing all ${totalCount} media files as none were identified as used.`);
        return false; // Allow removal
    }

	// Safety Check 2: Avoid removing a very high percentage if the total number is significant.
	const removalPercentage = (unusedCount / totalCount) * 100;
	const highPercentageThreshold = 95; // Don't remove 95% or more
    const significantTotalCount = 10; // Apply this check only if there are at least 10 media files

	if (totalCount >= significantTotalCount && removalPercentage >= highPercentageThreshold) {
		console.warn(`[shouldSkipMediaRemoval] Safety Check Triggered: Attempting to remove ${removalPercentage.toFixed(0)}% (${unusedCount}/${totalCount}) of media files. Threshold is ${highPercentageThreshold}%. Skipping removal.`);
		return true;
	}

	// If none of the safety checks triggered, proceed with removal
	return false;
}


// Function to update the [Content_Types].xml file after resources have been removed
async function updateContentTypes(zip) {
	const contentTypesPath = '[Content_Types].xml';
	try {
		console.log('[updateContentTypes] Updating content types...');
		const contentTypesFile = zip.file(contentTypesPath);
		if (!contentTypesFile) {
			console.warn('[updateContentTypes] Content types file not found:', contentTypesPath);
			return;
		}

		const contentTypesXml = await contentTypesFile.async('string');
		if (!contentTypesXml) {
			console.warn('[updateContentTypes] Content types file is empty.');
			return;
		}

		let contentTypesObj;
		try {
			contentTypesObj = await parseXml(contentTypesXml); // Use updated parser
			// Basic validation of the parsed structure
			if (contentTypesObj._parseFailed || !contentTypesObj?.Types) {
				throw new Error('Invalid content types structure: parsing failed or missing <Types> node.');
			}
		} catch (parseError) {
			console.error('[updateContentTypes] Error parsing content types XML:', parseError.message);
			return; // Stop if parsing fails
		}

		let changed = false;
		let removedOverrideCount = 0;
        let removedDefaultCount = 0;

		// Process <Override> elements
		if (contentTypesObj.Types.Override) {
            // Ensure Override is treated as an array
			const overrides = Array.isArray(contentTypesObj.Types.Override)
				? contentTypesObj.Types.Override
				: [contentTypesObj.Types.Override];
			const initialCount = overrides.length;

            // Filter overrides, keeping only those where the PartName corresponds to an existing file
			const filteredOverrides = overrides.filter(override => {
				if (!override) return false; // Skip invalid entries
				const partName = override['@_PartName']; // Use attribute prefix
				if (!partName || typeof partName !== 'string') {
					console.warn('[updateContentTypes] Override missing or invalid PartName attribute:', JSON.stringify(override).substring(0, 100));
					return false; // Remove invalid overrides
				}
                // Construct the file path (remove leading '/' if present)
				const filePath = partName.startsWith('/') ? partName.substring(1) : partName;
				// Check if the file exists in the zip archive
				const fileExists = zip.file(filePath) !== null;
                if (!fileExists) {
                   // console.log(`[updateContentTypes] Removing Override for non-existent file: ${filePath}`);
                }
				return fileExists; // Keep only if file exists
			});

			const finalCount = filteredOverrides.length;
			// If overrides were removed, update the object
			if (finalCount < initialCount) {
                // If all overrides of this type are removed, set to undefined so the builder might omit the node
				contentTypesObj.Types.Override = finalCount > 0 ? filteredOverrides : undefined;
                removedOverrideCount = initialCount - finalCount;
				changed = true;
			}
		}

        // Process <Default> elements (Optional but good practice)
        if (contentTypesObj.Types.Default) {
            // Ensure Default is treated as an array
             const defaults = Array.isArray(contentTypesObj.Types.Default)
				? contentTypesObj.Types.Default
				: [contentTypesObj.Types.Default];
            const initialCount = defaults.length;

            // Filter defaults, keeping only those where at least one file with that extension exists
            const filteredDefaults = defaults.filter(def => {
                if (!def) return false; // Skip invalid entries
                const extension = def['@_Extension'];
                if (!extension || typeof extension !== 'string') {
                    console.warn('[updateContentTypes] Default missing or invalid Extension attribute:', JSON.stringify(def).substring(0, 100));
					return false; // Remove invalid defaults
                }
                // Create a regex to test for the file extension (case-insensitive)
                const extensionPattern = new RegExp(`\\.${extension}$`, 'i');
                // Check if *any* file in the zip matches this extension
                const exists = Object.keys(zip.files).some(path => !zip.files[path].dir && extensionPattern.test(path));
                 if (!exists) {
                    // console.log(`[updateContentTypes] Removing Default for unused extension: ${extension}`);
                 }
                return exists; // Keep only if at least one file uses the extension
            });

            const finalCount = filteredDefaults.length;
            // If defaults were removed, update the object
            if (finalCount < initialCount) {
                // If all defaults of this type are removed, set to undefined
                contentTypesObj.Types.Default = finalCount > 0 ? filteredDefaults : undefined;
                removedDefaultCount = initialCount - finalCount;
                changed = true;
            }
        }


		// If any changes were made, rebuild and save the [Content_Types].xml file
		if (changed) {
			try {
				const updatedContentTypesXml = buildXml(contentTypesObj); // Use updated builder
				zip.file(contentTypesPath, updatedContentTypesXml);
				console.log(`[updateContentTypes] Successfully updated [Content_Types].xml (Removed ${removedOverrideCount} Overrides, ${removedDefaultCount} Defaults).`);
			} catch (buildError) {
				console.error('[updateContentTypes] Error building updated content types XML:', buildError.message);
                // Avoid leaving the zip in a potentially inconsistent state if build fails
                // Revert? Or just log the error? Logging for now.
			}
		} else {
			console.log('[updateContentTypes] No changes needed for content types.');
		}
	} catch (error) {
		console.error('[updateContentTypes] Error updating content types:', error.message);
	}
}

