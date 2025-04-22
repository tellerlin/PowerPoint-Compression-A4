import { parseXmlWithNamespaces, buildXml, parseXml } from './xml/parser';
import { PRESENTATION_PATH, MEDIA_PATH_PREFIX } from './constants';
import {
  // Import the actual layout removal function here
  removeUnusedLayouts,
  updatePresentationReferences, // Keep this as it might be needed if layout removal *fails* but refs were still attempted
  getLayoutMaster,
  getUsedLayoutsAndMasters
} from './layout-cleaner';
import { findMediaFiles } from './media';

export async function cleanUnusedResources(zip, onProgress = () => {}, options = {}) {
  let successfulLayoutRemoval = false;
  let finalUsedLayouts = null;
  let finalUsedMasters = null;

  try {
    console.log('[Cleaner] Starting resource cleanup process...');

    const cleanOptions = {
      removeUnusedLayouts: options.removeUnusedLayouts !== undefined ? options.removeUnusedLayouts : true, // Default based on option presence
      cleanMediaInUnusedLayouts: options.cleanMediaInUnusedLayouts !== undefined ? options.cleanMediaInUnusedLayouts : true,
      ...options
    };

    onProgress('init', { percentage: 10, status: 'Analyzing slides...' });
    const usedSlides = await getUsedSlides(zip);
    if (usedSlides.length === 0) {
        console.warn('[Cleaner] No used slides found in the presentation.');
        // Proceeding, but layout/media cleanup might be ineffective
    }

    // --- Layout and Master Cleanup (if enabled) ---
    if (cleanOptions.removeUnusedLayouts) {
        console.log('[Cleaner] Layout removal is enabled. Executing layout/master cleanup...');
        // Call the actual removal function from layout-cleaner
        // It internally handles progress updates
        const layoutResult = await removeUnusedLayouts(zip, onProgress);
        if (layoutResult.success) {
            console.log('[Cleaner] Layout/master cleanup step completed successfully.');
            successfulLayoutRemoval = true;
            finalUsedLayouts = layoutResult.usedLayouts; // Store the results
            finalUsedMasters = layoutResult.usedMasters;
        } else {
            console.error('[Cleaner] Layout/master cleanup step failed. Proceeding with analysis based on current state.');
             // If failed, analyze existing structure to avoid errors later
            const analysisResult = await getUsedLayoutsAndMasters(zip, usedSlides);
            finalUsedLayouts = analysisResult.usedLayouts;
            finalUsedMasters = analysisResult.usedMasters;
        }
    } else {
        console.log('[Cleaner] Layout removal is disabled. Analyzing existing layouts/masters...');
        // If not removing, analyze which are used for media checks
        const analysisResult = await getUsedLayoutsAndMasters(zip, usedSlides);
        finalUsedLayouts = analysisResult.usedLayouts;
        finalUsedMasters = analysisResult.usedMasters;
    }
     // Ensure we have valid sets even if cleanup failed/skipped
    finalUsedLayouts = finalUsedLayouts instanceof Set ? finalUsedLayouts : new Set();
    finalUsedMasters = finalUsedMasters instanceof Set ? finalUsedMasters : new Set();


    // --- Media Cleanup ---
    onProgress('init', { percentage: 70, status: 'Analyzing media files...' });

    let layoutsMediaToKeep = new Set();
    // Determine which layouts to check for media based on options and success
    const layoutsToCheckForMedia = [];
    if (cleanOptions.cleanMediaInUnusedLayouts && successfulLayoutRemoval) {
        // Layouts were successfully removed, only check media from the *kept* layouts
        layoutsToCheckForMedia.push(...Array.from(finalUsedLayouts));
        console.log(`[Cleaner] Analyzing media from ${finalUsedLayouts.size} remaining used layouts.`);
    } else {
        // Layouts were NOT removed OR we don't clean media in unused ones: check all *currently existing* layouts
        const currentLayoutFiles = Object.keys(zip.files)
            .filter(path => path.startsWith('ppt/slideLayouts/') &&
                    path.endsWith('.xml') &&
                    !path.includes('_rels'));
        layoutsToCheckForMedia.push(...currentLayoutFiles);
        console.log(`[Cleaner] Analyzing media from all ${currentLayoutFiles.length} current layouts (includes unused if not removed or if removal failed).`);
    }
    layoutsMediaToKeep = await getMediaFromLayouts(zip, layoutsToCheckForMedia);


    const usedMedia = await collectUsedMedia(zip, usedSlides, finalUsedLayouts, finalUsedMasters, layoutsMediaToKeep);

    const allMediaPaths = findMediaFiles(zip);
    const unusedMediaPaths = allMediaPaths.filter(path => !usedMedia.has(path));
    console.log('==== Media Cleanup Pre-Check ====');
    console.log(`Total media files found: ${allMediaPaths.length}`);
    console.log(`Used media files identified: ${usedMedia.size}`);
    console.log(`Unused media files identified: ${unusedMediaPaths.length}`);
    console.log('==== Media Cleanup Pre-Check End ====');

    // Remove unused media (respecting safety check)
    await removeUnusedMedia(zip, usedMedia);


    // --- Final Content Type Update ---
    // This runs AFTER all potential file removals (layouts, masters, media)
    onProgress('init', { percentage: 95, status: 'Updating content types...' });
    await updateContentTypes(zip); // Single call at the end

    console.log('[Cleaner] Resource cleanup process completed.');
    return true;
  } catch (error) {
    console.error('[Cleaner] Error during resource cleanup:', error);
    // Optionally re-throw or handle differently
    return false;
  }
}

async function getMediaFromLayouts(zip, layoutPaths) {
  const mediaSet = new Set();
  try {
    // console.log(`[getMediaFromLayouts] Analyzing media references in ${layoutPaths.length} layouts.`);
    for (const layoutPath of layoutPaths) {
      const layoutRelsPath = layoutPath.replace('ppt/slideLayouts/', 'ppt/slideLayouts/_rels/') + '.rels';
      const layoutRelsFile = zip.file(layoutRelsPath);
      if (!layoutRelsFile) continue;

      const layoutRelsXml = await layoutRelsFile.async('string');
      if (!layoutRelsXml) continue;

      const layoutRelsObj = await parseXml(layoutRelsXml);
      if (!layoutRelsObj?.Relationships?.Relationship) continue;

      const relationships = Array.isArray(layoutRelsObj.Relationships.Relationship)
        ? layoutRelsObj.Relationships.Relationship
        : [layoutRelsObj.Relationships.Relationship];

      for (const rel of relationships) {
        const relType = rel['@_Type'] || rel.Type;
        const target = rel['@_Target'] || rel.Target;
        if (relType && target && (relType.includes('/image') || relType.includes('/audio') || relType.includes('/video'))) {
          const mediaPath = `ppt/${target.replace('../', '')}`;
          mediaSet.add(mediaPath);
        }
      }
    }
    console.log(`[getMediaFromLayouts] Found ${mediaSet.size} unique media files referenced by ${layoutPaths.length} analyzed layouts.`);
    return mediaSet;
  } catch (error) {
    console.error('[getMediaFromLayouts] Error getting media from layouts:', error);
    return mediaSet; // Return potentially partial set
  }
}

async function collectUsedMedia(zip, usedSlides, usedLayouts, usedMasters, layoutsMedia = new Set()) {
  const usedMedia = new Set(layoutsMedia); // Initialize with layout media
  const startTime = performance.now();

  try {
    console.log(`[collectUsedMedia] Processing ${usedSlides.length} slides, ${usedLayouts.size} layouts, ${usedMasters.size} masters for media.`);

    // Process relationship files for slides, layouts, and masters
    await processRelationshipFiles(zip, usedLayouts, usedMasters, usedSlides, usedMedia);

    const duration = performance.now() - startTime;
    console.log(`[collectUsedMedia] Media collection analysis took ${duration.toFixed(2)} ms.`);
    console.log('[collectUsedMedia] Media collection stats:', {
        slides: usedSlides.length,
        layouts: usedLayouts.size,
        masters: usedMasters.size,
        layoutsMediaAdded: layoutsMedia.size, // How many were passed in
        totalUniqueMedia: usedMedia.size // Final count
    });

  } catch (error) {
    console.error('[collectUsedMedia] Error collecting media files:', error);
  }

  return usedMedia;
}


async function processRelationshipFiles(zip, usedLayouts, usedMasters, usedSlides, usedMedia) {
  // Combine paths for all relevant components whose relationships we need to check
  const slideRelsFiles = usedSlides.map(slide => slide.path.replace(/slides\/([^\/]+)$/, 'slides/_rels/$1.rels'));
  const layoutRelsFiles = Array.from(usedLayouts).map(layout => layout.replace(/slideLayouts\/([^\/]+)$/, 'slideLayouts/_rels/$1.rels'));
  const masterRelsFiles = Array.from(usedMasters).map(master => master.replace(/slideMasters\/([^\/]+)$/, 'slideMasters/_rels/$1.rels'));

  // Add other potential sources if necessary (e.g., theme rels)
  // const themeRelsFiles = Object.keys(zip.files).filter(p => p.match(/^ppt\/theme\/_rels\/theme\d+\.xml\.rels$/));

  const relsFilesToCheck = Array.from(new Set([
      ...slideRelsFiles,
      ...layoutRelsFiles,
      ...masterRelsFiles,
      // ...themeRelsFiles
  ])).filter(path => zip.file(path)); // Ensure the rels file actually exists

  console.log(`[processRelationshipFiles] Analyzing ${relsFilesToCheck.length} relationship files.`);

  await Promise.all(relsFilesToCheck.map(async (relsPath) => {
    try {
      const relsXml = await zip.file(relsPath)?.async('string');
      if (!relsXml) return; // Skip if file is empty or unreadable

      const relsObj = await parseXml(relsXml);
      if (!relsObj?.Relationships?.Relationship) return; // Skip if no relationships

      const relationships = Array.isArray(relsObj.Relationships.Relationship)
        ? relsObj.Relationships.Relationship
        : [relsObj.Relationships.Relationship];

      relationships.forEach(rel => {
        const relType = rel['@_Type'] || rel.Type;
        const target = rel['@_Target'] || rel.Target;

        // Check for media types
        if (relType && target && (
          relType.includes('/image') ||
          relType.includes('/audio') ||
          relType.includes('/video')
          // Add other media types if needed (e.g., oleObject for embedded files?)
        )) {
          // Resolve target path relative to the rels file's directory
          const baseDir = relsPath.substring(0, relsPath.lastIndexOf('/_rels')); // e.g., ppt/slides
          // Handle relative paths (../media/image1.png)
          const targetPath = target.startsWith('../')
              ? baseDir.substring(0, baseDir.lastIndexOf('/')) + '/' + target.substring(target.indexOf('/') + 1) // Go up one level from baseDir
              : baseDir + '/' + target; // Path relative to baseDir

          // Normalize path separators (optional but good practice)
          const normalizedMediaPath = targetPath.replace(/\\/g, '/');

          if (!usedMedia.has(normalizedMediaPath)) {
             // console.log(`[processRelationshipFiles] Adding used media: ${normalizedMediaPath} (from ${relsPath})`);
             usedMedia.add(normalizedMediaPath);
          }
        }
      });
    } catch (error) {
      console.error(`[processRelationshipFiles] Error processing relationship file ${relsPath}:`, error);
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
    if (!relsXml) return [];

    const relsObj = await parseXml(relsXml);
    if (!relsObj?.Relationships?.Relationship) return [];

    const relationships = Array.isArray(relsObj.Relationships.Relationship)
      ? relsObj.Relationships.Relationship
      : [relsObj.Relationships.Relationship];

    const slides = relationships
      .filter(rel => {
        const relType = rel['@_Type'] || rel.Type;
        // Be specific about the slide relationship type
        return relType === 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide';
      })
      .map(rel => {
          const target = rel['@_Target'] || rel.Target;
          // Correctly resolve the path relative to ppt/
          const path = target ? `ppt/${target.replace('../', '')}` : null;
          return {
              rId: rel['@_Id'] || rel.Id,
              path: path
          };
      })
      .filter(slide => slide.path !== null); // Filter out any invalid entries

    console.log(`[getUsedSlides] Found ${slides.length} slide relationships in presentation.xml.rels.`);
    return slides;
  } catch (error) {
    console.error('[getUsedSlides] Error getting used slides:', error);
    return [];
  }
}


async function removeUnusedMedia(zip, usedMedia) {
  try {
    const allMediaPaths = findMediaFiles(zip); // Gets files starting with ppt/media/
    console.log(`[removeUnusedMedia] Total media files found in ${MEDIA_PATH_PREFIX}: ${allMediaPaths.length}`);
    console.log(`[removeUnusedMedia] Used media files identified: ${usedMedia.size}`);

    // Verify existence of used media (important!)
    const missingMedia = [];
    for (const mediaPath of usedMedia) {
      if (!zip.file(mediaPath)) {
        console.warn(`[removeUnusedMedia] Warning: Referenced media file does not exist in ZIP: ${mediaPath}`);
        missingMedia.push(mediaPath);
      }
    }
    // Remove non-existent files from the 'used' set so we don't skip removal based on them
    missingMedia.forEach(path => usedMedia.delete(path));
    if (missingMedia.length > 0) {
        console.log(`[removeUnusedMedia] Adjusted used media count after checking existence: ${usedMedia.size}`);
    }

    // Determine unused files based on the adjusted usedMedia set
    const unusedMediaPaths = allMediaPaths.filter(path => !usedMedia.has(path));
    console.log(`[removeUnusedMedia] Found ${unusedMediaPaths.length} unused media files to remove.`);

    if (shouldSkipMediaRemoval(allMediaPaths.length, unusedMediaPaths.length)) {
      console.warn('[removeUnusedMedia] Safety check: Skipping media removal due to constraints.');
      return; // Exit the function, do not remove
    }

    let removedCount = 0;
    for (const mediaPath of unusedMediaPaths) {
      try {
        zip.remove(mediaPath);
        removedCount++;
      } catch (removeError) {
        console.error(`[removeUnusedMedia] Error removing media file ${mediaPath}:`, removeError);
      }
    }
    if (removedCount > 0) {
        console.log(`[removeUnusedMedia] Successfully removed ${removedCount} unused media files.`);
    } else if (unusedMediaPaths.length > 0) {
        console.log(`[removeUnusedMedia] Identified ${unusedMediaPaths.length} unused media files, but none were removed (check logs for errors).`);
    } else {
         console.log(`[removeUnusedMedia] No unused media files to remove.`);
    }

    const remainingMedia = Object.keys(zip.files).filter(path =>
      path.startsWith(MEDIA_PATH_PREFIX) && !path.includes('/_rels/') // Be more specific
    ).length;
    console.log(`[removeUnusedMedia] Remaining media files after removal: ${remainingMedia}`);

  } catch (error) {
    console.error('[removeUnusedMedia] Error removing unused media files:', error);
  }
}


function shouldSkipMediaRemoval(totalCount, unusedCount) {
  if (totalCount === 0) {
    // console.warn('[shouldSkipMediaRemoval] No media files found. Skipping removal check.');
    return false; // Nothing to skip if nothing exists
  }
  if (unusedCount <= 0) {
      return false; // Nothing to remove, so no need to skip
  }

  // Safety check: Avoid removing all files if some were potentially identified as used initially
  if (unusedCount === totalCount) {
    console.warn(`[shouldSkipMediaRemoval] Safety Check: Attempting to remove ALL (${totalCount}) media files found in ${MEDIA_PATH_PREFIX}. Skipping removal.`);
    return true;
  }

  // Safety check: Avoid removing an excessive percentage
  const removalPercentage = (unusedCount / totalCount) * 100;
  const threshold = 90; // Configurable threshold
  if (removalPercentage > threshold) {
    console.warn(`[shouldSkipMediaRemoval] Safety Check: Attempting to remove ${removalPercentage.toFixed(1)}% (${unusedCount}/${totalCount}) of media files (threshold ${threshold}%). Skipping removal.`);
    return true;
  }

  return false; // OK to proceed with removal
}


async function updateContentTypes(zip) {
  try {
    console.log('[updateContentTypes] Updating content types (final run)...');
    const contentTypesPath = '[Content_Types].xml';
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
      if (!contentTypesObj || !contentTypesObj.Types) {
          throw new Error('Invalid content types structure: missing <Types> node or failed parse.');
      }
    } catch (parseError) {
      console.error('[updateContentTypes] Error parsing content types XML:', parseError);
      return; // Stop if parsing fails
    }

    let changed = false;

    // Process Overrides
    if (contentTypesObj.Types.Override) {
      const overrides = Array.isArray(contentTypesObj.Types.Override)
        ? contentTypesObj.Types.Override
        : [contentTypesObj.Types.Override];

      const initialCount = overrides.length;
      // console.log(`[updateContentTypes] Found ${initialCount} content type overrides to check.`);

      const filteredOverrides = overrides.filter(override => {
        if (!override) return false; // Skip null/undefined entries
        const partName = override['@_PartName'] || override.PartName;
        if (!partName || typeof partName !== 'string') {
          console.warn('[updateContentTypes] Override missing or invalid PartName:', JSON.stringify(override).substring(0, 100));
          return false; // Remove invalid entries
        }
        const filePath = partName.startsWith('/') ? partName.substring(1) : partName;
        return zip.file(filePath) !== null; // Keep only if file exists
      });

      const finalCount = filteredOverrides.length;
      if (finalCount < initialCount) {
        contentTypesObj.Types.Override = finalCount > 0 ? filteredOverrides : undefined; // Remove node if empty
        console.log(`[updateContentTypes] Updated overrides: removed ${initialCount - finalCount} references.`);
        changed = true;
      }
    } else {
        // console.log('[updateContentTypes] No <Override> nodes found.');
    }

    // Process Defaults (Optional - Add checks if needed, e.g., if no file with that extension exists)
    // if (contentTypesObj.Types.Default) { ... }

    // Write back only if changes were made
    if (changed) {
      try {
        const updatedContentTypesXml = buildXml(contentTypesObj);
        zip.file(contentTypesPath, updatedContentTypesXml);
        console.log(`[updateContentTypes] Successfully updated [Content_Types].xml.`);
      } catch (buildError) {
        console.error('[updateContentTypes] Error building updated content types XML:', buildError);
      }
    } else {
      console.log('[updateContentTypes] No changes needed for content types.');
    }
  } catch (error) {
    console.error('[updateContentTypes] Error updating content types:', error);
  }
}

