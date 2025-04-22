import { parseXml, buildXml } from './xml/parser';
import { PRESENTATION_PATH, MEDIA_PATH_PREFIX, SLIDE_LAYOUT_PREFIX, SLIDE_MASTER_PREFIX } from './constants';
import {
	removeUnusedLayouts as performLayoutRemoval,
	getLayoutMaster,
	getUsedLayoutsAndMasters as analyzeUsedLayoutsMasters
} from './layout-cleaner';
import { findMediaFiles } from './media';

function resolvePathUtil(basePath, target) {
    if (!target || typeof target !== 'string') return null;
    try {
        const baseDir = basePath.substring(0, basePath.lastIndexOf('/'));
        let resolvedPath;
        if (target.startsWith('../')) {
            const xmlFileDir = baseDir.endsWith('/_rels') ? baseDir.substring(0, baseDir.lastIndexOf('/_rels')) : baseDir;
            let currentParent = xmlFileDir;
            let remainingTarget = target;
            while (remainingTarget.startsWith('../')) {
                const lastSlashIndex = currentParent.lastIndexOf('/');
                if (lastSlashIndex <= 0) {
                    console.error(`[resolvePathUtil] Cannot go up from "${currentParent}" for target "${target}" in "${basePath}"`);
                    return null;
                }
                remainingTarget = remainingTarget.substring(3);
                currentParent = currentParent.substring(0, lastSlashIndex);
            }
            resolvedPath = currentParent + '/' + remainingTarget;
        } else if (target.startsWith('/')) {
             resolvedPath = target.substring(1);
        } else {
             const xmlFileDir = baseDir.endsWith('/_rels') ? baseDir.substring(0, baseDir.lastIndexOf('/_rels')) : baseDir;
             resolvedPath = xmlFileDir + '/' + target;
        }
        return resolvedPath.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/\.\//g, '/');
    } catch (e) {
        console.error(`[resolvePathUtil] Error resolving target "${target}" relative to "${basePath}": ${e.message}`);
        return null;
    }
}

function resolveTargetPath(basePath, target) {
    return resolvePathUtil(basePath, target);
}


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
		console.log(`[DEBUG] cleaner.js: usedSlides = ${JSON.stringify(usedSlides)}`);

		if (cleanOptions.removeUnusedLayouts) {
			console.log('[Cleaner] Layout/master removal is enabled. Executing cleanup...');
			const layoutResult = await performLayoutRemoval(zip, usedSlides, onProgress);
			console.log(`[DEBUG] cleaner.js: layoutResult from performLayoutRemoval = ${JSON.stringify({success: layoutResult.success, layouts: Array.from(layoutResult.usedLayouts), masters: Array.from(layoutResult.usedMasters)})}`);
			if (layoutResult.success) {
				console.log('[Cleaner] Layout/master cleanup step completed successfully.');
				successfulLayoutRemoval = true;
				finalUsedLayouts = layoutResult.usedLayouts instanceof Set ? layoutResult.usedLayouts : new Set();
				finalUsedMasters = layoutResult.usedMasters instanceof Set ? layoutResult.usedMasters : new Set();
			} else {
				console.error('[Cleaner] Layout/master cleanup step failed. Analyzing current state instead.');
				const analysisResult = await analyzeUsedLayoutsMasters(zip, usedSlides);
                console.log(`[DEBUG] cleaner.js: analysisResult after failed removal = ${JSON.stringify({layouts: Array.from(analysisResult.usedLayouts), masters: Array.from(analysisResult.usedMasters)})}`);
				finalUsedLayouts = analysisResult.usedLayouts instanceof Set ? analysisResult.usedLayouts : new Set();
				finalUsedMasters = analysisResult.usedMasters instanceof Set ? analysisResult.usedMasters : new Set();
			}
		} else {
			console.log('[Cleaner] Layout removal is disabled. Analyzing existing layouts/masters...');
			const analysisResult = await analyzeUsedLayoutsMasters(zip, usedSlides);
            console.log(`[DEBUG] cleaner.js: analysisResult (removal disabled) = ${JSON.stringify({layouts: Array.from(analysisResult.usedLayouts), masters: Array.from(analysisResult.usedMasters)})}`);
			finalUsedLayouts = analysisResult.usedLayouts instanceof Set ? analysisResult.usedLayouts : new Set();
			finalUsedMasters = analysisResult.usedMasters instanceof Set ? analysisResult.usedMasters : new Set();
		}

        console.log(`[Cleaner] Final analysis results - Used Layouts: ${finalUsedLayouts.size}, Used Masters: ${finalUsedMasters.size}`);
        console.log(`[DEBUG] cleaner.js: Final Layouts = ${JSON.stringify(Array.from(finalUsedLayouts))}`);
        console.log(`[DEBUG] cleaner.js: Final Masters = ${JSON.stringify(Array.from(finalUsedMasters))}`);


		onProgress('init', { percentage: 70, status: 'Analyzing media file usage...' });

		let layoutsMediaToKeep = new Set();
		const layoutsToCheckForMedia = [];
		if (cleanOptions.cleanMediaInUnusedLayouts && successfulLayoutRemoval && finalUsedLayouts.size > 0) {
			layoutsToCheckForMedia.push(...Array.from(finalUsedLayouts));
			console.log(`[Cleaner] Analyzing media from ${finalUsedLayouts.size} remaining used layouts.`);
		} else {
			const currentLayoutFiles = Object.keys(zip.files)
				.filter(path => path.startsWith(SLIDE_LAYOUT_PREFIX) &&
						path.endsWith('.xml') &&
						!path.includes('/_rels/'));
			layoutsToCheckForMedia.push(...currentLayoutFiles);
			if (finalUsedLayouts.size === 0 && usedSlides.length > 0) {
                 console.warn(`[Cleaner] Analyzing media from all ${currentLayoutFiles.length} layouts because layout analysis yielded zero results despite having slides.`);
            } else if (successfulLayoutRemoval) {
                console.log(`[Cleaner] Analyzing media from all ${currentLayoutFiles.length} current layouts (option cleanMediaInUnusedLayouts is false or no used layouts found).`);
            } else {
                console.log(`[Cleaner] Analyzing media from all ${currentLayoutFiles.length} current layouts (layout removal was skipped or failed).`);
            }
		}
		layoutsMediaToKeep = await getMediaFromLayouts(zip, layoutsToCheckForMedia);


        console.log(`[DEBUG] cleaner.js: Calling collectUsedMedia with slides=${usedSlides.length}, layouts=${finalUsedLayouts.size}, masters=${finalUsedMasters.size}, initialMedia=${layoutsMediaToKeep.size}`);
		const usedMedia = await collectUsedMedia(zip, usedSlides, finalUsedLayouts, finalUsedMasters, layoutsMediaToKeep);

		const allMediaPaths = findMediaFiles(zip);
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
		return true;
	} catch (error) {
		console.error('[Cleaner] Critical error during resource cleanup:', error.message, error.stack);
		onProgress('error', { message: `Cleanup failed: ${error.message}` });
		return false;
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
			const layoutRelsPath = layoutPath.replace(/^(.*\/slideLayouts\/)([^/]+)$/, '$1_rels/$2.rels');
			const layoutRelsFile = zip.file(layoutRelsPath);
			if (!layoutRelsFile) continue;

			const layoutRelsXml = await layoutRelsFile.async('string');
			if (!layoutRelsXml) continue;

			const layoutRelsObj = await parseXml(layoutRelsXml);
			if (layoutRelsObj._parseFailed || !layoutRelsObj?.Relationships?.Relationship) continue;

            const relationships = Array.isArray(layoutRelsObj.Relationships.Relationship)
                ? layoutRelsObj.Relationships.Relationship
                : [layoutRelsObj.Relationships.Relationship];

			for (const rel of relationships) {
                if (!rel) continue;
				const relType = rel['@_Type'];
				const target = rel['@_Target'];
                const targetMode = rel['@_TargetMode'];
				if (relType && target && targetMode !== 'External' && (relType.includes('/image') || relType.includes('/audio') || relType.includes('/video'))) {
					const mediaPath = resolveTargetPath(layoutRelsPath, target);
					if (mediaPath) {
                        mediaSet.add(mediaPath);
                    } else {
                         console.warn(`[getMediaFromLayouts] Could not resolve media target "${target}" in ${layoutRelsPath}`);
                    }
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

		await processRelationshipFiles(zip, usedSlides, usedLayouts, usedMasters, usedMedia);

        const themeRelsFiles = Object.keys(zip.files).filter(p => p.match(/^ppt\/theme\/_rels\/theme\d+\.xml\.rels$/));
        await processGenericRelationshipFiles(zip, themeRelsFiles, usedMedia, "theme");

		const duration = performance.now() - startTime;
		console.log(`[collectUsedMedia] Media collection finished in ${duration.toFixed(0)} ms. Final count: ${usedMedia.size}`);

	} catch (error) {
		console.error('[collectUsedMedia] Error collecting used media files:', error.message);
	}

	return usedMedia;
}


async function processRelationshipFiles(zip, usedSlides, usedLayouts, usedMasters, usedMedia) {
    const slideRelsFiles = usedSlides.map(slide => slide.path.replace(/^(.*\/slides\/)([^/]+)$/, '$1_rels/$2.rels'));
    const layoutRelsFiles = Array.from(usedLayouts).map(layout => layout.replace(/^(.*\/slideLayouts\/)([^/]+)$/, '$1_rels/$2.rels'));
    const masterRelsFiles = Array.from(usedMasters).map(master => master.replace(/^(.*\/slideMasters\/)([^/]+)$/, '$1_rels/$2.rels'));

    const relsFilesToCheck = Array.from(new Set([
        ...slideRelsFiles,
        ...layoutRelsFiles,
        ...masterRelsFiles,
    ])).filter(path => zip.file(path));

    console.log(`[processRelationshipFiles] Analyzing ${relsFilesToCheck.length} relationship files for slides/layouts/masters.`);
    await processGenericRelationshipFiles(zip, relsFilesToCheck, usedMedia, "slide/layout/master");
}

async function processGenericRelationshipFiles(zip, relsFilePaths, usedMedia, context = "generic") {
     await Promise.all(relsFilePaths.map(async (relsPath) => {
        try {
            const relsXml = await zip.file(relsPath)?.async('string');
            if (!relsXml) return;

            const relsObj = await parseXml(relsXml);
             if (relsObj._parseFailed || !relsObj?.Relationships?.Relationship) return;

            const relationships = Array.isArray(relsObj.Relationships.Relationship)
                ? relsObj.Relationships.Relationship
                : [relsObj.Relationships.Relationship];

            relationships.forEach(rel => {
                if (!rel) return;
                const relType = rel['@_Type'];
                const target = rel['@_Target'];
                const targetMode = rel['@_TargetMode'];

                if (relType && target && targetMode !== 'External' && (
                    relType.includes('/image') ||
                    relType.includes('/audio') ||
                    relType.includes('/video') ||
                    relType.includes('/media') ||
                    relType.includes('/oleObject')
                )) {
                    const resolvedPath = resolveTargetPath(relsPath, target);
                    if (resolvedPath && !usedMedia.has(resolvedPath)) {
                         usedMedia.add(resolvedPath);
                    } else if (!resolvedPath) {
                        console.warn(`[processRelationshipFiles] Could not resolve target path for "${target}" in ${relsPath}`);
                    }
                }
            });
        } catch (error) {
            console.error(`[processGenericRelationshipFiles] Error processing ${context} relationship file ${relsPath}:`, error.message);
        }
    }));
}


async function getUsedSlides(zip) {
	try {
		const relsPath = 'ppt/_rels/presentation.xml.rels';
		const relsFile = zip.file(relsPath);
		if (!relsFile) {
			console.warn('[getUsedSlides] Presentation relationships file not found:', relsPath);
			return [];
		}
		const relsXml = await relsFile.async('string');
		if (!relsXml) {
            console.warn('[getUsedSlides] Presentation relationships file is empty:', relsPath);
            return [];
        }

		const relsObj = await parseXml(relsXml);
		if (relsObj._parseFailed || !relsObj?.Relationships?.Relationship) {
            console.warn('[getUsedSlides] Failed to parse relationships or no relationships found in:', relsPath, relsObj._error || '');
            return [];
        }

		const relationships = Array.isArray(relsObj.Relationships.Relationship)
			? relsObj.Relationships.Relationship
			: [relsObj.Relationships.Relationship];

		const slides = relationships
			.filter(rel => rel?.['@_Type'] === 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide')
			.map(rel => {
				const target = rel['@_Target'];
				const resolvedPath = target ? resolveTargetPath(relsPath, target) : null;
                if (!resolvedPath && target) {
                    console.warn(`[getUsedSlides] Failed to resolve path for target "${target}" in ${relsPath}`);
                }
				return {
					rId: rel['@_Id'],
					path: resolvedPath
				};
			})
			.filter(slide => {
                const fileExists = slide.path !== null && zip.file(slide.path) !== null;
                if (slide.path && !fileExists) {
                     console.warn(`[getUsedSlides] Resolved slide path "${slide.path}" does not exist in ZIP.`);
                }
                return fileExists;
            });

		console.log(`[getUsedSlides] Found ${slides.length} valid slide relationships in presentation.xml.rels.`);
		return slides;
	} catch (error) {
		console.error('[getUsedSlides] Error getting used slides:', error.message);
		return [];
	}
}


async function removeUnusedMedia(zip, usedMedia) {
	try {
		const allMediaPaths = findMediaFiles(zip);
		console.log(`[removeUnusedMedia] Checking media usage. Total files in ${MEDIA_PATH_PREFIX}: ${allMediaPaths.length}. Used count: ${usedMedia.size}`);

		const missingMedia = [];
		for (const mediaPath of usedMedia) {
			if (!zip.file(mediaPath)) {
				console.warn(`[removeUnusedMedia] Referenced media file not found in ZIP: ${mediaPath}`);
				missingMedia.push(mediaPath);
			}
		}
		missingMedia.forEach(path => usedMedia.delete(path));
		if (missingMedia.length > 0) {
			console.log(`[removeUnusedMedia] Adjusted used media count after existence check: ${usedMedia.size}`);
		}

		const unusedMediaPaths = allMediaPaths.filter(path => !usedMedia.has(path));
		console.log(`[removeUnusedMedia] Identified ${unusedMediaPaths.length} unused media files for potential removal.`);

		if (shouldSkipMediaRemoval(allMediaPaths.length, unusedMediaPaths.length, usedMedia.size)) {
			console.warn('[removeUnusedMedia] Skipping media removal due to safety checks.');
			return;
		}

		let removedCount = 0;
		let failedToRemoveCount = 0;
		for (const mediaPath of unusedMediaPaths) {
			try {
				zip.remove(mediaPath);
				removedCount++;
			} catch (removeError) {
                failedToRemoveCount++;
				console.error(`[removeUnusedMedia] Error removing media file ${mediaPath}:`, removeError.message);
			}
		}

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

		const remainingMedia = findMediaFiles(zip).length;
		console.log(`[removeUnusedMedia] Remaining media files after removal attempt: ${remainingMedia}`);

	} catch (error) {
		console.error('[removeUnusedMedia] Error during unused media removal process:', error.message);
	}
}

function shouldSkipMediaRemoval(totalCount, unusedCount, usedCount) {
	if (totalCount === 0 || unusedCount <= 0) {
		return false;
	}

	if (unusedCount === totalCount && usedCount > 0) {
        console.warn(`[shouldSkipMediaRemoval] Safety Check Triggered: Attempting to remove ALL (${totalCount}) media files, but ${usedCount} were initially marked as used. This might indicate an error in usage detection. Skipping removal.`);
		return true;
	}
    if (unusedCount === totalCount && usedCount === 0) {
        console.log(`[shouldSkipMediaRemoval] Note: Removing all ${totalCount} media files as none were identified as used.`);
        return false;
    }

	const removalPercentage = (unusedCount / totalCount) * 100;
	const highPercentageThreshold = 95;
    const significantTotalCount = 10;

	if (totalCount >= significantTotalCount && removalPercentage >= highPercentageThreshold) {
		console.warn(`[shouldSkipMediaRemoval] Safety Check Triggered: Attempting to remove ${removalPercentage.toFixed(0)}% (${unusedCount}/${totalCount}) of media files. Threshold is ${highPercentageThreshold}%. Skipping removal.`);
		return true;
	}

	return false;
}


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
			contentTypesObj = await parseXml(contentTypesXml);
			if (contentTypesObj._parseFailed || !contentTypesObj?.Types) {
				throw new Error('Invalid content types structure: parsing failed or missing <Types> node.');
			}
		} catch (parseError) {
			console.error('[updateContentTypes] Error parsing content types XML:', parseError.message);
			return;
		}

		let changed = false;
		let removedOverrideCount = 0;
        let removedDefaultCount = 0;

		if (contentTypesObj.Types.Override) {
			const overrides = Array.isArray(contentTypesObj.Types.Override)
				? contentTypesObj.Types.Override
				: [contentTypesObj.Types.Override];
			const initialCount = overrides.length;

			const filteredOverrides = overrides.filter(override => {
				if (!override) return false;
				const partName = override['@_PartName'];
				if (!partName || typeof partName !== 'string') {
					console.warn('[updateContentTypes] Override missing or invalid PartName attribute:', JSON.stringify(override).substring(0, 100));
					return false;
				}
				const filePath = partName.startsWith('/') ? partName.substring(1) : partName;
				const fileExists = zip.file(filePath) !== null;
                if (!fileExists) {
                }
				return fileExists;
			});

			const finalCount = filteredOverrides.length;
			if (finalCount < initialCount) {
				contentTypesObj.Types.Override = finalCount > 0 ? filteredOverrides : undefined;
                removedOverrideCount = initialCount - finalCount;
				changed = true;
			}
		}

        if (contentTypesObj.Types.Default) {
             const defaults = Array.isArray(contentTypesObj.Types.Default)
				? contentTypesObj.Types.Default
				: [contentTypesObj.Types.Default];
            const initialCount = defaults.length;

            const filteredDefaults = defaults.filter(def => {
                if (!def) return false;
                const extension = def['@_Extension'];
                if (!extension || typeof extension !== 'string') {
                    console.warn('[updateContentTypes] Default missing or invalid Extension attribute:', JSON.stringify(def).substring(0, 100));
					return false;
                }
                const cleanExtension = extension.startsWith('.') ? extension.substring(1) : extension;
                if (!cleanExtension) return false;
                const extensionPattern = new RegExp(`\\.${cleanExtension}$`, 'i');
                const exists = Object.keys(zip.files).some(path => !zip.files[path].dir && extensionPattern.test(path));
                 if (!exists) {
                 }
                return exists;
            });

            const finalCount = filteredDefaults.length;
            if (finalCount < initialCount) {
                contentTypesObj.Types.Default = finalCount > 0 ? filteredDefaults : undefined;
                removedDefaultCount = initialCount - finalCount;
                changed = true;
            }
        }


		if (changed) {
			try {
				const updatedContentTypesXml = buildXml(contentTypesObj);
				zip.file(contentTypesPath, updatedContentTypesXml);
				console.log(`[updateContentTypes] Successfully updated [Content_Types].xml (Removed ${removedOverrideCount} Overrides, ${removedDefaultCount} Defaults).`);
			} catch (buildError) {
				console.error('[updateContentTypes] Error building updated content types XML:', buildError.message);
			}
		} else {
			console.log('[updateContentTypes] No changes needed for content types.');
		}
	} catch (error) {
		console.error('[updateContentTypes] Error updating content types:', error.message);
	}
}
