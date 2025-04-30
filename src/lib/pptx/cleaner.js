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
        
        // === 新增：清理注释和未引用嵌入对象 ===
        await removeAllComments(zip);
        await removeUnusedEmbeddedObjects(zip, usedSlides, finalUsedLayouts, finalUsedMasters);
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


/**
 * 删除所有注释（包括幻灯片、notes、comments等）
 */
export async function removeAllComments(zip) {
    console.log('[removeAllComments] Starting removal of all comments (slides, notes, comments*.xml)...');
    
    // 统计信息
    let removedCommentFiles = 0;
    let cleanedSlides = 0;
    let totalNotesFiles = 0;
    let totalSlideFiles = 0;
    let notesFilesWithoutComments = 0;
    let slideFilesWithoutComments = 0;
    
    // 1. 删除comments*.xml及其rels
    const commentFileRegex = /^ppt\/comments\d+\.xml$/;
    const commentRelsRegex = /^ppt\/_rels\/comments\d+\.xml\.rels$/;
    const notesRegex = /^ppt\/notesSlides\/notesSlide\d+\.xml$/;
    
    // 记录所有文件类型
    const allFiles = Object.keys(zip.files);
    const commentFiles = allFiles.filter(path => commentFileRegex.test(path));
    const commentRelsFiles = allFiles.filter(path => commentRelsRegex.test(path));
    const notesFiles = allFiles.filter(path => notesRegex.test(path));
    const slideFiles = allFiles.filter(path => path.startsWith('ppt/slides/slide') && path.endsWith('.xml'));
    
    console.log(`[removeAllComments] Found ${commentFiles.length} comment files, ${commentRelsFiles.length} comment rels files, ${notesFiles.length} notes files, ${slideFiles.length} slide files`);
    
    // 删除comments*.xml及其rels
    for (const filePath of [...commentFiles, ...commentRelsFiles]) {
        zip.remove(filePath);
        removedCommentFiles++;
        console.log(`[removeAllComments] Removed comment file: ${filePath}`);
    }
    
    // 2. 处理notes文件
    for (const filePath of notesFiles) {
        totalNotesFiles++;
        try {
            const xmlStr = await zip.file(filePath).async('string');
            if (!xmlStr) {
                console.log(`[removeAllComments] Notes file is empty: ${filePath}`);
                continue;
            }
            
            console.log(`[removeAllComments] Processing notes file: ${filePath} (size: ${xmlStr.length} bytes)`);
            
            // 检查是否包含注释节点
            const hasCommentsList = xmlStr.includes('<p:cmLst') || xmlStr.includes('<p:cm ') || xmlStr.includes('<p:comment');
            
            if (hasCommentsList) {
                // 使用正则移除注释节点
                const originalLength = xmlStr.length;
                const cleaned = xmlStr
                    .replace(/<p:cmLst[\s\S]*?<\/p:cmLst>/g, '')
                    .replace(/<p:cm[\s\S]*?<\/p:cm>/g, '')
                    .replace(/<p:comment[\s\S]*?<\/p:comment>/g, '');
                
                if (cleaned !== xmlStr) {
                    zip.file(filePath, cleaned);
                    cleanedSlides++;
                    console.log(`[removeAllComments] Cleaned comments from notes file: ${filePath} (removed ${originalLength - cleaned.length} bytes)`);
                }
            } else {
                notesFilesWithoutComments++;
                console.log(`[removeAllComments] No comment nodes found in notes file: ${filePath}`);
            }
        } catch (error) {
            console.error(`[removeAllComments] Error processing notes file ${filePath}:`, error.message);
        }
    }
    
    // 3. 处理slide文件
    for (const filePath of slideFiles) {
        totalSlideFiles++;
        try {
            const xmlStr = await zip.file(filePath).async('string');
            if (!xmlStr) {
                console.log(`[removeAllComments] Slide file is empty: ${filePath}`);
                continue;
            }
            
            console.log(`[removeAllComments] Processing slide file: ${filePath} (size: ${xmlStr.length} bytes)`);
            
            // 检查是否包含注释节点
            const hasCommentsList = xmlStr.includes('<p:cmLst') || xmlStr.includes('<p:cm ') || xmlStr.includes('<p:comment');
            
            if (hasCommentsList) {
                // 使用正则移除注释节点
                const originalLength = xmlStr.length;
                const cleaned = xmlStr
                    .replace(/<p:cmLst[\s\S]*?<\/p:cmLst>/g, '')
                    .replace(/<p:cm[\s\S]*?<\/p:cm>/g, '')
                    .replace(/<p:comment[\s\S]*?<\/p:comment>/g, '');
                
                if (cleaned !== xmlStr) {
                    zip.file(filePath, cleaned);
                    cleanedSlides++;
                    console.log(`[removeAllComments] Cleaned comments from slide file: ${filePath} (removed ${originalLength - cleaned.length} bytes)`);
                }
            } else {
                slideFilesWithoutComments++;
                console.log(`[removeAllComments] No comment nodes found in slide file: ${filePath}`);
            }
        } catch (error) {
            console.error(`[removeAllComments] Error processing slide file ${filePath}:`, error.message);
        }
    }
    
    // 4. 尝试直接删除整个notesSlides目录（如果业务允许）
    // 注意：取消注释以下代码将删除所有讲义页
    /*
    if (notesFiles.length > 0) {
        console.log(`[removeAllComments] Removing all notes slides (${notesFiles.length} files)`);
        for (const filePath of notesFiles) {
            zip.remove(filePath);
        }
        // 同时删除notesSlides的rels文件
        const notesRelsFiles = allFiles.filter(path => path.startsWith('ppt/notesSlides/_rels/'));
        for (const filePath of notesRelsFiles) {
            zip.remove(filePath);
        }
    }
    */
    
    console.log(`[removeAllComments] Summary: Removed ${removedCommentFiles} comment files, cleaned ${cleanedSlides} files with comments`);
    console.log(`[removeAllComments] Notes files: ${totalNotesFiles} total, ${notesFilesWithoutComments} without comments`);
    console.log(`[removeAllComments] Slide files: ${totalSlideFiles} total, ${slideFilesWithoutComments} without comments`);
}

/**
 * 清理未被引用的嵌入对象（如OLE、embeddings等）
 */
export async function removeUnusedEmbeddedObjects(zip, usedSlides, usedLayouts, usedMasters) {
    console.log('[removeUnusedEmbeddedObjects] Starting cleanup of unused embedded objects...');
    
    // 1. 收集所有嵌入对象文件
    const embeddingFiles = Object.keys(zip.files).filter(path => 
        path.startsWith('ppt/embeddings/') || 
        path.startsWith('ppt/oleObjects/') ||
        path.includes('/activeX/') ||
        path.includes('/ctrlProps/')
    );
    
    if (embeddingFiles.length === 0) {
        console.log('[removeUnusedEmbeddedObjects] No embedded object files found in the presentation');
        return;
    }
    
    console.log(`[removeUnusedEmbeddedObjects] Found ${embeddingFiles.length} embedded object files`);
    
    // 2. 收集所有关系文件，不仅仅是slide/layout/master
    const allRelsFiles = Object.keys(zip.files).filter(path => 
        path.includes('/_rels/') && path.endsWith('.rels')
    );
    
    console.log(`[removeUnusedEmbeddedObjects] Analyzing ${allRelsFiles.length} relationship files for embedded object references`);
    
    // 3. 收集所有被引用的嵌入对象
    const usedEmbeddings = new Set();
    const embeddingRelTypes = [
        'http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject',
        'http://schemas.openxmlformats.org/officeDocument/2006/relationships/package',
        'http://schemas.openxmlformats.org/officeDocument/2006/relationships/activeXControl',
        'http://schemas.microsoft.com/office/2006/relationships/activeXControlBinary',
        'http://schemas.openxmlformats.org/officeDocument/2006/relationships/control'
    ];
    
    // 记录每种类型找到的引用数量
    const typeCount = {};
    embeddingRelTypes.forEach(type => typeCount[type] = 0);
    
    // 分析所有关系文件
    for (const relsPath of allRelsFiles) {
        try {
            const xmlStr = await zip.file(relsPath).async('string');
            if (!xmlStr) continue;
            
            // 使用DOM解析而不是正则，更健壮
            const parser = new DOMParser();
            const doc = parser.parseFromString(xmlStr, 'application/xml');
            const relationships = doc.querySelectorAll('Relationship');
            
            if (relationships.length === 0) {
                continue;
            }
            
            // 检查每个关系
            for (const rel of relationships) {
                const type = rel.getAttribute('Type');
                const target = rel.getAttribute('Target');
                
                if (!type || !target) continue;
                
                // 检查是否是嵌入对象类型
                if (embeddingRelTypes.includes(type) || 
                    type.includes('/oleObject') || 
                    type.includes('/package') || 
                    type.includes('/activeX') || 
                    type.includes('/control')) {
                    
                    // 记录类型统计
                    if (embeddingRelTypes.includes(type)) {
                        typeCount[type]++;
                    } else {
                        typeCount['other'] = (typeCount['other'] || 0) + 1;
                    }
                    
                    // 解析目标路径
                    let resolvedPath = resolvePath(relsPath, target);
                    if (resolvedPath) {
                        usedEmbeddings.add(resolvedPath);
                        console.log(`[removeUnusedEmbeddedObjects] Found reference to embedded object: ${resolvedPath} (in ${relsPath})`);
                    }
                }
                
                // 特殊处理：检查Target属性中是否包含embeddings路径
                if (target.includes('/embeddings/') || 
                    target.includes('/oleObjects/') || 
                    target.includes('/activeX/') || 
                    target.includes('/ctrlProps/')) {
                    
                    let resolvedPath = resolvePath(relsPath, target);
                    if (resolvedPath) {
                        usedEmbeddings.add(resolvedPath);
                        console.log(`[removeUnusedEmbeddedObjects] Found direct path reference to embedded object: ${resolvedPath} (in ${relsPath})`);
                    }
                }
            }
        } catch (error) {
            console.error(`[removeUnusedEmbeddedObjects] Error processing relationship file ${relsPath}:`, error.message);
        }
    }
    
    // 4. 删除未被引用的嵌入对象
    const unusedEmbeddings = embeddingFiles.filter(path => !usedEmbeddings.has(path));
    
    console.log(`[removeUnusedEmbeddedObjects] Relationship type statistics:`, typeCount);
    console.log(`[removeUnusedEmbeddedObjects] Found ${usedEmbeddings.size} used embedded objects and ${unusedEmbeddings.length} unused embedded objects`);
    
    // 删除未被引用的嵌入对象
    let removedCount = 0;
    for (const path of unusedEmbeddings) {
        try {
            zip.remove(path);
            removedCount++;
            console.log(`[removeUnusedEmbeddedObjects] Removed unused embedded object: ${path}`);
        } catch (error) {
            console.error(`[removeUnusedEmbeddedObjects] Error removing embedded object ${path}:`, error.message);
        }
    }
    
    console.log(`[removeUnusedEmbeddedObjects] Finished. Removed ${removedCount}/${unusedEmbeddings.length} unused embedded objects`);
}
