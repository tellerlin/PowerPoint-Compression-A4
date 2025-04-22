import { parseXml, buildXml } from './xml/parser';
import { SLIDE_LAYOUT_PREFIX, SLIDE_MASTER_PREFIX, CONTENT_TYPES_PATH } from './constants';
import { resolvePath } from './utils'; // Added import

async function parseXmlSafely(zip, path) {
    try {
        const xmlString = await zip.file(path)?.async('string');
        if (!xmlString) {
            // console.log(`[parseXmlSafely] File not found or empty: ${path}`);
            return { _notFoundOrEmpty: true };
        }
        const parsed = await parseXml(xmlString);
        if (parsed._parseFailed) {
             console.error(`[parseXmlSafely] Failed to parse XML: ${path}`);
        }
        return parsed;
    } catch (error) {
        console.error(`[parseXmlSafely] Error reading/parsing XML from ${path}:`, error.message);
        return { _parseFailed: true, _error: error.message };
    }
}

export async function removeUnusedLayouts(zip, usedSlides, onProgress = () => {}) {
    const result = { success: false, usedLayouts: new Set(), usedMasters: new Set() };
	try {
		console.log('[LayoutCleaner] Starting layout/master cleanup...');
		onProgress('init', { percentage: 20, status: 'Analyzing presentation structure...' });

        const slides = usedSlides;

		if (!slides || slides.length === 0) {
			console.warn('[LayoutCleaner] No slides found or provided. Cannot determine used layouts.');
            result.success = true;
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
        result.usedLayouts = usedLayouts;

        if (usedLayouts.size === 0 && slides.length > 0) {
             console.warn('[LayoutCleaner] Found slides but could not identify any used layouts via relationships. Aborting layout/master cleanup to prevent data loss.');
             result.success = false;
             return result;
        }

		onProgress('init', { percentage: 45, status: 'Identifying used masters...' });
		const masterPromises = Array.from(usedLayouts).map(layoutPath => getLayoutMaster(zip, layoutPath));
		const masterResults = await Promise.all(masterPromises);

		const usedMasters = new Set();
		masterResults.forEach((masterInfo) => {
			if (masterInfo?.path) {
				usedMasters.add(masterInfo.path);
			}
		});
		console.log(`[LayoutCleaner] Identified ${usedMasters.size} unique masters used by those layouts.`);
        result.usedMasters = usedMasters;

		const allLayoutFiles = Object.keys(zip.files)
			.filter(path => path.startsWith(SLIDE_LAYOUT_PREFIX) && path.endsWith('.xml') && !path.includes('/_rels/'));
		const allMasterFiles = Object.keys(zip.files)
			.filter(path => path.startsWith(SLIDE_MASTER_PREFIX) && path.endsWith('.xml') && !path.includes('/_rels/'));

		console.log(`[LayoutCleaner] Total found in ZIP - Layouts: ${allLayoutFiles.length}, Masters: ${allMasterFiles.length}`);

		onProgress('init', { percentage: 55, status: 'Removing unused layouts...' });
		const unusedLayouts = allLayoutFiles.filter(path => !usedLayouts.has(path));
		console.log(`[LayoutCleaner] Found ${unusedLayouts.length} unused layouts to remove.`);
		await removeFilesAndRels(zip, unusedLayouts, SLIDE_LAYOUT_PREFIX);

		onProgress('init', { percentage: 70, status: 'Removing unused masters...' });
		const unusedMasters = allMasterFiles.filter(path => !usedMasters.has(path));
		console.log(`[LayoutCleaner] Found ${unusedMasters.length} unused masters to remove.`);
		await removeFilesAndRels(zip, unusedMasters, SLIDE_MASTER_PREFIX);

        onProgress('init', { percentage: 80, status: 'Updating master references...' });
		for (const masterPath of usedMasters) {
			await updateMasterLayoutReferences(zip, masterPath, usedLayouts);
		}

		console.log('[LayoutCleaner] Layout/master cleanup finished.');
        result.success = true;
		return result;
	} catch (error) {
		console.error('[LayoutCleaner] Error during layout/master cleanup:', error.message, error.stack);
        onProgress('error', { message: `Layout cleanup failed: ${error.message}` });
        result.success = false;
        result.usedLayouts = result.usedLayouts || new Set();
        result.usedMasters = result.usedMasters || new Set();
		return result;
	}
}

async function removeFilesAndRels(zip, filePaths, prefix) {
    let removedCount = 0;
    for (const filePath of filePaths) {
        try {
            zip.remove(filePath);
            const relsPath = filePath.replace(prefix, `${prefix}_rels/`) + '.rels';
            if (zip.file(relsPath)) {
                zip.remove(relsPath);
                // console.log(`[LayoutCleaner] Removed ${filePath} and ${relsPath}`);
            } else {
                // console.log(`[LayoutCleaner] Removed ${filePath} (no rels file found)`);
            }
            removedCount++;
        } catch (e) {
            console.error(`[LayoutCleaner] Failed to remove ${filePath} or its rels: ${e.message}`);
        }
    }
    console.log(`[LayoutCleaner] Attempted removal of ${filePaths.length} items, successfully removed ${removedCount}.`);
}

async function getSlideLayout(zip, slide) {
	if (!slide?.path) return null;
	try {
		const slideRelsPath = slide.path.replace(/^(.*\/slides\/)([^/]+)$/, '$1_rels/$2.rels');
		const slideRelsObj = await parseXmlSafely(zip, slideRelsPath);

        if (slideRelsObj._notFoundOrEmpty || slideRelsObj._parseFailed || !slideRelsObj?.Relationships?.Relationship) {
            // console.log(`[LayoutCleaner] No valid relationships found for slide: ${slide.path}`);
            return null;
        }

		const slideRels = Array.isArray(slideRelsObj.Relationships.Relationship)
			? slideRelsObj.Relationships.Relationship
			: [slideRelsObj.Relationships.Relationship];

		const layoutRel = slideRels.find(rel =>
			rel?.['@_Type']?.includes('/slideLayout') && rel?.['@_Target']
		);

		if (!layoutRel) {
            // console.log(`[LayoutCleaner] No slideLayout relationship found for slide: ${slide.path}`);
			return null;
		}

        const layoutPath = resolvePath(slideRelsPath, layoutRel['@_Target']); // Use imported resolvePath
        if (!layoutPath || !zip.file(layoutPath)) {
             console.warn(`[LayoutCleaner] Layout target "${layoutRel['@_Target']}" resolved to non-existent file: ${layoutPath || 'resolution failed'} from slide: ${slide.path}`);
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
		const layoutRelsPath = layoutPath.replace(/^(.*\/slideLayouts\/)([^/]+)$/, '$1_rels/$2.rels');
		const layoutRelsObj = await parseXmlSafely(zip, layoutRelsPath);

        if (layoutRelsObj._notFoundOrEmpty || layoutRelsObj._parseFailed || !layoutRelsObj?.Relationships?.Relationship) {
            // console.log(`[LayoutCleaner] No valid relationships found for layout: ${layoutPath}`);
             return null;
        }

		const layoutRels = Array.isArray(layoutRelsObj.Relationships.Relationship)
			? layoutRelsObj.Relationships.Relationship
			: [layoutRelsObj.Relationships.Relationship];

		const masterRel = layoutRels.find(rel => rel?.['@_Type']?.includes('/slideMaster') && rel?.['@_Target']);

		if (!masterRel) {
            // console.log(`[LayoutCleaner] No slideMaster relationship found for layout: ${layoutPath}`);
            return null;
        }

        const masterPath = resolvePath(layoutRelsPath, masterRel['@_Target']); // Use imported resolvePath
         if (!masterPath || !zip.file(masterPath)) {
             console.warn(`[LayoutCleaner] Master target "${masterRel['@_Target']}" resolved to non-existent file: ${masterPath || 'resolution failed'} from layout: ${layoutPath}`);
             return null;
        }

		return {
			path: masterPath,
			rId: masterRel['@_Id']
		};
	} catch (error) {
		console.error(`[LayoutCleaner] Error getting master for layout ${layoutPath}:`, error.message);
		return null;
	}
}

async function updateMasterLayoutReferences(zip, masterPath, usedLayoutsSet) {
	const masterRelsPath = masterPath.replace(/^(.*\/slideMasters\/)([^/]+)$/, '$1_rels/$2.rels');
	try {
		const masterRelsObj = await parseXmlSafely(zip, masterRelsPath);

        if (masterRelsObj._notFoundOrEmpty || masterRelsObj._parseFailed) {
            // console.log(`[LayoutCleaner] Master rels not found or parse failed, skipping update: ${masterRelsPath}`);
            return;
        }
        if (!masterRelsObj?.Relationships?.Relationship) {
            // console.log(`[LayoutCleaner] No relationships found in master rels, skipping update: ${masterRelsPath}`);
             return;
        }


		const relationships = Array.isArray(masterRelsObj.Relationships.Relationship)
			? masterRelsObj.Relationships.Relationship
			: [masterRelsObj.Relationships.Relationship];

        const initialCount = relationships.length;
		let validLayoutRels = [];

		const filteredRelationships = relationships.filter(rel => {
			if (!rel?.['@_Type'] || !rel?.['@_Target']) {
                console.warn(`[LayoutCleaner] Invalid relationship in ${masterRelsPath}:`, JSON.stringify(rel).substring(0,100));
				return false; // Keep invalid relationships? Maybe safer to keep them? Let's keep them for now. Changed to false.
			}
			if (!rel['@_Type'].includes('/slideLayout')) {
				return true; // Keep non-layout relationships
			}

			const layoutPath = resolvePath(masterRelsPath, rel['@_Target']); // Use imported resolvePath
			const isUsed = layoutPath && usedLayoutsSet.has(layoutPath);
            if (isUsed) {
                validLayoutRels.push(rel);
            } else {
                // console.log(`[LayoutCleaner] Removing unused layout reference: ${rel['@_Target']} (resolved: ${layoutPath}) from ${masterRelsPath}`);
            }
			return isUsed;
		});

		if (filteredRelationships.length < initialCount) {
			masterRelsObj.Relationships.Relationship = filteredRelationships.length > 0 ? filteredRelationships : undefined;
			const updatedRelsXml = buildXml(masterRelsObj);
			zip.file(masterRelsPath, updatedRelsXml);
			console.log(`[LayoutCleaner] Updated master rels ${masterRelsPath}: removed ${initialCount - filteredRelationships.length} layout references.`);

			await updateMasterXmlLayoutList(zip, masterPath, validLayoutRels);
		} else {
            // console.log(`[LayoutCleaner] No layout references needed removal in ${masterRelsPath}`);
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
            // console.log(`[LayoutCleaner] Layout ID list (sldLayoutIdLst) not found in master XML: ${masterPath}`);
			return;
		}

		const validLayoutRIds = new Set(validLayoutRelationships.map(rel => rel['@_Id']));

		const currentLayoutIds = Array.isArray(layoutIdList) ? layoutIdList : [layoutIdList];
        const initialCount = currentLayoutIds.length;

		const filteredLayoutIds = currentLayoutIds.filter(layoutId => {
            const rId = layoutId?.['@_r:id'];
            const keep = rId && validLayoutRIds.has(rId);
            // if (!keep && rId) {
            //     console.log(`[LayoutCleaner] Removing layout ID r:id="${rId}" from master XML: ${masterPath}`);
            // }
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
		} else {
            // console.log(`[LayoutCleaner] No layout ID references needed removal in master XML: ${masterPath}`);
        }
	} catch (error) {
		console.error(`[LayoutCleaner] Error updating master XML layout list for ${masterPath}:`, error.message);
	}
}

export async function getUsedLayoutsAndMasters(zip, usedSlides) {
	const usedLayouts = new Set();
	const usedMasters = new Set();

	if (!usedSlides || usedSlides.length === 0) {
        console.log("[getUsedLayoutsAndMasters] No slides provided, returning empty sets.");
		return { usedLayouts, usedMasters };
	}

	try {
        console.log(`[getUsedLayoutsAndMasters] Analyzing ${usedSlides.length} slides...`);
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
        console.log(`[getUsedLayoutsAndMasters] Analysis complete. Found ${usedLayouts.size} layouts and ${usedMasters.size} masters.`);
		return { usedLayouts, usedMasters };
	} catch (error) {
		console.error('[getUsedLayoutsAndMasters] Error analyzing used layouts and masters:', error.message);
		return { usedLayouts: new Set(), usedMasters: new Set() }; // Return empty sets on error
	}
}
