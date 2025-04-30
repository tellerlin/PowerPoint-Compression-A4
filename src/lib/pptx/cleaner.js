import { parseXml, buildXml } from './xml/parser';
import { PRESENTATION_PATH, MEDIA_PATH_PREFIX, SLIDE_LAYOUT_PREFIX, SLIDE_MASTER_PREFIX } from './constants';
import { removeUnusedLayouts as performLayoutRemoval, getUsedLayoutsAndMasters as analyzeUsedLayoutsMasters, analyzeLayoutsAndMasters } from './layout-cleaner';
import { findMediaFiles } from './media';
import { resolvePath, parseXmlDOM } from './utils';

export async function cleanUnusedResources(zip, onProgress, options) {
    let finalUsedLayouts = new Set();
    let finalUsedMasters = new Set();
    try {
        const cleanOptions = { removeUnusedLayouts: false, ...options };
        onProgress('init', { percentage: 10, status: 'Analyzing presentation structure...' });
        
        // 1. 获取使用中的幻灯片
        const usedSlides = await getUsedSlides(zip);
        if (usedSlides.length === 0) {
            console.warn('[Cleaner] No used slides found in the presentation. Cleanup might be limited.');
        } else {
            console.log(`[Cleaner] Found ${usedSlides.length} slides marked as used in presentation.xml.rels.`);
        }
        
        // 2. 分析布局和母版
        console.log('[Cleaner] Analyzing existing layouts/masters...');
        const analysisResult = await analyzeLayoutsAndMasters(zip, usedSlides, onProgress);
        
        finalUsedLayouts = analysisResult.usedLayouts instanceof Set ? analysisResult.usedLayouts : new Set();
        finalUsedMasters = analysisResult.usedMasters instanceof Set ? analysisResult.usedMasters : new Set();
        
        console.log(`[Cleaner] Analysis results - Used Layouts: ${finalUsedLayouts.size}, Used Masters: ${finalUsedMasters.size}`);
        
        // 3. 收集和处理媒体文件
        onProgress('init', { percentage: 70, status: 'Analyzing media file usage...' });
        const usedMedia = await collectUsedMedia(zip, usedSlides, finalUsedLayouts, finalUsedMasters);
        const allMediaPaths = findMediaFiles(zip);
        const unusedMediaPaths = allMediaPaths.filter(path => !usedMedia.has(path));
        
        console.log('[Cleaner] Media Usage Summary:', { 
            totalFound: allMediaPaths.length, 
            identifiedAsUsed: usedMedia.size, 
            identifiedAsUnused: unusedMediaPaths.length 
        });
        
        // 4. 安全检查并移除未使用的媒体
        const shouldSkip = shouldSkipMediaRemoval(allMediaPaths.length, unusedMediaPaths.length, usedMedia.size);
        if (!shouldSkip) {
            await removeUnusedMedia(zip, usedMedia);
        } else {
            console.warn('[Cleaner] Skipping media removal due to safety check.');
        }
        
        // 5. 更新内容类型
        onProgress('init', { percentage: 95, status: 'Updating content types...' });
        await updateContentTypes(zip);
        
        return true;
    } catch (error) {
        console.error('[Cleaner] Error during resource cleanup:', error.message, error.stack);
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
            const relsDoc = await parseXmlDOM(zip, relsPath);
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
        const relsDoc = await parseXmlDOM(zip, relsPath);
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
                console.debug(`[getUsedSlides] Relationship missing Type or Target: ${rel.outerHTML}`);
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
                
                // 检查关系文件是否存在，但不抛出警告
                const hasRels = zip.file(slideRelsPath) !== null;
                
                return { 
                    rId, 
                    path: resolvedPath, 
                    relsPath: hasRels ? slideRelsPath : null 
                };
            } else {
                console.debug(`[getUsedSlides] Target file does not exist: ${resolvedPath} (target=${target})`);
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
        const allMediaFiles = findMediaFiles(zip);
        const unusedMediaFiles = allMediaFiles.filter(path => !usedMedia.has(path));
        
        if (unusedMediaFiles.length === 0) {
            console.log('[removeUnusedMedia] No unused media files found.');
            return;
        }
        
        console.log(`[removeUnusedMedia] Found ${unusedMediaFiles.length} unused media files.`);
        
        const oneByteContent = new Uint8Array([0]);
        let replacedCount = 0;
        
        for (const mediaPath of unusedMediaFiles) {
            try {
                zip.file(mediaPath, oneByteContent);
                replacedCount++;
            } catch (error) {
                console.error(`[removeUnusedMedia] Error replacing media file ${mediaPath}:`, error.message);
            }
        }
        
        console.log(`[removeUnusedMedia] Successfully replaced ${replacedCount}/${unusedMediaFiles.length} unused media files with placeholders.`);
    } catch (error) {
        console.error('[removeUnusedMedia] Error during media replacement:', error.message);
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
            
            // 收集ZIP中所有文件扩展名
            const allExtensions = new Set();
            Object.keys(zip.files).forEach(path => {
                if (!zip.files[path].dir) {
                    const ext = path.split('.').pop().toLowerCase();
                    if (ext) allExtensions.add(ext);
                }
            });
            
            const filteredDefaults = defaults.filter(def => {
                if (!def) return false;
                const extension = def['@_Extension'];
                if (!extension || typeof extension !== 'string' || extension.includes('.') || extension.length === 0) {
                    console.warn('[updateContentTypes] Default missing or invalid Extension attribute:', JSON.stringify(def).substring(0, 100));
                    return true;
                }
                const cleanExtension = extension.toLowerCase();
                return allExtensions.has(cleanExtension);
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
