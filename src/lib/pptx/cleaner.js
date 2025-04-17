import { buildXml, parseXml } from './xml/parser';
import { PRESENTATION_PATH, MEDIA_PATH_PREFIX } from './constants';
import {
  removeUnusedLayouts,
  updatePresentationReferences
  // getLayoutMaster, // Assuming this is internal to layout-cleaner or not needed here
  // REMOVE getUsedLayoutsAndMasters import
} from './layout-cleaner'; // Functions now expect memFS
import { findMediaFiles } from './media'; // Function now expects memFS
import {
    zipToMemFS,
    memFSToZip,
    readFileFromMemFS,
    writeFileToMemFS,
    deleteFileFromMemFS,
    fileExistsInMemFS,
    listFilesFromMemFS
} from './zip-fs'; // Import new helpers

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

// Modify the function signature to accept memFS directly instead of zip
export async function cleanUnusedResources(inputMemFS, onProgress = () => {}, options = {}) {
  // Use the passed memFS directly. Create a shallow copy if mutation is a concern,
  // but for now, let's work directly on the passed object.
  let memFS = inputMemFS;
  let usedLayouts = new Set(); // Initialize sets
  let usedMasters = new Set(); // Initialize sets
  try {
    console.log('Starting resource cleanup process...');
    // REMOVE the internal zipToMemFS call, as memFS is now passed in
    // memFS = await zipToMemFS(zip);

    const cleanOptions = {
      removeUnusedLayouts: true,
      cleanMediaInUnusedLayouts: false, // Keep this option, but its logic might need adjustment
      ...options
    };

    onProgress('init', { percentage: 10, status: 'Analyzing slides...' });
    const usedSlides = await getUsedSlides(memFS); // Pass memFS

    // REMOVE the call to getUsedLayoutsAndMasters
    // onProgress('init', { percentage: 30, status: 'Analyzing slide layouts and masters...' });
    // const { usedLayouts: initialUsedLayouts, usedMasters: initialUsedMasters } = await getUsedLayoutsAndMasters(memFS, usedSlides);

    if (cleanOptions.removeUnusedLayouts) {
      onProgress('init', { percentage: 30, status: 'Cleaning unused layouts and masters...' });
      // Call removeUnusedLayouts and get the results
      const layoutCleanupResult = await removeUnusedLayouts(memFS, (status) => {
        // Adjust percentage range if needed (e.g., 30 to 70)
        const basePercentage = 30;
        const range = 40; // 70 - 30
        // Safely access percentage, default to 0 if invalid
        const currentPercentage = (typeof status?.percentage === 'number' && !isNaN(status.percentage)) ? status.percentage : 0;
        const calculatedPercentage = basePercentage + (currentPercentage / 100 * range);
        // Pass status text along
        onProgress('init', { percentage: calculatedPercentage, status: status?.status || 'Processing layouts...' });
      });

      // 关键修复：保证结构健壮
      memFS = layoutCleanupResult && layoutCleanupResult.memFS ? layoutCleanupResult.memFS : memFS;
      usedLayouts = layoutCleanupResult && layoutCleanupResult.usedLayouts ? layoutCleanupResult.usedLayouts : new Set();
      usedMasters = layoutCleanupResult && layoutCleanupResult.usedMasters ? layoutCleanupResult.usedMasters : new Set();

      if (layoutCleanupResult && layoutCleanupResult.error) {
          console.error("Layout cleanup failed, proceeding with potentially incomplete cleanup.", layoutCleanupResult.error);
      }
    } else {
       // If not removing layouts, we still need to determine used layouts/masters
       // This part needs reconsideration. If removeUnusedLayouts is skipped,
       // how do we get the definitive usedLayouts/usedMasters for media cleaning?
       // Option 1: Run parts of removeUnusedLayouts logic (finding used items) without deleting.
       // Option 2: Assume all layouts/masters are used if not cleaning them.
       // For now, let's assume we need to calculate them if removeUnusedLayouts is false.
       // This requires extracting the calculation logic into a separate function again,
       // or duplicating it here. Let's re-introduce a function for calculation only.
       // *** Revisit this logic based on actual requirements ***
       console.warn("Skipping layout removal. Media cleaning might be affected if used layouts/masters aren't determined.");
       // Placeholder: Calculate used layouts/masters without removing anything
       // This requires a function similar to the old getUsedLayoutsAndMasters
       // For simplicity now, let's assume if removeUnusedLayouts is false, we don't clean media based on layouts either.
       // Or, we need to call a dedicated function:
       // const layoutInfo = await getLayoutUsageInfo(memFS, usedSlides); // Hypothetical function
       // usedLayouts = layoutInfo.usedLayouts;
       // usedMasters = layoutInfo.usedMasters;
       onProgress('init', { percentage: 70, status: 'Skipped layout removal.' }); // Update progress
    }


    onProgress('init', { percentage: 70, status: 'Analyzing media files...' });

    // --- Media Analysis Section ---
    // This section now uses the 'usedLayouts' and 'usedMasters' obtained *after* potential layout removal.

    let allLayoutsMedia = new Set();
    // Get media from the *actually remaining* used layouts
    const usedLayoutPaths = Array.from(usedLayouts);
    console.log(`Analyzing media in ${usedLayoutPaths.length} used layouts (post-cleanup)`);
    const usedLayoutsMedia = await getMediaFromLayouts(memFS, usedLayoutPaths); // Pass final usedLayouts
    usedLayoutsMedia.forEach(media => allLayoutsMedia.add(media));

    // The logic for 'cleanMediaInUnusedLayouts' becomes tricky here because unused layouts
    // should have already been removed if cleanOptions.removeUnusedLayouts was true.
    // If cleanOptions.removeUnusedLayouts was false, then this option doesn't make much sense.
    // Let's simplify: We only care about media in the *final* set of used layouts/masters/slides.
    if (cleanOptions.cleanMediaInUnusedLayouts) {
        console.warn("'cleanMediaInUnusedLayouts' option might behave differently after refactoring. Focusing on media used by remaining slides/layouts/masters.");
    }

    // Collect media based on the final state of used slides, layouts, and masters
    const usedMedia = await collectUsedMedia(
      memFS || {}, // 兜底
      usedSlides || [],
      usedLayouts || new Set(),
      usedMasters || new Set(),
      allLayoutsMedia || new Set()
    ); // Pass final sets

    // ... (rest of the media cleanup logic: findMediaFiles, removeUnusedMedia) ...
    memFS = await removeUnusedMedia(memFS || {}, usedMedia || new Set()); // Pass memFS, expect modified memFS back

    onProgress('init', { percentage: 90, status: 'Finalizing references...' });

    // 新增：强制更新 [Content_Types].xml
    memFS = await updateContentTypes(memFS);

    console.log('Resource cleanup completed successfully');
    // Return the final memFS state
    return { success: true, memFS: memFS, usedMedia: usedMedia }; // 新增 usedMedia
  } catch (error) {
    console.error('Error cleaning unused resources:', error);
    // Return failure and the state of memFS when error occurred
    // Ensure memFS is returned even in case of error
    return { success: false, memFS: memFS, error: error };
  }
}

async function getMediaFromLayouts(memFS, layoutPaths) { // Use memFS
  const mediaSet = new Set();
  try {
    console.log(`Analyzing media references in ${layoutPaths.length} layouts`);
    for (const layoutPath of layoutPaths) {
      const layoutRelsPath = layoutPath.replace('ppt/slideLayouts/', 'ppt/slideLayouts/_rels/') + '.rels';
      const layoutRelsXml = readFileFromMemFS(memFS, layoutRelsPath, 'string'); // Read from memFS
      if (!layoutRelsXml) {
        console.log(`No relationship file found for layout: ${layoutPath}`);
        continue;
      }
      console.log(`Analyzing relationships for layout: ${layoutPath}`);
      const layoutRelsObj = await parseXml(layoutRelsXml);
      if (!layoutRelsObj?.Relationships?.Relationship) {
        console.log(`No relationships found in: ${layoutRelsPath}`);
        continue;
      }
      const relationships = Array.isArray(layoutRelsObj.Relationships.Relationship)
        ? layoutRelsObj.Relationships.Relationship
        : [layoutRelsObj.Relationships.Relationship];
      console.log(`Found ${relationships.length} relationships in layout: ${layoutPath}`);
      let mediaCount = 0;
      for (const rel of relationships) {
        const relType = rel['@_Type'] || rel.Type;
        const target = rel['@_Target'] || rel.Target;
        if (!relType || !target) continue;
        if (relType.includes('/image') || relType.includes('/audio') || relType.includes('/video')) {
          const mediaPath = `ppt/${target.replace('../', '')}`;
          mediaSet.add(mediaPath);
          mediaCount++;
          console.log(`Layout ${layoutPath} references media: ${mediaPath}`);
        }
      }
      console.log(`Found ${mediaCount} media references in layout: ${layoutPath}`);
    }
    console.log(`Found ${mediaSet.size} media files referenced by layouts`);
    return mediaSet;
  } catch (error) {
    console.error('Error getting media from layouts:', error);
    return new Set();
  }
}

async function collectUsedMedia(memFS, usedSlides, usedLayouts, usedMasters, layoutsMedia = new Set()) { // Use memFS
  const usedMedia = new Set();
  try {
    // if (memFS.debug) console.time('collectUsedMedia'); // memFS doesn't have debug, adjust if needed
    console.log(`Processing ${usedSlides.length} non-hidden slides for media references`);
    const slideMedia = await getUsedMedia(memFS, usedSlides); // Pass memFS
    slideMedia.forEach(mediaPath => usedMedia.add(mediaPath));
    layoutsMedia.forEach(mediaPath => usedMedia.add(mediaPath));
    await processRelationshipFiles(memFS, usedLayouts, usedMasters, usedSlides, usedMedia); // Pass memFS
    // if (memFS.debug) { ... } else { ... } // Adjust logging if needed
    console.log('Media collection stats:', {
        slides: usedSlides.length,
        layouts: usedLayouts.size,
        masters: usedMasters.size,
        layoutsMedia: layoutsMedia.size,
        totalMedia: usedMedia.size
      });
  } catch (error) {
    console.error('Error collecting media files:', {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
  }
  return usedMedia;
}

async function processRelationshipFiles(memFS, usedLayouts, usedMasters, usedSlides, usedMedia) { // Use memFS
  const slideRelsFiles = usedSlides.map(slide => slide.path.replace('slides/', 'slides/_rels/') + '.rels');
  const layoutRelsFiles = Array.from(usedLayouts).map(layout => layout.replace('slideLayouts/', 'slideLayouts/_rels/') + '.rels');
  const masterRelsFiles = Array.from(usedMasters).map(master => master.replace('slideMasters/', 'slideMasters/_rels/') + '.rels');

  const relsFiles = Array.from(new Set([...slideRelsFiles, ...layoutRelsFiles, ...masterRelsFiles]))
    .filter(path => fileExistsInMemFS(memFS, path)); // Check existence in memFS

  console.log(`[processRelationshipFiles] Analyzing referenced rels files:`);
  relsFiles.forEach(f => console.log(`  - ${f}`));
  console.log(`[processRelationshipFiles] Total referenced rels files: ${relsFiles.length}`);

  await Promise.all(relsFiles.map(async (relsPath) => {
    try {
      const relsXml = readFileFromMemFS(memFS, relsPath, 'string'); // Read from memFS
      if (!relsXml) {
        console.log(`[processRelationshipFiles] No rels xml for: ${relsPath}`);
        return;
      }
      const relsObj = await parseXml(relsXml);
      if (!relsObj.Relationships || !relsObj.Relationships.Relationship) {
        console.log(`[processRelationshipFiles] No Relationships in: ${relsPath}`);
        return;
      }
      const relationships = Array.isArray(relsObj.Relationships.Relationship)
        ? relsObj.Relationships.Relationship
        : [relsObj.Relationships.Relationship];
      let foundCount = 0;
      relationships.forEach(rel => {
        const relType = rel['@_Type'] || rel.Type;
        if (relType && (relType.includes('/image') || relType.includes('/audio') || relType.includes('/video'))) {
          const target = rel['@_Target'] || rel.Target;
          if (target) {
            const mediaPath = `ppt/${target.replace('../', '')}`;
            usedMedia.add(mediaPath);
            foundCount++;
            console.log(`[processRelationshipFiles] ${relsPath} references media: ${mediaPath}`);
          }
        }
      });
      if (foundCount === 0) {
        console.log(`[processRelationshipFiles] ${relsPath} has no media references`);
      }
    } catch (error) {
      console.error(`[processRelationshipFiles] Error processing relationship file ${relsPath}:`, error);
    }
  }));
}

async function getUsedSlides(memFS) { // Use memFS
  try {
    const relsPath = 'ppt/_rels/presentation.xml.rels';
    const relsXml = readFileFromMemFS(memFS, relsPath, 'string'); // Read from memFS
    if (!relsXml) return [];
    const relsObj = await parseXml(relsXml);
    if (!relsObj.Relationships || !relsObj.Relationships.Relationship) return [];
    const relationships = Array.isArray(relsObj.Relationships.Relationship)
      ? relsObj.Relationships.Relationship
      : [relsObj.Relationships.Relationship];
    return relationships
      .filter(rel => {
        const relType = rel['@_Type'] || rel.Type;
        return relType && relType.includes('/slide');
      })
      .map(rel => ({
        rId: rel['@_Id'] || rel.Id,
        path: `ppt/${(rel['@_Target'] || rel.Target).replace('../', '')}`
      }));
  } catch (error) {
    console.error('Error getting used slides:', error);
    return [];
  }
}

async function getUsedMedia(memFS, usedSlides) { // Use memFS
  const usedMedia = new Set();
  try {
    for (const slide of usedSlides) {
      const slideRelsPath = slide.path.replace('slides/', 'slides/_rels/') + '.rels';
      const slideRelsXml = readFileFromMemFS(memFS, slideRelsPath, 'string'); // Read from memFS
      if (!slideRelsXml) continue;
      const slideRelsObj = await parseXml(slideRelsXml);
      if (!slideRelsObj.Relationships || !slideRelsObj.Relationships.Relationship) continue;
      const slideRels = Array.isArray(slideRelsObj.Relationships.Relationship)
        ? slideRelsObj.Relationships.Relationship
        : [slideRelsObj.Relationships.Relationship];
      const mediaRels = slideRels.filter(rel => {
        const relType = rel['@_Type'] || rel.Type;
        return relType && (relType.includes('/image') || relType.includes('/audio') || relType.includes('/video'));
      });
      for (const mediaRel of mediaRels) {
        const target = mediaRel['@_Target'] || mediaRel.Target;
        if (target) {
          const mediaPath = `ppt/${target.replace('../', '')}`;
          usedMedia.add(mediaPath);
        }
      }
    }
    return usedMedia;
  } catch (error) {
    console.error('Error getting used media files:', error);
    return new Set();
  }
}

async function removeUnusedMedia(memFS, usedMedia) { // Use memFS, return modified memFS
  try {
    // Pass memFS to findMediaFiles (remove temporary workaround)
    const mediaFiles = findMediaFiles(memFS);
    console.log(`Total media files: ${mediaFiles.length}`);
    console.log(`Used media files: ${usedMedia.size}`);

    const missingMedia = [];
    for (const mediaPath of usedMedia) {
      if (!fileExistsInMemFS(memFS, mediaPath)) { // Check in memFS
        console.warn(`Warning: Referenced media file does not exist: ${mediaPath}`);
        missingMedia.push(mediaPath);
      }
    }
    missingMedia.forEach(path => {
      console.log(`Removing non-existent media reference: ${path}`);
      usedMedia.delete(path);
    });

    const unusedMedia = mediaFiles.filter(path => !usedMedia.has(path));
    console.log(`Found ${unusedMedia.length} unused media files to remove`);

    if (shouldSkipMediaRemoval(mediaFiles.length, unusedMedia.length)) {
      console.warn('Safety check: Skipping media removal due to safety constraints');
      return memFS; // Return unmodified memFS
    }

    for (const mediaPath of unusedMedia) {
      console.log(`Removing unused media: ${mediaPath}`);
      deleteFileFromMemFS(memFS, mediaPath); // Delete from memFS
    }

    const remainingMedia = listFilesFromMemFS(memFS, 'ppt/media/')
        .filter(path => !path.includes('_rels'));
    console.log('Remaining media files after removal:', remainingMedia);

  } catch (error) {
    console.error('Error removing unused media files:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
  }
  return memFS; // Return potentially modified memFS
}

function shouldSkipMediaRemoval(totalCount, unusedCount) {
  if (totalCount === 0) {
    console.warn('No media files found in the presentation.');
    return true;
  }
  if (unusedCount > 0 && unusedCount === totalCount) {
    console.warn('Warning: Attempting to remove all media files. Skipping removal.');
    return true;
  }
  const removalPercentage = totalCount > 0 ? (unusedCount / totalCount) * 100 : 0;
  if (removalPercentage > 80) {
    console.warn(`Warning: Attempting to remove ${removalPercentage.toFixed(1)}% of media files. Skipping removal.`);
    return true;
  }
  return false;
}

async function updateContentTypes(memFS) { // Use memFS, return modified memFS
  try {
    console.log('Updating content types...');
    const contentTypesPath = '[Content_Types].xml';
    const contentTypesXml = readFileFromMemFS(memFS, contentTypesPath, 'string'); // Read from memFS
    if (!contentTypesXml) {
      console.warn('Content types file not found');
      return memFS;
    }

    console.log('Parsing content types XML...');
    let contentTypesObj;
    try {
      contentTypesObj = await parseXml(contentTypesXml);
      if (!contentTypesObj) {
        throw new Error('Failed to parse content types XML');
      }
    } catch (parseError) {
      console.error('Error parsing content types XML:', parseError);
      console.error('XML content snippet:', contentTypesXml.substring(0, 200) + '...');
      return memFS;
    }

    if (!contentTypesObj.Types) {
      console.error('Invalid content types structure: missing Types node');
      console.error('Content types object snippet:', JSON.stringify(contentTypesObj, null, 2).substring(0, 500) + '...');
      return memFS;
    }
    if (!contentTypesObj.Types.Override) {
      console.warn('No Override nodes found in content types');
      return memFS;
    }

    const overrides = Array.isArray(contentTypesObj.Types.Override)
      ? contentTypesObj.Types.Override
      : [contentTypesObj.Types.Override];
    console.log(`Found ${overrides.length} content type overrides`);

    const filteredOverrides = overrides.filter(override => {
      try {
        if (!override) {
          console.warn('Invalid override: undefined or null');
          return false;
        }
        const partName = override['@_PartName'] || override.PartName || (override.$ && override.$['PartName']);
        if (!partName) {
          console.warn('Override missing PartName attribute:', JSON.stringify(override).substring(0, 100));
          return false;
        }
        const filePath = partName.replace(/^\//, '');
        const exists = fileExistsInMemFS(memFS, filePath); // Check in memFS
        if (!exists) {
          console.log(`Removing content type for deleted file: ${filePath}`);
        }
        return exists;
      } catch (err) {
        console.error('Error processing override:', err);
        return false;
      }
    });

    if (filteredOverrides.length < overrides.length) {
      contentTypesObj.Types.Override = filteredOverrides.length > 0 ? filteredOverrides : undefined; // Handle empty array case
      try {
        const updatedContentTypesXml = buildXml(contentTypesObj);
        writeFileToMemFS(memFS, contentTypesPath, updatedContentTypesXml); // Write back to memFS
        console.log(`Updated [Content_Types].xml: removed ${overrides.length - filteredOverrides.length} references to deleted files`);
      } catch (buildError) {
        console.error('Error building updated content types XML:', buildError);
      }
    } else {
      console.log('No content type references needed to be removed');
    }
  } catch (error) {
    console.error('Error updating content types:', error);
    console.error('Error details:', {
      name: error.name,
      message: error.message,
      stack: error.stack
    });
  }
  return memFS; // Return potentially modified memFS
}