import { parseXml, buildXml } from './xml/parser';
import { SLIDE_LAYOUT_PREFIX, SLIDE_MASTER_PREFIX, CONTENT_TYPES_PATH } from './constants';
import { resolvePath, parseXmlDOM, parseXmlSafely } from './utils';

// 删除这个函数定义，因为它已经在 utils.js 中定义了
// async function parseXmlSafely(zip, path) {
//     try {
//         const xmlString = await zip.file(path)?.async('string');
//         if (!xmlString) {
//             // 对于关系文件，使用更低级别的日志
//             if (path.includes('_rels/') && path.endsWith('.xml.rels')) {
//                 console.debug(`[LayoutCleaner] File not found or empty: ${path}`);
//             } else {
//                 console.warn(`[LayoutCleaner] File not found or empty: ${path}`);
//             }
//             return { _notFoundOrEmpty: true };
//         }
//         const parsed = await parseXml(xmlString);
//         if (parsed._parseFailed) {
//              console.error(`[LayoutCleaner] Failed to parse XML: ${path}`);
//         }
//         return parsed;
//     } catch (error) {
//         console.error(`[LayoutCleaner] Error reading/parsing XML from ${path}:`, error.message);
//         return { _parseFailed: true, _error: error.message };
//     }
// }

export async function analyzeLayoutsAndMasters(zip, usedSlides, onProgress = () => {}) {
    const result = { success: false, layouts: [], masters: [], usedLayouts: new Set(), usedMasters: new Set() };
    try {
        console.log('[LayoutCleaner] Starting layout/master analysis...');
        onProgress('init', { percentage: 20, status: 'Analyzing presentation structure...' });
        const slides = usedSlides;
        if (!slides || slides.length === 0) {
            console.warn('[LayoutCleaner] No slides found or provided. Cannot determine used layouts.');
            result.success = true;
            result.layouts = [];
            result.masters = [];
            result.usedLayouts = new Set();
            result.usedMasters = new Set();
            return result;
        }
        console.log(`[LayoutCleaner] Analyzing ${slides.length} used slide entries.`);
        onProgress('init', { percentage: 30, status: 'Identifying used layouts...' });
        const layoutPromises = slides.map(slide => getSlideLayout(zip, slide));
        const layoutResults = await Promise.all(layoutPromises);
        const usedLayouts = new Set();
        layoutResults.forEach((layoutInfo) => {
            if (layoutInfo?.path) {
                usedLayouts.add(layoutInfo.path);
            }
        });
        console.log(`[LayoutCleaner] Identified ${usedLayouts.size} unique layouts directly used by slides.`);
        
        if (usedLayouts.size === 0 && slides.length > 0) {
            console.warn('[LayoutCleaner] Found slides but could not identify any used layouts via relationships. Analysis may be incomplete.');
            result.success = true;
            result.usedLayouts = new Set();
            result.usedMasters = new Set();
            return result;
        }
        
        onProgress('init', { percentage: 40, status: 'Identifying used masters...' });
        const usedMasters = new Set();
        for (const layoutPath of usedLayouts) {
            const masterInfo = await getLayoutMaster(zip, layoutPath);
            if (masterInfo?.path) {
                usedMasters.add(masterInfo.path);
            }
        }
        console.log(`[LayoutCleaner] Identified ${usedMasters.size} unique masters used by layouts.`);
        
        const allLayoutFiles = Object.keys(zip.files).filter(f => f.startsWith('ppt/slideLayouts/slideLayout') && f.endsWith('.xml'));
        const unusedLayouts = allLayoutFiles.filter(f => !usedLayouts.has(f));
        
        const allMasterFiles = Object.keys(zip.files).filter(f => f.startsWith('ppt/slideMasters/slideMaster') && f.endsWith('.xml'));
        const unusedMasters = allMasterFiles.filter(f => !usedMasters.has(f));
        
        console.log(`[LayoutCleaner] Analysis complete. Found ${unusedLayouts.length} unused layouts and ${unusedMasters.length} unused masters.`);
        console.log(`[LayoutCleaner] Used layouts: ${usedLayouts.size}, Used masters: ${usedMasters.size}`);
        
        result.success = true;
        result.layouts = Array.from(usedLayouts);
        result.masters = Array.from(usedMasters);
        result.usedLayouts = usedLayouts;
        result.usedMasters = usedMasters;
        
        onProgress('init', { percentage: 100, status: 'Layout analysis complete' });
    } catch (error) {
        console.error('[LayoutCleaner] Error in analyzeLayoutsAndMasters:', error.message);
    }
    return result;
}

export async function removeUnusedLayouts(zip, usedSlides, onProgress = () => {}) {
    console.log('[LayoutCleaner] Starting layout removal process...');
    try {
        // Analyze layouts and masters
        const analysisResult = await analyzeLayoutsAndMasters(zip, usedSlides, onProgress);
        if (!analysisResult.success) {
            console.warn('[LayoutCleaner] Layout analysis failed, skipping removal.');
            return { success: false, removedLayoutsCount: 0, removedMastersCount: 0 };
        }
        
        const usedLayouts = analysisResult.usedLayouts;
        const usedMasters = analysisResult.usedMasters;
        
        // Get all layout and master files
        const allLayoutFiles = Object.keys(zip.files).filter(f => f.startsWith('ppt/slideLayouts/slideLayout') && f.endsWith('.xml'));
        const allMasterFiles = Object.keys(zip.files).filter(f => f.startsWith('ppt/slideMasters/slideMaster') && f.endsWith('.xml'));
        
        // Determine unused layouts and masters
        const unusedLayouts = allLayoutFiles.filter(f => !usedLayouts.has(f));
        const unusedMasters = allMasterFiles.filter(f => !usedMasters.has(f));
        
        if (unusedLayouts.length === 0 && unusedMasters.length === 0) {
            console.log('[LayoutCleaner] No unused layouts or masters found to remove.');
            return { success: true, removedLayoutsCount: 0, removedMastersCount: 0 };
        }
        
        console.log(`[LayoutCleaner] Removing ${unusedLayouts.length} unused layouts and ${unusedMasters.length} unused masters...`);
        onProgress('init', { percentage: 80, status: 'Removing unused layouts and masters...' });
        
        // Update master layout references
        for (const masterPath of usedMasters) {
            await updateMasterLayoutReferences(zip, masterPath, usedLayouts);
        }
        
        // Remove unused layout and master files
        let removedLayoutsCount = 0;
        let removedMastersCount = 0;
        
        if (unusedLayouts.length > 0) {
            removedLayoutsCount = await removeFilesAndRels(zip, unusedLayouts, SLIDE_LAYOUT_PREFIX);
        }
        
        if (unusedMasters.length > 0) {
            removedMastersCount = await removeFilesAndRels(zip, unusedMasters, SLIDE_MASTER_PREFIX);
        }
        
        // Update content types
        await updateContentTypes(zip, unusedLayouts, unusedMasters);
        
        console.log(`[LayoutCleaner] Successfully removed ${removedLayoutsCount} layouts and ${removedMastersCount} masters.`);
        onProgress('init', { percentage: 100, status: 'Layout cleanup complete' });
        
        return { 
            success: true, 
            removedLayoutsCount, 
            removedMastersCount,
            usedLayouts: analysisResult.usedLayouts,
            usedMasters: analysisResult.usedMasters
        };
    } catch (error) {
        console.error('[LayoutCleaner] Error in removeUnusedLayouts:', error.message);
        return { success: false, removedLayoutsCount: 0, removedMastersCount: 0 };
    }
}

async function updateContentTypes(zip, removedLayouts, removedMasters) {
    try {
        const contentTypesObj = await parseXmlSafely(zip, CONTENT_TYPES_PATH);
        if (contentTypesObj._notFoundOrEmpty || contentTypesObj._parseFailed) {
            console.warn('[LayoutCleaner] Content types file not found or parse failed, skipping update.');
            return;
        }
        
        let overrides = [];
        if (contentTypesObj?.Types?.Override) {
            overrides = Array.isArray(contentTypesObj.Types.Override) 
                ? contentTypesObj.Types.Override 
                : [contentTypesObj.Types.Override];
        }
        
        if (!overrides.length) {
            return;
        }
        
        const initialCount = overrides.length;
        const filteredOverrides = overrides.filter(override => {
            const partName = override?.['@_PartName'];
            if (!partName) return true;
            
            for (const layout of removedLayouts) {
                if (partName.includes(layout.replace('ppt/', '/ppt/'))) {
                    return false;
                }
            }
            
            for (const master of removedMasters) {
                if (partName.includes(master.replace('ppt/', '/ppt/'))) {
                    return false;
                }
            }
            
            return true;
        });
        
        if (filteredOverrides.length < initialCount) {
            contentTypesObj.Types.Override = filteredOverrides;
            const updatedContentTypesXml = buildXml(contentTypesObj);
            zip.file(CONTENT_TYPES_PATH, updatedContentTypesXml);
            console.log(`[LayoutCleaner] Updated content types: removed ${initialCount - filteredOverrides.length} entries.`);
        }
    } catch (error) {
        console.error('[LayoutCleaner] Error updating content types:', error.message);
    }
}

async function removeFilesAndRels(zip, filePaths, prefix) {
    let removedCount = 0;
    for (const filePath of filePaths) {
        try {
            if (zip.file(filePath)) {
                zip.remove(filePath);
                const relsPath = filePath.replace(prefix, `${prefix}_rels/`) + '.rels';
                if (zip.file(relsPath)) {
                    zip.remove(relsPath);
                }
                removedCount++;
            }
        } catch (e) {
            console.error(`[LayoutCleaner] Failed to remove ${filePath} or its rels: ${e.message}`);
        }
    }
    console.log(`[LayoutCleaner] Removed ${removedCount}/${filePaths.length} ${prefix.includes('Layout') ? 'layouts' : 'masters'}.`);
    return removedCount;
}

async function getSlideLayout(zip, slide) {
    if (!slide?.path) return null;
    try {
        const slideRelsPath = slide.relsPath || slide.path.replace(/^(.*\/slides\/)([^/]+)$/, '$1_rels/$2.rels');
        
        // Check if the rels file exists before trying to parse it
        if (!zip.file(slideRelsPath)) {
            console.debug(`[LayoutCleaner] Slide relationship file not found: ${slideRelsPath}`);
            return null;
        }
        
        const slideRelsObj = await parseXmlSafely(zip, slideRelsPath);
        if (slideRelsObj._notFoundOrEmpty || slideRelsObj._parseFailed) {
            console.debug(`[LayoutCleaner] Failed to parse slide relationships: ${slideRelsPath}`);
            return null;
        }
        
        let slideRels = [];
        if (slideRelsObj.Relationships) {
            const relsArr = Array.isArray(slideRelsObj.Relationships) ? slideRelsObj.Relationships : [slideRelsObj.Relationships];
            slideRels = relsArr.flatMap(r => {
                if (!r) return [];
                if (Array.isArray(r.Relationship)) return r.Relationship;
                if (r.Relationship) return [r.Relationship];
                return [];
            });
        }
        
        if (!slideRels.length) {
            console.debug(`[LayoutCleaner] No valid relationships found for slide: ${slide.path} at ${slideRelsPath}`);
            return null;
        }
        
        const layoutRel = slideRels.find(rel => {
            const type = (rel?.['@_Type'] || rel?.['Type'] || rel?.['$Type'] || '').trim();
            const target = (rel?.['@_Target'] || rel?.['Target'] || rel?.['$Target'] || '').trim();
            return type.toLowerCase().includes('slidelayout') && target;
        });
        if (!layoutRel) {
            console.debug(`[LayoutCleaner] No slideLayout relationship found for slide: ${slide.path}`);
            return null;
        }
        const layoutPath = resolvePath(slideRelsPath, layoutRel['@_Target']);
        if (!layoutPath || !zip.file(layoutPath)) {
            console.debug(`[LayoutCleaner] Layout target "${layoutRel['@_Target']}" resolved to non-existent file: ${layoutPath || 'resolution failed'} from slide: ${slide.path}`);
            return null;
        }
        
        return {
            path: layoutPath,
            rId: layoutRel['@_Id']
        };
    } catch (error) {
        console.error(`[LayoutCleaner] Error getting layout for slide ${slide.path}:`, error.message);
        return null;
    }
}

export async function getLayoutMaster(zip, layoutPath) {
    if (!layoutPath) return null;
    try {
        const masterFiles = Object.keys(zip.files).filter(f => /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(f));
        for (const masterPath of masterFiles) {
            const masterRelsPath = masterPath.replace(/^(.*\/slideMasters\/)([^/]+)$/, '$1_rels/$2.rels');
            
            // Check if the master rels file exists
            if (!zip.file(masterRelsPath)) {
                console.debug(`[LayoutCleaner] Master relationship file not found: ${masterRelsPath}`);
                continue;
            }
            
            const masterRelsObj = await parseXmlSafely(zip, masterRelsPath);
            if (masterRelsObj._notFoundOrEmpty || masterRelsObj._parseFailed) {
                console.debug(`[LayoutCleaner] Failed to parse master relationships: ${masterRelsPath}`);
                continue;
            }
            
            let relationships = [];
            if (masterRelsObj.Relationships) {
                const relsArr = Array.isArray(masterRelsObj.Relationships) ? masterRelsObj.Relationships : [masterRelsObj.Relationships];
                relationships = relsArr.flatMap(r => {
                    if (!r) return [];
                    if (Array.isArray(r.Relationship)) return r.Relationship;
                    if (r.Relationship) return [r.Relationship];
                    return [];
                });
            }
            for (const rel of relationships) {
                const type = (rel?.['@_Type'] || rel?.['Type'] || rel?.['$Type'] || '').toLowerCase();
                const target = rel?.['@_Target'] || rel?.['Target'] || rel?.['$Target'];
                if (type.includes('slidelayout') && target) {
                    const relLayoutPath = resolvePath(masterRelsPath, target);
                    if (relLayoutPath === layoutPath) {
                        return {
                            path: masterPath,
                            rId: rel['@_Id'] || rel['Id'] || rel['$Id'],
                            rel: rel
                        };
                    }
                }
            }
        }
        return null;
    } catch (error) {
        console.error(`[LayoutCleaner] Error finding master for layout ${layoutPath}:`, error.message);
        return null;
    }
}

async function updateMasterLayoutReferences(zip, masterPath, usedLayoutsSet) {
    const masterRelsPath = masterPath.replace(/^(.*\/slideMasters\/)([^/]+)$/, '$1_rels/$2.rels');
    try {
        // Check if the master rels file exists
        if (!zip.file(masterRelsPath)) {
            console.debug(`[LayoutCleaner] Master relationship file not found: ${masterRelsPath}`);
            return;
        }
        
        const masterRelsObj = await parseXmlSafely(zip, masterRelsPath);
        if (masterRelsObj._notFoundOrEmpty || masterRelsObj._parseFailed) {
            console.debug(`[LayoutCleaner] Failed to parse master relationships: ${masterRelsPath}`);
            return;
        }
        
        let relationships = [];
        if (masterRelsObj.Relationships) {
            const relsArr = Array.isArray(masterRelsObj.Relationships) ? masterRelsObj.Relationships : [masterRelsObj.Relationships];
            relationships = relsArr.flatMap(r => {
                if (!r) return [];
                if (Array.isArray(r.Relationship)) return r.Relationship;
                if (r.Relationship) return [r.Relationship];
                return [];
            });
        }
        if (!relationships.length) {
            return;
        }
        const initialCount = relationships.length;
        let validLayoutRels = [];
        const filteredRelationships = relationships.filter(rel => {
            if (!rel?.['@_Type'] || !rel?.['@_Target']) {
                console.warn(`[LayoutCleaner] Invalid relationship in ${masterRelsPath}:`, JSON.stringify(rel).substring(0,100));
                return false;
            }
            if (!rel['@_Type'].includes('/slideLayout')) {
                return true;
            }
            const layoutPath = resolvePath(masterRelsPath, rel['@_Target']);
            const isUsed = layoutPath && usedLayoutsSet.has(layoutPath);
            if (isUsed) {
                validLayoutRels.push(rel);
            }
            return isUsed;
        });
        if (filteredRelationships.length < initialCount) {
            if (masterRelsObj.Relationships) {
                const relsArr = Array.isArray(masterRelsObj.Relationships) ? masterRelsObj.Relationships : [masterRelsObj.Relationships];
                relsArr.forEach(r => {
                    if (r && r.Relationship) {
                        r.Relationship = filteredRelationships.length > 0 ? filteredRelationships : undefined;
                    }
                });
                masterRelsObj.Relationships = relsArr;
            }
            const updatedRelsXml = buildXml(masterRelsObj);
            zip.file(masterRelsPath, updatedRelsXml);
            console.log(`[LayoutCleaner] Updated master rels ${masterRelsPath}: removed ${initialCount - filteredRelationships.length} layout references.`);
            await updateMasterXmlLayoutList(zip, masterPath, validLayoutRels);
        }
    } catch (error) {
        console.error(`[LayoutCleaner] Error updating master references for ${masterPath}:`, error.message);
    }
}

async function updateMasterXmlLayoutList(zip, masterPath, validLayoutRelationships) {
    try {
        const masterObj = await parseXmlSafely(zip, masterPath);
        if (masterObj._notFoundOrEmpty || masterObj._parseFailed) {
            console.warn(`[LayoutCleaner] Master XML not found or parse failed, skipping layout list update: ${masterPath}`);
            return;
        }
        const layoutIdListPath = ['p:sldMaster', 'p:sldLayoutIdLst', 'p:sldLayoutId'];
        let current = masterObj;
        for (let i = 0; i < layoutIdListPath.length - 1; i++) {
            current = current?.[layoutIdListPath[i]];
            if (!current) break;
        }
        const layoutIdListNode = current;
        const layoutIdList = layoutIdListNode?.[layoutIdListPath[layoutIdListPath.length - 1]];
        if (!layoutIdList) {
            return;
        }
        const validLayoutRIds = new Set(validLayoutRelationships.map(rel => rel['@_Id']));
        const currentLayoutIds = Array.isArray(layoutIdList) ? layoutIdList : [layoutIdList];
        const initialCount = currentLayoutIds.length;
        const filteredLayoutIds = currentLayoutIds.filter(layoutId => {
            const rId = layoutId?.['@_r:id'];
            const keep = rId && validLayoutRIds.has(rId);
            return keep;
        });
        if (filteredLayoutIds.length < initialCount) {
            if (layoutIdListNode) {
                layoutIdListNode[layoutIdListPath[layoutIdListPath.length - 1]] = filteredLayoutIds.length > 0 ? filteredLayoutIds : undefined;
                const updatedMasterXml = buildXml(masterObj);
                zip.file(masterPath, updatedMasterXml);
                console.log(`[LayoutCleaner] Updated master XML ${masterPath}: removed ${initialCount - filteredLayoutIds.length} layout ID references.`);
            } else {
                console.warn(`[LayoutCleaner] Could not find parent node for layout ID list in master XML: ${masterPath}`);
            }
        }
    } catch (error) {
        console.error(`[LayoutCleaner] Error updating master XML layout list for ${masterPath}:`, error.message);
    }
}

export async function getUsedLayoutsAndMasters(zip, usedSlides) {
    const usedLayouts = new Set();
    const usedMasters = new Set();
    if (!usedSlides || usedSlides.length === 0) {
        console.log("[LayoutCleaner] No slides provided, returning empty sets.");
        return { usedLayouts, usedMasters };
    }
    try {
        console.log(`[LayoutCleaner] Analyzing ${usedSlides.length} slides...`);
        for (const slide of usedSlides) {
            const layoutInfo = await getSlideLayout(zip, slide);
            if (layoutInfo?.path) {
                usedLayouts.add(layoutInfo.path);
                const masterInfo = await getLayoutMaster(zip, layoutInfo.path);
                if (masterInfo?.path) {
                    usedMasters.add(masterInfo.path);
                }
            }
        }
        console.log(`[LayoutCleaner] Analysis complete. Found ${usedLayouts.size} layouts and ${usedMasters.size} masters.`);
        return { usedLayouts, usedMasters };
    } catch (error) {
        console.error('[LayoutCleaner] Error analyzing used layouts and masters:', error.message);
        return { usedLayouts: new Set(), usedMasters: new Set() };
    }
}