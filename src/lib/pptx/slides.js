import { PRESENTATION_PATH, CONTENT_TYPES_PATH, SLIDE_PREFIX, NOTES_SLIDE_PREFIX } from './constants';
import { resolvePath } from './utils';

export async function parseXmlDOM(zip, path) {
	try {
		const xml = await zip.file(path)?.async('string');
		if (!xml) {
			return null;
		}
		const parser = new DOMParser();
		const doc = parser.parseFromString(xml, 'application/xml');
        const parseError = doc.querySelector('parsererror');
        if (parseError) {
            console.error(`[parseXmlDOM] XML parsing error in ${path}:`, parseError.textContent);
             const fallbackDoc = parser.parseFromString(xml, 'text/xml');
             const fallbackError = fallbackDoc.querySelector('parsererror');
             if(fallbackError) {
                  console.error(`[parseXmlDOM] Fallback XML parsing also failed for ${path}`);
                  return null;
             }
             console.warn(`[parseXmlDOM] Parsed ${path} with text/xml fallback.`);
             return fallbackDoc;
        }
		return doc;
	} catch (error) {
		console.error(`[parseXmlDOM] Error parsing XML at ${path}:`, error.message);
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
			console.error('[removeHiddenSlides] Invalid zip object provided.');
			return;
		}

		const presentationRelsPath = 'ppt/_rels/presentation.xml.rels';
		const presentationRelsDoc = await parseXmlDOM(zip, presentationRelsPath);
		if (!presentationRelsDoc) {
			console.error('[removeHiddenSlides] Failed to parse presentation relationships file.');
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

		console.log(`[removeHiddenSlides] Found ${slideRelationships.length} slide relationships.`);
        console.log(`[DEBUG removeHiddenSlides] Type of slideRelationships: ${typeof slideRelationships}`);
        console.log(`[DEBUG removeHiddenSlides] Is slideRelationships an Array? ${Array.isArray(slideRelationships)}`);
        console.log(`[DEBUG removeHiddenSlides] slideRelationships.length before loop: ${slideRelationships.length}`);
        if (slideRelationships.length > 0) {
            console.log(`[DEBUG removeHiddenSlides] First element type: ${typeof slideRelationships[0]}`);
            try {
                 console.log(`[DEBUG removeHiddenSlides] First element content (sample): ${slideRelationships[0]?.outerHTML?.substring(0, 100) || 'N/A'}`);
            } catch (e) {
                 console.error(`[DEBUG removeHiddenSlides] Error accessing outerHTML of first element: ${e.message}`);
            }
        }

		const slidesData = [];

		for (const rel of slideRelationships) {
            console.log(`[DEBUG removeHiddenSlides LOOP] --- Iteration Start ---`);
            let rId = null, target = null, slidePath = null, slideNode = null;

            try {
                try {
                    rId = rel.getAttribute('Id');
                    target = rel.getAttribute('Target');
                    console.log(`[DEBUG LOOP Step 1] Got attributes: rId=${rId}, target=${target}`);
                    if (!rId || !target) {
                        console.warn(`[removeHiddenSlides LOOP Step 1] Skipping relationship due to missing rId or Target.`);
                        continue;
                    }
                } catch (e) {
                    console.error(`[ERROR LOOP Step 1] Error getting attributes: ${e.message}`, rel);
                    continue;
                }

                try {
                    slidePath = resolvePath(presentationRelsPath, target);
                    console.log(`[DEBUG LOOP Step 2] Resolved path: ${slidePath}`);
                    if (!slidePath) {
                        console.warn(`[removeHiddenSlides LOOP Step 2] Skipping relationship (rId: ${rId}) because resolvePath returned null/empty.`);
                        continue;
                    }
                } catch (e) {
                    console.error(`[ERROR LOOP Step 2] Error resolving path for target "${target}": ${e.message}`);
                    continue;
                }

                let fileExists = false;
                try {
                    fileExists = zip.file(slidePath) !== null;
                    console.log(`[DEBUG LOOP Step 3] File "${slidePath}" exists: ${fileExists}`);
                    if (!fileExists) {
                        console.warn(`[removeHiddenSlides LOOP Step 3] Skipping relationship (rId: ${rId}) because resolved slide path "${slidePath}" does not exist in ZIP.`);
                        const nearbyFiles = Object.keys(zip.files).filter(f => f.startsWith('ppt/slides/')).slice(0, 10);
                        console.warn(`[removeHiddenSlides LOOP Step 3] Sample files in zip: ${JSON.stringify(nearbyFiles)}`);
                        continue;
                    }
                } catch (e) {
                    console.error(`[ERROR LOOP Step 3] Error checking file existence for path "${slidePath}": ${e.message}`);
                    continue;
                }

                try {
                    slideNode = slideIdList ? slideIdList.querySelector(`sldId[r\\:id="${rId}"], p\\:sldId[r\\:id="${rId}"]`) : null;
                    console.log(`[DEBUG LOOP Step 4] Found slideNode in sldIdList:`, slideNode ? 'Yes' : 'No/Not Checked');
                    if (slideIdList && !slideNode) {
                        console.warn(`[removeHiddenSlides LOOP Step 4] Note: Could not find slide node in sldIdLst for rId: ${rId}. Proceeding anyway.`);
                    }
                } catch (e) {
                    console.error(`[ERROR LOOP Step 4] Error querying slideNode for rId "${rId}": ${e.message}`);
                    slideNode = null;
                }

                try {
                    console.log(`[DEBUG removeHiddenSlides LOOP Step 5] Adding slide to process: rId=${rId}, path=${slidePath}`);
                    slidesData.push({
                        rId: rId,
                        path: slidePath,
                        relsPath: slidePath.replace(SLIDE_PREFIX, `${SLIDE_PREFIX}_rels/`) + '.rels',
                        notesSlideRelsPath: slidePath.replace(SLIDE_PREFIX, `${NOTES_SLIDE_PREFIX}_rels/`) + '.rels',
                        notesSlidePath: null,
                        relNode: rel,
                        slideNode: slideNode
                    });
                } catch (e) {
                    console.error(`[ERROR LOOP Step 5] Error pushing data for rId "${rId}": ${e.message}`);
                }

            } catch (outerError) {
                console.error(`[ERROR LOOP] Uncaught error during iteration for (potential rId: ${rId}): ${outerError.message}`, outerError.stack);
                continue;
            } finally {
                console.log(`[DEBUG removeHiddenSlides LOOP] --- Iteration End ---`);
            }
		}

		console.log(`[removeHiddenSlides] Processing ${slidesData.length} valid slide entries.`);
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

		console.log(`[removeHiddenSlides] Found ${hiddenSlidesData.length} hidden slides to remove.`);

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
                if (!removedSlideNode) console.warn(`[removeHiddenSlides] Failed to remove slide node for ${slideData.path}`);
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
                const updatedPresentationXml = serializer.serializeToString(presentationDoc);
                zip.file(PRESENTATION_PATH, updatedPresentationXml);
            }
            if (presentationRelsDoc) {
                const updatedPresentationRelsXml = serializer.serializeToString(presentationRelsDoc);
                zip.file(presentationRelsPath, updatedPresentationRelsXml);
            }

            const allRemovedPaths = [
                ...hiddenSlidesData.map(s => s.path),
                ...hiddenSlidesData.map(s => s.notesSlidePath)
            ].filter(p => p);

			await updateContentTypesForRemovedFiles(zip, allRemovedPaths);
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
            } else {
                 console.warn(`[updateContentTypesForRemovedFiles] Failed to remove Override node for: ${partName}`);
            }
        }
    });

    if (changed) {
        try {
            const serializer = new XMLSerializer();
            const updatedXml = serializer.serializeToString(contentTypesDoc);
            zip.file(CONTENT_TYPES_PATH, updatedXml);
            console.log(`[updateContentTypesForRemovedFiles] Updated [Content_Types].xml, removed Override references for ${removedPaths.filter(p=>p).length} files.`);
        } catch (e) {
             console.error('[updateContentTypesForRemovedFiles] Failed to serialize or save updated [Content_Types].xml:', e.message);
        }
    } else {
    }
}
