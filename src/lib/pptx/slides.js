import { PRESENTATION_PATH, CONTENT_TYPES_PATH, SLIDE_PREFIX, NOTES_SLIDE_PREFIX } from './constants';
import { resolvePath } from './utils';

export async function parseXmlDOM(zip, path) {
    try {
        const xml = await zip.file(path)?.async('string');
        if (!xml) {
            console.warn(`[parseXmlDOM] File not found or empty: ${path}`);
            return null;
        }
        
        const parser = new DOMParser();
        const doc = parser.parseFromString(xml, 'application/xml');
        
        const parseError = doc.querySelector('parsererror');
        if (parseError) {
            // 尝试使用备用解析方法
            const fallbackDoc = parser.parseFromString(xml, 'text/xml');
            const fallbackError = fallbackDoc.querySelector('parsererror');
            if (fallbackError) {
                console.error(`[parseXmlDOM] XML parse error for ${path}:`, parseError.textContent);
                return null;
            }
            return fallbackDoc;
        }
        
        return doc;
    } catch (error) {
        console.error(`[parseXmlDOM] Error parsing XML for ${path}:`, error.message);
        return null;
    }
}

function removeNode(node) {
	if (node && node.parentNode) {
		node.parentNode.removeChild(node);
        return true;
	}
    return false;
}

export async function removeHiddenSlides(zip, onProgress = () => {}) {
	console.log('[removeHiddenSlides] Starting hidden slide removal process...');
	let removedCount = 0;
    let failedToRemoveCount = 0;

	try {
		if (!zip || typeof zip.files !== 'object') {
			return;
		}

		const presentationRelsPath = 'ppt/_rels/presentation.xml.rels';
		const presentationRelsDoc = await parseXmlDOM(zip, presentationRelsPath);
		if (!presentationRelsDoc) {
			return;
		}

        const presentationDoc = await parseXmlDOM(zip, PRESENTATION_PATH);
        if (!presentationDoc) {
            console.error('[removeHiddenSlides] Failed to parse presentation.xml file.');
        }

        const slideIdList = presentationDoc ? presentationDoc.querySelector('sldIdLst, p\\:sldIdLst') : null;
        if (!slideIdList && presentationDoc) {
             console.warn('[removeHiddenSlides] Slide ID list (sldIdLst) not found in presentation.xml.');
        }

		const relationships = presentationRelsDoc ? Array.from(presentationRelsDoc.querySelectorAll('Relationship')) : [];
		const slideRelationships = relationships.filter(rel =>
			rel.getAttribute('Type') === 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide'
		);

		const slidesData = [];

        for (const rel of slideRelationships) {
    let rId = null, target = null, slidePath = null, slideNode = null;
    try {
        rId = rel.getAttribute('Id');
        target = rel.getAttribute('Target');
        if (!rId || !target) {
            console.warn(`[removeHiddenSlides] Missing Id or Target attribute in relationship`);
            continue;
        }
        
        slidePath = resolvePath(presentationRelsPath, target);
        if (!slidePath) {
            console.warn(`[removeHiddenSlides] Failed to resolve path for target: ${target}`);
            continue;
        }
        
        const fileExists = zip.file(slidePath) !== null;
        if (!fileExists) {
            console.warn(`[removeHiddenSlides] Slide file does not exist: ${slidePath}`);
            continue;
        }
        

try {
    slideNode = slideIdList ? slideIdList.querySelector(`sldId[r\\:id="${rId}"], p\\:sldId[r\\:id="${rId}"]`) : null;
    if (slideIdList && !slideNode) {
        // 尝试使用替代方法查找节点
        const allNodes = Array.from(slideIdList.querySelectorAll('sldId, p\\:sldId'));
        slideNode = allNodes.find(node => {
            const nodeRId = node.getAttribute('r:id') || node.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
            return nodeRId === rId;
        });
        
        if (!slideNode) {
            console.warn(`[removeHiddenSlides] Could not find slide node in sldIdLst for rId: ${rId}`);
        }
    }
} catch (e) {
    console.error(`[removeHiddenSlides] Error querying slideNode for rId "${rId}": ${e.message}`);
    slideNode = null;
}

        
        slidesData.push({
            rId: rId,
            path: slidePath,
            relsPath: slidePath.replace(SLIDE_PREFIX, `${SLIDE_PREFIX}_rels/`) + '.rels',
            notesSlideRelsPath: slidePath.replace(SLIDE_PREFIX, `${NOTES_SLIDE_PREFIX}_rels/`) + '.rels',
            notesSlidePath: null,
            relNode: rel,
            slideNode: slideNode
        });
    } catch (error) {
        console.error(`[removeHiddenSlides] Error processing slide relationship: ${error.message}`);
    }
}
        
		const hiddenSlidesData = [];
        const visibleSlidesData = [];

		for (const slideData of slidesData) {
			const isHidden = await isSlideHidden(zip, slideData.path);
			if (isHidden) {
				hiddenSlidesData.push(slideData);
			} else {
                visibleSlidesData.push(slideData);
            }
		}

		if (hiddenSlidesData.length === 0) {
            if (slidesData.length > 0) {
                console.log('[removeHiddenSlides] No hidden slides found among the valid slides. Exiting removal part.');
            } else {
                console.log('[removeHiddenSlides] No valid slides found to process for hidden status.');
            }
			return;
		}

        const totalToRemove = hiddenSlidesData.length;
        let currentRemoved = 0;

		for (const slideData of hiddenSlidesData) {
            currentRemoved++;
            const progressPercent = 15 + (currentRemoved / totalToRemove) * 10;
            onProgress('init', { percentage: progressPercent, status: `Removing hidden slide ${currentRemoved}/${totalToRemove}...`});

            let removedSlideNode = false;
            let removedRelNode = false;

            if (slideData.slideNode) {
                removedSlideNode = removeNode(slideData.slideNode);
                if (!removedSlideNode) {
                    console.warn(`[removeHiddenSlides] Failed to remove slide node for ${slideData.path}`);
                }
            }

            removedRelNode = removeNode(slideData.relNode);
            if (!removedRelNode) console.warn(`[removeHiddenSlides] Failed to remove relationship node for ${slideData.path}`);

            const success = await removeSlideFiles(zip, slideData);
            if (success) {
                removedCount++;
            } else {
                failedToRemoveCount++;
            }
		}

		if (removedCount > 0 || failedToRemoveCount > 0) {
			console.log('[removeHiddenSlides] Updating presentation and content types after removal...');
			const serializer = new XMLSerializer();

            if (presentationDoc && hiddenSlidesData.some(s => s.slideNode)) {
                // 确保更新演示文稿中的幻灯片顺序
                const updatedPresentationXml = serializer.serializeToString(presentationDoc);
                zip.file(PRESENTATION_PATH, updatedPresentationXml);
                console.log('[removeHiddenSlides] Updated presentation.xml with removed slides');
            }
            if (presentationRelsDoc) {
                const updatedPresentationRelsXml = serializer.serializeToString(presentationRelsDoc);
                zip.file(presentationRelsPath, updatedPresentationRelsXml);
                console.log('[removeHiddenSlides] Updated presentation.xml.rels with removed slide relationships');
            }

            const allRemovedPaths = [
                ...hiddenSlidesData.map(s => s.path),
                ...hiddenSlidesData.map(s => s.notesSlidePath)
            ].filter(p => p);

			await updateContentTypesForRemovedFiles(zip, allRemovedPaths);
            
            // 添加：更新演示文稿中的幻灯片ID列表
            await updatePresentationSlideIds(zip, visibleSlidesData);
		}

		console.log(`[removeHiddenSlides] Finished. Successfully removed: ${removedCount}, Failed: ${failedToRemoveCount}`);
	} catch (error) {
		console.error('[removeHiddenSlides] Critical error during hidden slide removal:', error.message, error.stack);
        onProgress('error', { message: `Hidden slide removal failed: ${error.message}` });
	}
}

async function isSlideHidden(zip, slidePath) {
	try {
		const slideDoc = await parseXmlDOM(zip, slidePath);
        if (!slideDoc) {
            console.warn(`[isSlideHidden] Failed to parse slide XML for: ${slidePath}. Assuming not hidden.`);
            return false;
        }

		const slideElement = slideDoc.querySelector('sld, p\\:sld');
		if (!slideElement) {
			console.warn(`[isSlideHidden] Slide element (sld or p:sld) not found in ${slidePath}. Assuming not hidden.`);
			return false;
		}

		const showValue = slideElement.getAttribute('show');
		return showValue === '0';

	} catch (error) {
		console.error(`[isSlideHidden] Error checking hidden status for ${slidePath}:`, error.message);
		return false;
	}
}

async function removeSlideFiles(zip, slideData) {
    let success = true;
    try {
        if (zip.file(slideData.path)) zip.remove(slideData.path);

        if (zip.file(slideData.relsPath)) {
            zip.remove(slideData.relsPath);
        }

        const notesSlidePath = await findNotesSlidePath(zip, slideData.relsPath);
        if (notesSlidePath) {
            slideData.notesSlidePath = notesSlidePath;
            if (zip.file(notesSlidePath)) zip.remove(notesSlidePath);
             const notesSlideRelsPath = notesSlidePath.replace(NOTES_SLIDE_PREFIX, `${NOTES_SLIDE_PREFIX}_rels/`) + '.rels';
             if (zip.file(notesSlideRelsPath)) {
                 zip.remove(notesSlideRelsPath);
             }
        }

    } catch (error) {
        console.error(`[removeSlideFiles] Error removing files for slide ${slideData.path}:`, error.message);
        success = false;
    }
    return success;
}

async function findNotesSlidePath(zip, slideRelsPath) {
     try {
        const slideRelsDoc = await parseXmlDOM(zip, slideRelsPath);
        if (!slideRelsDoc) return null;

        const relationships = Array.from(slideRelsDoc.querySelectorAll('Relationship'));
        const notesRel = relationships.find(rel =>
            rel.getAttribute('Type') === 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide'
        );

        if (notesRel) {
            const target = notesRel.getAttribute('Target');
            const notesPath = resolvePath(slideRelsPath, target);
            if (notesPath && zip.file(notesPath)) {
                return notesPath;
            } else if (notesPath) {
            } else {
                 console.warn(`[findNotesSlidePath] Failed to resolve notes slide target "${target}" from ${slideRelsPath}`);
            }
        }
    } catch (error) {
        console.error(`[findNotesSlidePath] Error finding notes slide from ${slideRelsPath}:`, error.message);
    }
    return null;
}

async function updateContentTypesForRemovedFiles(zip, removedPaths) {
	if (!removedPaths || removedPaths.length === 0) return;

    const contentTypesDoc = await parseXmlDOM(zip, CONTENT_TYPES_PATH);
    if (!contentTypesDoc) {
        console.error('[updateContentTypesForRemovedFiles] Failed to parse [Content_Types].xml');
        return;
    }

    let changed = false;
    const typesElement = contentTypesDoc.querySelector('Types');
    if (!typesElement) {
         console.error('[updateContentTypesForRemovedFiles] <Types> element not found in [Content_Types].xml');
         return;
    }

    removedPaths.forEach(removedPath => {
        if (!removedPath) return;
        const partName = `/${removedPath}`;
        const escapedPartName = partName.replace(/"/g, '\\"');
        const overrideElement = typesElement.querySelector(`Override[PartName="${escapedPartName}"]`);
        if (overrideElement) {
            if(removeNode(overrideElement)) {
                 changed = true;
                 console.log(`[updateContentTypesForRemovedFiles] Removed Override for: ${partName}`);
            } else {
                 console.warn(`[updateContentTypesForRemovedFiles] Failed to remove Override node for: ${partName}`);
            }
        }
    });

    // 检查并更新Default节点
    const allExtensions = new Set();
    Object.keys(zip.files).forEach(path => {
        if (!zip.files[path].dir) {
            const ext = path.split('.').pop().toLowerCase();
            if (ext) allExtensions.add(ext);
        }
    });
    
    const defaultElements = Array.from(typesElement.querySelectorAll('Default'));
    for (const defaultElement of defaultElements) {
        const extension = defaultElement.getAttribute('Extension');
        if (extension && !allExtensions.has(extension.toLowerCase())) {
            if (removeNode(defaultElement)) {
                changed = true;
                console.log(`[updateContentTypesForRemovedFiles] Removed Default for extension: ${extension}`);
            }
        }
    }

    if (changed) {
        try {
            const serializer = new XMLSerializer();
            const updatedXml = serializer.serializeToString(contentTypesDoc);
            zip.file(CONTENT_TYPES_PATH, updatedXml);
            console.log(`[updateContentTypesForRemovedFiles] Updated [Content_Types].xml, removed references for ${removedPaths.filter(p=>p).length} files.`);
        } catch (e) {
             console.error('[updateContentTypesForRemovedFiles] Failed to serialize or save updated [Content_Types].xml:', e.message);
        }
    } else {
        console.log('[updateContentTypesForRemovedFiles] No changes needed for [Content_Types].xml');
    }
}

async function updatePresentationSlideIds(zip, visibleSlidesData) {
    try {
        console.log('[updatePresentationSlideIds] Updating presentation slide IDs...');
        
        // 读取presentation.xml
        const presentationXml = await zip.file(PRESENTATION_PATH)?.async('string');
        if (!presentationXml) {
            console.error('[updatePresentationSlideIds] Failed to read presentation.xml');
            return;
        }
        
        // 解析XML
        const parser = new DOMParser();
        const presentationDoc = parser.parseFromString(presentationXml, 'application/xml');
        
        // 获取幻灯片ID列表
        const slideIdList = presentationDoc.querySelector('sldIdLst, p\\:sldIdLst');
        if (!slideIdList) {
            console.warn('[updatePresentationSlideIds] Slide ID list not found in presentation.xml');
            return;
        }
        
        // 获取所有可见幻灯片的ID
        const visibleSlideIds = visibleSlidesData.map(slide => slide.rId).filter(Boolean);
        
        // 移除所有不在可见幻灯片列表中的幻灯片ID
        const slideIdNodes = Array.from(slideIdList.querySelectorAll('sldId, p\\:sldId'));
        for (const slideIdNode of slideIdNodes) {
            const rId = slideIdNode.getAttribute('r:id') || slideIdNode.getAttribute('r\\:id');
            if (rId && !visibleSlideIds.includes(rId)) {
                slideIdList.removeChild(slideIdNode);
            }
        }
        
        // 序列化并保存更新后的XML
        const serializer = new XMLSerializer();
        const updatedPresentationXml = serializer.serializeToString(presentationDoc);
        zip.file(PRESENTATION_PATH, updatedPresentationXml);
        
        console.log('[updatePresentationSlideIds] Successfully updated presentation slide IDs');
    } catch (error) {
        console.error('[updatePresentationSlideIds] Error updating presentation slide IDs:', error.message);
    }
}
