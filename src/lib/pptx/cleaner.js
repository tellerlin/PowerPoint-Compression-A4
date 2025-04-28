import { parseXml, buildXml } from './xml/parser';
import { PRESENTATION_PATH, MEDIA_PATH_PREFIX, SLIDE_LAYOUT_PREFIX, SLIDE_MASTER_PREFIX } from './constants';
import { removeUnusedLayouts as performLayoutRemoval, getUsedLayoutsAndMasters as analyzeUsedLayoutsMasters, analyzeLayoutsAndMasters } from './layout-cleaner';
import { findMediaFiles } from './media';
import { resolvePath } from './utils';
import { parseXmlDOM } from './slides';

async function parseXmlDOMWithLog(zip, path) {
    try {
        const xml = await zip.file(path)?.async('string');
        if (!xml) {
            console.warn(`[parseXmlDOMWithLog] File is empty or not found: ${path}`);
            return null;
        }
        const parser = new DOMParser();
        const doc = parser.parseFromString(xml, 'application/xml');
        const parseError = doc.querySelector('parsererror');
        if (parseError) {
            console.error(`[parseXmlDOMWithLog] XML parse error: ${path}:`, parseError.textContent);
            const fallbackDoc = parser.parseFromString(xml, 'text/xml');
            const fallbackError = fallbackDoc.querySelector('parsererror');
            if (fallbackError) {
                console.error(`[parseXmlDOMWithLog] Fallback parse failed: ${path}`);
                return null;
            }
            console.warn(`[parseXmlDOMWithLog] Using text/xml fallback parse: ${path}`);
            return fallbackDoc;
        }
        return doc;
    } catch (error) {
        console.error(`[parseXmlDOMWithLog] Exception: ${path}:`, error.message);
        return null;
    }
}

export async function cleanUnusedResources(zip, onProgress, options) {
    let successfulLayoutRemoval = false;
    let finalUsedLayouts = new Set();
    let finalUsedMasters = new Set();
    try {
        console.log('[Cleaner] Starting resource cleanup process...');
        // 默认禁用布局删除
        const cleanOptions = { removeUnusedLayouts: false, ...options };
        onProgress('init', { percentage: 10, status: 'Analyzing presentation structure...' });
        const usedSlides = await getUsedSlides(zip);
        if (usedSlides.length === 0) {
            console.warn('[Cleaner] No used slides found in the presentation. Cleanup might be limited.');
        } else {
            console.log(`[Cleaner] Found ${usedSlides.length} slides marked as used in presentation.xml.rels.`);
        }
        console.log(`[DEBUG] cleaner.js: usedSlides = ${JSON.stringify(usedSlides.map(s => s.path))}`);
        
        // 无论选项如何，都只进行分析而不删除
        console.log('[Cleaner] Layout removal is disabled. Analyzing existing layouts/masters...');
        const analysisResult = await analyzeLayoutsAndMasters(zip, usedSlides, onProgress);
        console.log(`[DEBUG] cleaner.js: analysisResult = ${JSON.stringify({layouts: Array.from(analysisResult.usedLayouts), masters: Array.from(analysisResult.usedMasters)})}`);
        finalUsedLayouts = analysisResult.usedLayouts instanceof Set ? analysisResult.usedLayouts : new Set();
        finalUsedMasters = analysisResult.usedMasters instanceof Set ? analysisResult.usedMasters : new Set();
        
        console.log(`[Cleaner] Final analysis results - Used Layouts: ${finalUsedLayouts.size}, Used Masters: ${finalUsedMasters.size}`);
        console.log(`[DEBUG] cleaner.js: Final Layouts = ${JSON.stringify(Array.from(finalUsedLayouts))}`);
        console.log(`[DEBUG] cleaner.js: Final Masters = ${JSON.stringify(Array.from(finalUsedMasters))}`);
        onProgress('init', { percentage: 70, status: 'Analyzing media file usage...' });
        console.log(`[Cleaner] Calling collectUsedMedia with slides=${usedSlides.length}, layouts=${finalUsedLayouts.size}, masters=${finalUsedMasters.size}`);
        const usedMedia = await collectUsedMedia(zip, usedSlides, finalUsedLayouts, finalUsedMasters);
        const allMediaPaths = findMediaFiles(zip);
        const unusedMediaPaths = allMediaPaths.filter(path => !usedMedia.has(path));
        console.log('[Cleaner] Media Usage Summary:', { totalFound: allMediaPaths.length, identifiedAsUsed: usedMedia.size, identifiedAsUnused: unusedMediaPaths.length });
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

async function collectUsedMedia(zip, usedSlides, usedLayouts, usedMasters) {
    const usedMedia = new Set();
    const startTime = performance.now();
    try {
        console.log(`[collectUsedMedia] Starting media collection. Analyzing ${usedSlides.length} slides, ${usedLayouts.size} layouts, ${usedMasters.size} masters, and themes.`);
        await processRelationshipFiles(zip, usedSlides, usedLayouts, usedMasters, usedMedia);
        const themeRelsFiles = Object.keys(zip.files).filter(p => p.match(/^ppt\/theme\/_rels\/theme\d+\.xml\.rels$/));
        if (themeRelsFiles.length > 0) {
            console.log(`[collectUsedMedia] Analyzing ${themeRelsFiles.length} theme relationship files.`);
            await processGenericRelationshipFiles(zip, themeRelsFiles, usedMedia, "theme");
        } else {
            console.log(`[collectUsedMedia] No theme relationship files found (ppt/theme/_rels/theme*.xml.rels).`);
        }
        const duration = performance.now() - startTime;
        console.log(`[collectUsedMedia] Media collection finished in ${duration.toFixed(0)} ms. Final count: ${usedMedia.size}`);
    } catch (error) {
        console.error('[collectUsedMedia] Error collecting used media files:', error.message, error.stack);
    }
    return usedMedia;
}

async function processRelationshipFiles(zip, usedSlides, usedLayouts, usedMasters, usedMedia) {
    const slideRelsFiles = usedSlides.map(slide => slide.relsPath).filter(Boolean);
    const layoutRelsFiles = Array.from(usedLayouts).map(layoutPath => {
        const parts = layoutPath.split('/');
        const filename = parts.pop();
        const dir = parts.join('/');
        return `${dir}/_rels/${filename}.rels`;
    }).filter(Boolean);
    const masterRelsFiles = Array.from(usedMasters).map(masterPath => {
        const parts = masterPath.split('/');
        const filename = parts.pop();
        const dir = parts.join('/');
        return `${dir}/_rels/${filename}.rels`;
    }).filter(Boolean);
    const relsFilesToCheck = Array.from(new Set([...slideRelsFiles, ...layoutRelsFiles, ...masterRelsFiles])).filter(path => zip.file(path));
    console.log(`[processRelationshipFiles] Analyzing ${relsFilesToCheck.length} relationship files for used slides/layouts/masters.`);
    await processGenericRelationshipFiles(zip, relsFilesToCheck, usedMedia, "slide/layout/master");
}

async function processGenericRelationshipFiles(zip, relsFilePaths, usedMedia, context) {
    if (!relsFilePaths || relsFilePaths.length === 0) {
        return;
    }
    await Promise.all(relsFilePaths.map(async (relsPath) => {
        try {
            const relsDoc = await parseXmlDOMWithLog(zip, relsPath);
            if (!relsDoc) {
                console.warn(`[processGenericRelationshipFiles] Failed to parse: ${relsPath}`);
                return;
            }
            const relationships = Array.from(relsDoc.querySelectorAll('Relationship'));
            if (!relationships.length) {
                console.warn(`[processGenericRelationshipFiles] No Relationship nodes found: ${relsPath}`);
            }
            relationships.forEach(rel => {
                if (!rel) return;
                const relType = rel.getAttribute('Type');
                const target = rel.getAttribute('Target');
                const targetMode = rel.getAttribute('TargetMode');
                if (!relType || !target) {
                    console.warn(`[processGenericRelationshipFiles] Relationship missing Type or Target: ${rel.outerHTML}`);
                    return;
                }
                if (targetMode === 'External') {
                    return;
                }
                if (relType === 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image' ||
                    relType === 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/audio' ||
                    relType === 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/video' ||
                    relType.includes('/image') || relType.includes('/audio') || relType.includes('/video')) {
                    let mediaPath = resolvePath(relsPath, target);
                    if (mediaPath && mediaPath.startsWith(MEDIA_PATH_PREFIX)) {
                        usedMedia.add(mediaPath);
                    } else {
                        console.warn(`[processGenericRelationshipFiles] Resolved path "${mediaPath}" (target="${target}", relsPath="${relsPath}") does not start with ${MEDIA_PATH_PREFIX}. Skipping.`);
                    }
                }
            });
        } catch (error) {
            console.error(`[processGenericRelationshipFiles] Error processing ${relsPath} (context: ${context}):`, error.message, error.stack);
        }
    }));
}

async function getUsedSlides(zip) {
    try {
        const relsPath = 'ppt/_rels/presentation.xml.rels';
        const relsDoc = await parseXmlDOMWithLog(zip, relsPath);
        if (!relsDoc) {
            console.warn('[getUsedSlides] Failed to parse presentation relationships file.');
            return [];
        }
        const relationships = Array.from(relsDoc.querySelectorAll('Relationship'));
        if (!relationships.length) {
            console.warn(`[getUsedSlides] No Relationship nodes found, relsPath=${relsPath}`);
        }
        const slides = relationships.filter(rel => {
            const type = rel.getAttribute('Type');
            const target = rel.getAttribute('Target');
            if (!type || !target) {
                console.warn(`[getUsedSlides] Relationship missing Type or Target: ${rel.outerHTML}`);
                return false;
            }
            return type === 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide';
        }).map(rel => {
            const target = rel.getAttribute('Target');
            const rId = rel.getAttribute('Id');
            const resolvedPath = resolvePath(relsPath, target);
            if (resolvedPath && zip.file(resolvedPath)) {
                const parts = resolvedPath.split('/');
                const filename = parts.pop();
                const dir = parts.join('/');
                const slideRelsPath = `${dir}/_rels/${filename}.rels`;
                return { rId, path: resolvedPath, relsPath: slideRelsPath };
            } else {
                console.warn(`[getUsedSlides] Target file does not exist: ${resolvedPath} (target=${target})`);
            }
            return null;
        }).filter(s => s);
        console.log(`[getUsedSlides] Found ${slides.length} valid slide relationships pointing to existing files.`);
        return slides;
    } catch (error) {
        console.error('[getUsedSlides] Error getting used slides:', error.message, error.stack);
        return [];
    }
}

async function removeUnusedMedia(zip, usedMedia) {
    try {
        const allMediaPaths = findMediaFiles(zip);
        console.log(`[removeUnusedMedia] Checking media usage. Total files in ${MEDIA_PATH_PREFIX}: ${allMediaPaths.length}. Identified as used: ${usedMedia.size}`);
        const existingUsedMedia = new Set();
        let missingCount = 0;
        for (const mediaPath of usedMedia) {
            if (zip.file(mediaPath)) {
                existingUsedMedia.add(mediaPath);
            } else {
                console.warn(`[removeUnusedMedia] Referenced media file not found in ZIP, cannot mark as used: ${mediaPath}`);
                missingCount++;
            }
        }
        if (missingCount > 0) {
            console.log(`[removeUnusedMedia] Adjusted used media count after existence check: ${existingUsedMedia.size}`);
        }
        const unusedMediaPaths = allMediaPaths.filter(path => !existingUsedMedia.has(path));
        console.log(`[removeUnusedMedia] Identified ${unusedMediaPaths.length} unused media files for potential removal.`);
        if (shouldSkipMediaRemoval(allMediaPaths.length, unusedMediaPaths.length, existingUsedMedia.size)) {
            console.warn('[removeUnusedMedia] Skipping media removal due to safety checks.');
            return;
        }
        let removedCount = 0;
        let failedToRemoveCount = 0;
        for (const mediaPath of unusedMediaPaths) {
            try {
                if (zip.file(mediaPath)) {
                    zip.remove(mediaPath);
                    removedCount++;
                }
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
            console.log(`[removeUnusedMedia] Identified ${unusedMediaPaths.length} unused media files, but none were removed (may have been removed by other processes or checks failed).`);
        }
        if (unusedMediaPaths.length === 0) {
            console.log(`[removeUnusedMedia] No unused media files found to remove.`);
        }
        const remainingMedia = findMediaFiles(zip).length;
        console.log(`[removeUnusedMedia] Remaining media files after removal attempt: ${remainingMedia}`);
    } catch (error) {
        console.error('[removeUnusedMedia] Error during unused media removal process:', error.message, error.stack);
    }
}

function shouldSkipMediaRemoval(totalCount, unusedCount, usedCount) {
    if (totalCount === 0 || unusedCount <= 0) {
        return false;
    }
    if (unusedCount === totalCount && usedCount > 0) {
        console.warn(`[shouldSkipMediaRemoval] Safety Check Triggered: Attempting to remove ALL (${totalCount}) media files, but ${usedCount} were explicitly identified as used. This indicates a potential error in usage detection or file resolution. Skipping media removal.`);
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
        console.warn(`[shouldSkipMediaRemoval] Safety Check Triggered: Attempting to remove ${removalPercentage.toFixed(0)}% (${unusedCount}/${totalCount}) of media files (threshold ${highPercentageThreshold}% with >=${significantTotalCount} files). This is suspiciously high. Skipping media removal.`);
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
            const overrides = Array.isArray(contentTypesObj.Types.Override) ? contentTypesObj.Types.Override : [contentTypesObj.Types.Override];
            const initialCount = overrides.length;
            const filteredOverrides = overrides.filter(override => {
                if (!override) return false;
                const partName = override['@_PartName'];
                if (!partName || typeof partName !== 'string' || !partName.startsWith('/')) {
                    console.warn('[updateContentTypes] Override missing, invalid, or non-absolute PartName attribute:', JSON.stringify(override).substring(0, 100));
                    return true;
                }
                const filePath = partName.substring(1);
                const fileExists = zip.file(filePath) !== null;
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
            const defaults = Array.isArray(contentTypesObj.Types.Default) ? contentTypesObj.Types.Default : [contentTypesObj.Types.Default];
            const initialCount = defaults.length;
            const filteredDefaults = defaults.filter(def => {
                if (!def) return false;
                const extension = def['@_Extension'];
                if (!extension || typeof extension !== 'string' || extension.includes('.') || extension.length === 0) {
                    console.warn('[updateContentTypes] Default missing or invalid Extension attribute:', JSON.stringify(def).substring(0, 100));
                    return true;
                }
                const cleanExtension = extension.toLowerCase();
                const extensionPattern = new RegExp(`\\.${cleanExtension}$`, 'i');
                const exists = Object.keys(zip.files).some(path => !zip.files[path].dir && extensionPattern.test(path));
                if (!exists) {
                    console.log(`[updateContentTypes] No file found for extension ".${cleanExtension}", will remove Default:`, JSON.stringify(def));
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
                console.error('[updateContentTypes] Error building or writing updated content types XML:', buildError.message);
            }
        } else {
            console.log('[updateContentTypes] No changes needed for content types.');
        }
    } catch (error) {
        console.error('[updateContentTypes] Error updating content types:', error.message, error.stack);
    }
}
