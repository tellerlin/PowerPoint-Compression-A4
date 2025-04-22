import { PRESENTATION_PATH, CONTENT_TYPES_PATH, SLIDE_PREFIX, NOTES_SLIDE_PREFIX } from './constants';

async function parseXmlDOM(zip, path) {
	try {
		const xml = await zip.file(path)?.async('string');
		if (!xml) {
            console.warn(`[parseXmlDOM] File not found or empty: ${path}`);
			return null;
		}
		const parser = new DOMParser();
		const doc = parser.parseFromString(xml, 'application/xml'); // Use application/xml for stricter parsing
        const parseError = doc.querySelector('parsererror');
        if (parseError) {
            console.error(`[parseXmlDOM] XML parsing error in ${path}:`, parseError.textContent);
            // Fallback attempt with text/xml
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

function resolvePath(basePath, target) {
    if (!target || typeof target !== 'string') return null;
    try {
        const baseDir = basePath.substring(0, basePath.lastIndexOf('/'));
        let resolvedPath;
        if (target.startsWith('../')) {
            const parentDir = baseDir.substring(0, baseDir.lastIndexOf('/'));
            resolvedPath = parentDir + '/' + target.substring(target.indexOf('/') + 1);
        } else if (target.startsWith('/')) {
            resolvedPath = target.substring(1);
        } else {
            resolvedPath = baseDir + '/' + target;
        }
        return resolvedPath.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
    } catch (e) {
        console.error(`[resolvePath] Error resolving target "${target}" relative to "${basePath}": ${e.message}`);
        return null;
    }
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
            return;
        }

        const slideIdList = presentationDoc.querySelector('sldIdLst, p\\:sldIdLst'); // Namespace aware query
        if (!slideIdList) {
             console.warn('[removeHiddenSlides] Slide ID list (sldIdLst) not found in presentation.xml.');
             return;
        }

		const relationships = Array.from(presentationRelsDoc.querySelectorAll('Relationship'));
		const slideRelationships = relationships.filter(rel =>
			rel.getAttribute('Type') === 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide'
		);

		console.log(`[removeHiddenSlides] Found ${slideRelationships.length} slide relationships.`);
		const slidesData = [];

		for (const rel of slideRelationships) {
			const rId = rel.getAttribute('Id');
			const target = rel.getAttribute('Target');
			if (!rId || !target) continue;

			const slidePath = resolvePath(presentationRelsPath, target);
			if (!slidePath || !zip.file(slidePath)) {
                console.warn(`[removeHiddenSlides] Slide target resolves to non-existent file: ${slidePath} (rId: ${rId})`);
                continue;
            }

            const slideNode = slideIdList.querySelector(`[r\\:id="${rId}"]`); // Namespace aware query
            if (!slideNode) {
                 console.warn(`[removeHiddenSlides] Could not find slide node in sldIdLst for rId: ${rId}`);
                 // Still check if hidden, but might not be able to remove node later
            }

			slidesData.push({
                rId: rId,
                path: slidePath,
                relsPath: slidePath.replace(SLIDE_PREFIX, `${SLIDE_PREFIX}_rels/`) + '.rels',
                notesSlideRelsPath: slidePath.replace(SLIDE_PREFIX, `${NOTES_SLIDE_PREFIX}_rels/`) + '.rels', // Path for notes slide rels
                notesSlidePath: null, // Will be determined later
                relNode: rel,
                slideNode: slideNode
            });
		}

        console.log(`[removeHiddenSlides] Processing ${slidesData.length} valid slide entries.`);
		const hiddenSlidesData = [];
        const visibleSlidesData = [];

		for (const slideData of slidesData) {
			const isHidden = await isSlideHidden(zip, slideData.path);
            // console.log(`[removeHiddenSlides] Slide ${slideData.path} hidden status: ${isHidden}`);
			if (isHidden) {
				hiddenSlidesData.push(slideData);
			} else {
                 visibleSlidesData.push(slideData);
            }
		}

		console.log(`[removeHiddenSlides] Found ${hiddenSlidesData.length} hidden slides to remove.`);

		if (hiddenSlidesData.length === 0) {
			console.log('[removeHiddenSlides] No hidden slides found. Exiting.');
			return;
		}

        const totalToRemove = hiddenSlidesData.length;
        let currentRemoved = 0;

		for (const slideData of hiddenSlidesData) {
            currentRemoved++;
            const progressPercent = 15 + (currentRemoved / totalToRemove) * 10; // Allocate 10% of overall progress (15-25%)
            onProgress('init', { percentage: progressPercent, status: `Removing hidden slide ${currentRemoved}/${totalToRemove}...`});

            let removedSlideNode = false;
            let removedRelNode = false;

            if (slideData.slideNode) {
                 removedSlideNode = removeNode(slideData.slideNode);
                 if (!removedSlideNode) console.warn(`[removeHiddenSlides] Failed to remove slide node for ${slideData.path}`);
            } else {
                 console.warn(`[removeHiddenSlides] Cannot remove slide node for ${slideData.path} as it was not found.`);
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

            if (presentationDoc) {
                const updatedPresentationXml = serializer.serializeToString(presentationDoc);
                zip.file(PRESENTATION_PATH, updatedPresentationXml);
            }
            if (presentationRelsDoc) {
                const updatedPresentationRelsXml = serializer.serializeToString(presentationRelsDoc);
                zip.file(presentationRelsPath, updatedPresentationRelsXml);
            }

			await updateContentTypesForRemovedFiles(zip, hiddenSlidesData.map(s => s.path));
            await updateContentTypesForRemovedFiles(zip, hiddenSlidesData.map(s => s.notesSlidePath).filter(p => p)); // Update for removed notes slides

            // Simple re-numbering based on remaining order (optional, might break links)
            // const finalSlideNodes = Array.from(slideIdList.querySelectorAll('sldId, p\\:sldId'));
            // finalSlideNodes.forEach((node, index) => {
            //     node.setAttribute('id', (256 + index).toString()); // Start IDs from 256 usually
            // });
            // const updatedPresentationXmlAgain = serializer.serializeToString(presentationDoc);
            // zip.file(PRESENTATION_PATH, updatedPresentationXmlAgain);

		}

		console.log(`[removeHiddenSlides] Finished. Successfully removed: ${removedCount}, Failed: ${failedToRemoveCount}`);

	} catch (error) {
		console.error('[removeHiddenSlides] Critical error during hidden slide removal:', error.message, error.stack);
        onProgress('error', { message: `Hidden slide removal failed: ${error.message}` });
	}
}


async function isSlideHidden(zip, slidePath) {
	try {
		const slideXml = await zip.file(slidePath)?.async('string');
		if (!slideXml) {
			console.warn(`[isSlideHidden] Unable to read slide file: ${slidePath}`);
			return false;
		}

		// Fast check: String matching (can be unreliable with formatting variations)
		const hasShowAttribute = /show\s*=\s*["']0["']/.test(slideXml);
		// console.log(`[isSlideHidden] String match 'show="0"' for ${slidePath}: ${hasShowAttribute}`);

        // Robust check: DOM parsing
        const slideDoc = await parseXmlDOM(zip, slidePath); // Use the DOM parser helper
        if (!slideDoc) {
            console.warn(`[isSlideHidden] Failed to parse slide XML, falling back to string match for: ${slidePath}`);
            return hasShowAttribute; // Fallback to string match if parsing fails
        }

		const slideElement = slideDoc.querySelector('sld, p\\:sld'); // Check common namespaces
		if (!slideElement) {
			console.warn(`[isSlideHidden] Slide element (sld or p:sld) not found in ${slidePath}. Assuming not hidden.`);
			return false;
		}

		const showValue = slideElement.getAttribute('show');
        // console.log(`[isSlideHidden] DOM query 'show' attribute value for ${slidePath}: ${showValue}`);

		return showValue === '0';

	} catch (error) {
		console.error(`[isSlideHidden] Error checking hidden status for ${slidePath}:`, error.message);
		return false; // Assume not hidden on error
	}
}


async function removeSlideFiles(zip, slideData) {
    let success = true;
    try {
        // console.log(`[removeSlideFiles] Removing slide file: ${slideData.path}`);
        zip.remove(slideData.path);

        if (zip.file(slideData.relsPath)) {
            // console.log(`[removeSlideFiles] Removing slide relationship file: ${slideData.relsPath}`);
            zip.remove(slideData.relsPath);
        }

        // Find and remove associated notes slide
        const notesSlidePath = await findNotesSlidePath(zip, slideData.relsPath);
        if (notesSlidePath) {
            slideData.notesSlidePath = notesSlidePath; // Store for content type update
            // console.log(`[removeSlideFiles] Removing associated notes slide: ${notesSlidePath}`);
            zip.remove(notesSlidePath);
             const notesSlideRelsPath = notesSlidePath.replace(NOTES_SLIDE_PREFIX, `${NOTES_SLIDE_PREFIX}_rels/`) + '.rels';
             if (zip.file(notesSlideRelsPath)) {
                 // console.log(`[removeSlideFiles] Removing notes slide relationship file: ${notesSlideRelsPath}`);
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
            }
        }
    } catch (error) {
        console.error(`[findNotesSlidePath] Error finding notes slide from ${slideRelsPath}:`, error.message);
    }
    return null;
}


async function updateContentTypesForRemovedFiles(zip, removedPaths) {
	if (removedPaths.length === 0) return;
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
        const partName = `/${removedPath}`; // ContentTypes usually have leading slash
        const overrideElement = typesElement.querySelector(`Override[PartName="${partName}"]`);
        if (overrideElement) {
            // console.log(`[updateContentTypesForRemovedFiles] Removing Override for: ${partName}`);
            if(removeNode(overrideElement)) {
                 changed = true;
            }
        }
    });

    if (changed) {
        try {
            const serializer = new XMLSerializer();
            const updatedXml = serializer.serializeToString(contentTypesDoc);
            zip.file(CONTENT_TYPES_PATH, updatedXml);
            console.log(`[updateContentTypesForRemovedFiles] Updated [Content_Types].xml, removed references for ${removedPaths.length} files.`);
        } catch (e) {
             console.error('[updateContentTypesForRemovedFiles] Failed to serialize or save updated [Content_Types].xml:', e.message);
        }
    }
}
