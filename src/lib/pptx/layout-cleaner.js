// Import parseXml and buildXml, remove parseXmlWithNamespaces
import { buildXml, parseXml } from './xml/parser.js';
import { readFileFromMemFS, writeFileToMemFS, deleteFileFromMemFS, fileExistsInMemFS, listFilesFromMemFS } from './zip-fs.js';
import { PRESENTATION_PATH } from './constants.js';

/**
 * Remove unused layouts and masters from the PPTX file using memFS
 * @param {Object} memFS Memory File System object
 * @param {Function} onProgress Progress callback function
 * @returns {Promise<Object>} Returns the modified memFS object
 */
// Modify function signature to accept memFS and return memFS
export async function removeUnusedLayouts(memFS, onProgress = () => {}) {
  try {
    console.log('Starting layout cleanup process using memFS...');
    onProgress('init', { percentage: 20, status: 'Analyzing presentation structure...' });

    // 1. Get all slides using memFS
    const slides = await getAllSlides(memFS); // Pass memFS
    if (!slides || slides.length === 0) {
      console.warn('No slides found in the presentation');
      return { memFS, usedLayouts: new Set(), usedMasters: new Set() };
    }

    console.log(`Found ${slides.length} slides in the presentation`);
    onProgress('init', { percentage: 30, status: 'Analyzing slide layouts...' });

    // 2. Get used layouts using memFS
    const layoutPromises = slides.map(slide => getSlideLayout(memFS, slide)); // Pass memFS
    const layoutResults = await Promise.all(layoutPromises);

    const usedLayouts = new Set();
    layoutResults.forEach((layoutInfo, index) => {
      if (layoutInfo) {
        usedLayouts.add(layoutInfo.path);
        // console.log(`Slide ${slides[index].id} uses layout: ${layoutInfo.path}`); // Keep logging if needed
      } else {
        console.warn(`Could not determine layout for slide: ${slides[index].path}`);
      }
    });
    console.log(`Found ${usedLayouts.size} unique used layouts`);

    // 3. Get used masters using memFS
    const masterPromises = Array.from(usedLayouts).map(layoutPath => getLayoutMaster(memFS, layoutPath)); // Pass memFS
    const masterResults = await Promise.all(masterPromises);

    const usedMasters = new Set();
    masterResults.forEach(masterInfo => {
      if (masterInfo) {
        usedMasters.add(masterInfo.path);
      }
    });
    console.log(`Found ${usedMasters.size} unique used masters`);

    // 4. Get all layout and master files using memFS
    const allLayoutFiles = listFilesFromMemFS(memFS, 'ppt/slideLayouts/')
        .filter(path => !path.includes('_rels') && path.endsWith('.xml')); // Ensure XML files

    const allMasterFiles = listFilesFromMemFS(memFS, 'ppt/slideMasters/')
        .filter(path => !path.includes('_rels') && path.endsWith('.xml')); // Ensure XML files

    // ... (logging remains similar) ...

    onProgress('init', { percentage: 60, status: 'Removing unused layouts...' });

    // 5. Remove unused layouts using memFS
    const unusedLayouts = allLayoutFiles.filter(path => !usedLayouts.has(path));
    console.log(`Found ${unusedLayouts.length} unused layouts to remove`);

    for (const layoutPath of unusedLayouts) {
      console.log(`Removing unused layout: ${layoutPath}`);
      deleteFileFromMemFS(memFS, layoutPath); // Use deleteFileFromMemFS

      // Remove related rels file using memFS
      const layoutRelsPath = layoutPath.replace('ppt/slideLayouts/', 'ppt/slideLayouts/_rels/') + '.rels';
      if (fileExistsInMemFS(memFS, layoutRelsPath)) { // Use fileExistsInMemFS
        console.log(`Removing layout relationship file: ${layoutRelsPath}`);
        deleteFileFromMemFS(memFS, layoutRelsPath); // Use deleteFileFromMemFS
      }
    }

    onProgress('init', { percentage: 70, status: 'Removing unused masters...' });

    // 6. Remove unused masters using memFS
    const unusedMasters = allMasterFiles.filter(path => !usedMasters.has(path));
    console.log(`Found ${unusedMasters.length} unused masters to remove`);

    for (const masterPath of unusedMasters) {
      console.log(`Removing unused master: ${masterPath}`);
      deleteFileFromMemFS(memFS, masterPath); // Use deleteFileFromMemFS

      // Remove related rels file using memFS
      const masterRelsPath = masterPath.replace('ppt/slideMasters/', 'ppt/slideMasters/_rels/') + '.rels';
      if (fileExistsInMemFS(memFS, masterRelsPath)) { // Use fileExistsInMemFS
        console.log(`Removing master relationship file: ${masterRelsPath}`);
        deleteFileFromMemFS(memFS, masterRelsPath); // Use deleteFileFromMemFS
      }
    }

    // 7. Update presentation.xml references using memFS
    memFS = await updatePresentationReferences(memFS, usedLayouts, usedMasters); // Pass memFS, update memFS

    // 8. Update [Content_Types].xml using memFS
    memFS = await updateContentTypes(memFS); // Pass memFS, update memFS

    // 9. Update master layout references using memFS
    for (const masterPath of usedMasters) {
      memFS = await updateMasterLayoutReferences(memFS, masterPath, usedLayouts); // Pass memFS, update memFS
    }

    // ... (validation logging can use listFilesFromMemFS and readFileFromMemFS) ...
    console.log('删除后剩余布局文件:', listFilesFromMemFS(memFS, 'ppt/slideLayouts/').filter(p => p.endsWith('.xml')));
    const contentTypes = readFileFromMemFS(memFS, '[Content_Types].xml', 'string');
    console.log('内容类型中的布局引用:', contentTypes?.match(/slideLayout/g) || []);


    console.log('Layout cleanup completed successfully using memFS');
    return memFS; // Return the modified memFS
  } catch (error) {
    console.error('Error removing unused layouts with memFS:', error);
    // Decide error handling: return original memFS? throw?
    // For now, rethrow to indicate failure
    throw error;
    // return memFS; // Or return potentially partially modified memFS
  }
}

/**
 * Get all slides from the presentation using memFS
 * @param {Object} memFS Memory File System object
 * @returns {Promise<Array<Object>>} Array of slide info objects { id, rId, path? }
 */
// Modify function signature and logic for memFS
async function getAllSlides(memFS) {
  try {
    // Read presentation.xml from memFS
    const presentationXml = readFileFromMemFS(memFS, PRESENTATION_PATH, 'string');
    if (!presentationXml) {
        console.warn(`${PRESENTATION_PATH} not found in memFS.`);
        return [];
    }

    // Parse using the updated parseXml
    const presentationObj = await parseXml(presentationXml);
    // Adjust path based on fast-xml-parser structure if needed
    const slidesList = presentationObj?.['p:presentation']?.['p:sldIdLst']?.['p:sldId'];

    if (!slidesList) return [];

    const slides = Array.isArray(slidesList) ? slidesList : [slidesList];

    // Read presentation rels to map rId to path
    const presentationRelsPath = 'ppt/_rels/presentation.xml.rels';
    const presentationRelsXml = readFileFromMemFS(memFS, presentationRelsPath, 'string');
    let relationshipsMap = new Map();
    if (presentationRelsXml) {
        const relsObj = await parseXml(presentationRelsXml);
        const relationships = Array.isArray(relsObj?.Relationships?.Relationship)
            ? relsObj.Relationships.Relationship
            : [relsObj?.Relationships?.Relationship].filter(Boolean);

        relationships.forEach(rel => {
            const rId = rel['@_Id'] || rel.Id;
            const target = rel['@_Target'] || rel.Target;
            const type = rel['@_Type'] || rel.Type;
            if (rId && target && type && type.includes('/slide')) {
                relationshipsMap.set(rId, `ppt/${target.replace('../', '')}`);
            }
        });
    } else {
        console.warn(`${presentationRelsPath} not found. Slide paths cannot be determined.`);
    }


    return slides
      // Adjust attribute access based on fast-xml-parser (@_ prefix)
      .filter(slide => slide && slide['@_id'] && slide['@_r:id'])
      .map(slide => ({
        id: slide['@_id'], // Use @_id
        rId: slide['@_r:id'], // Use @_r:id
        path: relationshipsMap.get(slide['@_r:id']) // Add path if found
      }))
      .filter(slide => slide.path); // Only return slides where path could be determined

  } catch (error) {
    console.error('Error getting all slides from memFS:', error);
    return [];
  }
}

/**
 * Get the layout used by a slide using memFS
 * @param {Object} memFS Memory File System object
 * @param {Object} slide Slide information object (must include path)
 * @returns {Promise<Object|null>} Layout info { path, rId } or null
 */
// Modify function signature and logic for memFS
async function getSlideLayout(memFS, slide) {
  // Ensure slide object has the path determined by getAllSlides
  if (!slide || !slide.path) {
      console.warn('getSlideLayout called with invalid slide object (missing path):', slide);
      return null;
  }
  const slidePath = slide.path;

  try {
    // Get slide relationship file path
    const slideRelsPath = slidePath.replace('slides/', 'slides/_rels/') + '.rels';
    // Read slide rels file from memFS
    const slideRelsXml = readFileFromMemFS(memFS, slideRelsPath, 'string');
    if (!slideRelsXml) {
      console.warn(`Slide relationships file not found in memFS: ${slideRelsPath}`);
      return null;
    }

    // Parse using updated parseXml
    const slideRelsObj = await parseXml(slideRelsXml);
    if (!slideRelsObj?.Relationships?.Relationship) {
      console.warn(`Invalid slide relationships structure for: ${slidePath}`);
      return null;
    }

    const slideRels = Array.isArray(slideRelsObj.Relationships.Relationship)
      ? slideRelsObj.Relationships.Relationship
      : [slideRelsObj.Relationships.Relationship];

    // Find layout relationship (adjust attribute access for fast-xml-parser)
    const layoutRel = slideRels.find(rel => {
        const type = rel['@_Type'] || rel.Type;
        const target = rel['@_Target'] || rel.Target;
        return type && typeof type === 'string' && type.includes('/slideLayout') && target;
    });


    if (!layoutRel) {
      console.warn(`Layout relationship not found for slide: ${slidePath}`);
      return null;
    }

    const target = layoutRel['@_Target'] || layoutRel.Target;
    const rId = layoutRel['@_Id'] || layoutRel.Id;

    return {
      path: `ppt/${target.replace('../', '')}`, // Construct full path
      rId: rId
    };
  } catch (error) {
    console.error(`Error getting slide layout from memFS for slide ${slidePath}:`, error);
    return null;
  }
}

/**
 * Get the master used by a layout using memFS
 * @param {Object} memFS Memory File System object
 * @param {string} layoutPath Layout path
 * @returns {Promise<Object|null>} Master info { path, rId } or null
 */
// Modify function signature and logic for memFS
export async function getLayoutMaster(memFS, layoutPath) {
  try {
    // Get layout relationship file path
    const layoutRelsPath = layoutPath.replace('ppt/slideLayouts/', 'ppt/slideLayouts/_rels/') + '.rels';
    // Read layout rels file from memFS
    const layoutRelsXml = readFileFromMemFS(memFS, layoutRelsPath, 'string');
    if (!layoutRelsXml) {
        // console.warn(`Layout relationships file not found in memFS: ${layoutRelsPath}`); // Less verbose
        return null;
    }

    // console.log(`Getting master for layout: ${layoutPath}, using rels file: ${layoutRelsPath}`); // Keep if needed

    // Parse using updated parseXml
    const layoutRelsObj = await parseXml(layoutRelsXml);
    // Check for existence before accessing Relationship
    if (!layoutRelsObj?.Relationships?.Relationship) {
        // console.warn(`No relationships found in ${layoutRelsPath}`);
        return null;
    }
    const layoutRels = Array.isArray(layoutRelsObj.Relationships.Relationship)
      ? layoutRelsObj.Relationships.Relationship
      : [layoutRelsObj.Relationships.Relationship];

    // Find master relationship (adjust attribute access)
    const masterRel = layoutRels.find(rel => {
        const type = rel['@_Type'] || rel.Type;
        return type && type.includes('/slideMaster');
    });

    if (!masterRel) return null;

    const target = masterRel['@_Target'] || masterRel.Target;
    const rId = masterRel['@_Id'] || masterRel.Id;

    return {
      path: `ppt/${target.replace('../', '')}`, // Construct full path
      rId: rId
    };
  } catch (error) {
    console.error(`Error getting layout master from memFS for layout ${layoutPath}:`, error);
    return null;
  }
}


// Remove the deprecated getMasterReferencedLayouts function entirely
/*
async function getMasterReferencedLayouts(memFS, usedMasters) { ... }
*/

/**
 * Update presentation references to layouts and masters using memFS
 * @param {Object} memFS Memory File System object
 * @param {Set<string>} usedLayouts Set of used layout paths
 * @param {Set<string>} usedMasters Set of used master paths
 * @returns {Promise<Object>} Modified memFS object
 */
// Modify function signature and logic for memFS
export async function updatePresentationReferences(memFS, usedLayouts, usedMasters) {
  const relsPath = 'ppt/_rels/presentation.xml.rels';
  try {
    console.log('Updating presentation references in memFS...');
    // Read from memFS
    const relsXml = readFileFromMemFS(memFS, relsPath, 'string');
    if (!relsXml) {
      console.log('No presentation relationships file found in memFS');
      return memFS; // Return unmodified memFS
    }

    // Parse using updated parseXml
    const relsObj = await parseXml(relsXml);
    if (!relsObj?.Relationships?.Relationship) {
        console.warn(`Invalid structure in ${relsPath}`);
        return memFS;
    }
    const relationships = Array.isArray(relsObj.Relationships.Relationship)
      ? relsObj.Relationships.Relationship
      : [relsObj.Relationships.Relationship];

    // console.log(`Found ${relationships.length} relationships in presentation`); // Keep if needed

    // Filter unused layouts and masters relationships (adjust attribute access)
    const filteredRelationships = relationships.filter(rel => {
      if (!rel || typeof rel !== 'object') return false;

      const type = rel['@_Type'] || rel.Type;
      const target = rel['@_Target'] || rel.Target;

      // Keep relationships without Type or Target (or adjust based on actual needs)
      if (!type || !target) return true;

      // Keep non-layout and non-master relationships
      if (!type.includes('/slideLayout') && !type.includes('/slideMaster')) {
        return true;
      }

      // Check if layout is used
      if (type.includes('/slideLayout')) {
        const layoutPath = `ppt/${target.replace('../', '')}`;
        return usedLayouts.has(layoutPath);
      }

      // Check if master is used
      if (type.includes('/slideMaster')) {
        const masterPath = `ppt/${target.replace('../', '')}`;
        return usedMasters.has(masterPath);
      }

      return false; // Should not happen if type includes layout/master
    });

    // Update relationships only if changes were made
    if (filteredRelationships.length < relationships.length) {
        relsObj.Relationships.Relationship = filteredRelationships.length > 0 ? filteredRelationships : undefined; // Handle empty case

        // Build XML using updated buildXml
        const updatedRelsXml = buildXml(relsObj);
        // Write back to memFS
        writeFileToMemFS(memFS, relsPath, updatedRelsXml);

        console.log(`Updated presentation references: removed ${relationships.length - filteredRelationships.length} unused references`);
    } else {
        console.log('No presentation references needed removal.');
    }
    return memFS; // Return modified (or original) memFS
  } catch (error) {
    console.error('Error updating presentation references in memFS:', error);
    throw error; // Rethrow or return original memFS
  }
}

/**
 * Update [Content_Types].xml to remove references to deleted files using memFS
 * @param {Object} memFS Memory File System object
 * @returns {Promise<Object>} Modified memFS object
 */
// Modify function signature and logic for memFS, fix nested function
export async function updateContentTypes(memFS) {
  const contentTypesPath = '[Content_Types].xml';
  try {
    console.log('Updating content types in memFS...');
    // Read from memFS
    const contentTypesXml = readFileFromMemFS(memFS, contentTypesPath, 'string');
    if (!contentTypesXml) {
      console.warn('No content types file found in memFS');
      return memFS; // Return unmodified memFS
    }

    // Parse using updated parseXml
    const contentTypesObj = await parseXml(contentTypesXml);
    // Adjust path based on fast-xml-parser structure
    if (!contentTypesObj?.Types?.Override) {
      console.warn('Invalid content types structure');
      return memFS;
    }

    const overrides = Array.isArray(contentTypesObj.Types.Override)
      ? contentTypesObj.Types.Override
      : [contentTypesObj.Types.Override];

    // console.log(`Found ${overrides.length} content type overrides`); // Keep if needed

    // Filter overrides for files existing in memFS (adjust attribute access)
    const filteredOverrides = overrides.filter(override => {
      if (!override || typeof override !== 'object') {
        // console.log('Invalid override object:', override); // Less verbose
        return false;
      }

      // Use @_PartName prefix
      const partName = override['@_PartName'];

      if (!partName || typeof partName !== 'string') {
        // console.log('Override missing PartName attribute:', override); // Less verbose
        return false;
      }

      // Remove leading slash if present
      const path = partName.startsWith('/') ? partName.substring(1) : partName;
      // Check existence using fileExistsInMemFS
      const exists = fileExistsInMemFS(memFS, path);
      // if (!exists) console.log(`Removing content type for deleted file: ${path}`); // Keep if needed
      return exists;
    });

    // Update content types file only if changes were made
    if (filteredOverrides.length < overrides.length) {
      contentTypesObj.Types.Override = filteredOverrides.length > 0 ? filteredOverrides : undefined; // Handle empty case

      // Build XML using updated buildXml
      const updatedContentTypesXml = buildXml(contentTypesObj);
      // Write back to memFS
      writeFileToMemFS(memFS, contentTypesPath, updatedContentTypesXml);

      console.log(`Updated [Content_Types].xml: removed ${overrides.length - filteredOverrides.length} references to deleted files`);
    } else {
      console.log('No content type references needed to be removed');
    }
    return memFS; // Return modified (or original) memFS
  } catch (error) {
    console.error('Error updating content types in memFS:', error);
    throw error; // Rethrow or return original memFS
  }
}


/**
 * Update master layout references using memFS
 * @param {Object} memFS Memory File System object
 * @param {string} masterPath Master path
 * @param {Set<string>} usedLayouts Set of used layout paths
 * @returns {Promise<Object>} Modified memFS object
 */
// Modify function signature and logic for memFS
async function updateMasterLayoutReferences(memFS, masterPath, usedLayouts) {
  // Get master relationship file path
  const masterRelsPath = masterPath.replace('ppt/slideMasters/', 'ppt/slideMasters/_rels/') + '.rels';
  try {
    // Read master rels file from memFS
    const masterRelsXml = readFileFromMemFS(memFS, masterRelsPath, 'string');
    if (!masterRelsXml) {
      // console.warn(`Master relationships file not found: ${masterRelsPath}`); // Less verbose
      return memFS; // Return unmodified memFS
    }

    // console.log(`Updating master layout references for: ${masterPath}`); // Keep if needed

    // Parse using updated parseXml
    const masterRelsObj = await parseXml(masterRelsXml);
    if (!masterRelsObj?.Relationships?.Relationship) {
      // console.warn(`Invalid master relationships structure for: ${masterPath}`); // Less verbose
      return memFS;
    }

    const relationships = Array.isArray(masterRelsObj.Relationships.Relationship)
      ? masterRelsObj.Relationships.Relationship
      : [masterRelsObj.Relationships.Relationship];

    // Filter unused layout relationships (adjust attribute access)
    const filteredRelationships = relationships.filter(rel => {
      if (!rel || typeof rel !== 'object') return false;

      const type = rel['@_Type'] || rel.Type;
      const target = rel['@_Target'] || rel.Target;

      if (!type || !target) return false; // Invalid relationship

      // Keep non-layout relationships
      if (!type.includes('/slideLayout')) {
        return true;
      }

      // Check if layout is used
      const layoutPath = `ppt/${target.replace('../', '')}`;
      const isUsed = usedLayouts.has(layoutPath);
      // if (!isUsed) console.log(`Removing unused layout reference: ${layoutPath} from master: ${masterPath}`); // Keep if needed
      return isUsed;
    });

    // Update relationships file only if changes were made
    if (filteredRelationships.length < relationships.length) {
      masterRelsObj.Relationships.Relationship = filteredRelationships.length > 0 ? filteredRelationships : undefined; // Handle empty case

      // Build XML using updated buildXml
      const updatedRelsXml = buildXml(masterRelsObj);
      // Write back to memFS
      writeFileToMemFS(memFS, masterRelsPath, updatedRelsXml);

      console.log(`Updated master ${masterPath} references: removed ${relationships.length - filteredRelationships.length} unused layout references`);

      // Update master XML as well
      memFS = await updateMasterXml(memFS, masterPath, filteredRelationships); // Pass memFS, update memFS
    }
    return memFS; // Return modified (or original) memFS
  } catch (error) {
    console.error(`Error updating master layout references for ${masterPath} in memFS:`, error);
    throw error; // Rethrow or return original memFS
  }
}

/**
 * Update master XML to remove references to unused layouts using memFS
 * @param {Object} memFS Memory File System object
 * @param {string} masterPath Master path
 * @param {Array} validRelationships Valid relationships from the .rels file
 * @returns {Promise<Object>} Modified memFS object
 */
// Modify function signature and logic for memFS
async function updateMasterXml(memFS, masterPath, validRelationships) {
  try {
    // Read master XML from memFS
    const masterXml = readFileFromMemFS(memFS, masterPath, 'string');
    if (!masterXml) return memFS; // Return unmodified memFS

    // Parse using updated parseXml
    const masterObj = await parseXml(masterXml);

    // Get valid layout rIds from the valid relationships (adjust attribute access)
    const validLayoutIds = new Set(validRelationships
      .filter(rel => (rel['@_Type'] || rel.Type)?.includes('/slideLayout'))
      .map(rel => rel['@_Id'] || rel.Id)
      .filter(Boolean) // Filter out any null/undefined IDs
    );


    // Update sldLayoutIdLst (adjust path and attribute access)
    const layoutIdLstPath = ['p:sldMaster', 'p:sldLayoutIdLst']; // Path to the list
    let layoutIdLst = masterObj;
    for (const key of layoutIdLstPath) {
        if (layoutIdLst && typeof layoutIdLst === 'object' && key in layoutIdLst) {
            layoutIdLst = layoutIdLst[key];
        } else {
            layoutIdLst = null; // Path not found
            break;
        }
    }

    // Check if the layout list exists and has entries
    if (layoutIdLst && layoutIdLst['p:sldLayoutId']) {
      const originalLayoutIds = Array.isArray(layoutIdLst['p:sldLayoutId'])
        ? layoutIdLst['p:sldLayoutId']
        : [layoutIdLst['p:sldLayoutId']];

      // Filter the list based on valid rIds (adjust attribute access)
      const filteredLayoutIds = originalLayoutIds.filter(layoutId => {
        if (!layoutId || typeof layoutId !== 'object') return false;
        const rId = layoutId['@_r:id']; // Use @_r:id
        return rId && validLayoutIds.has(rId);
      });

      // Update the master object only if changes were made
      if (filteredLayoutIds.length < originalLayoutIds.length) {
        // Update the list in the master object
        // Handle cases where the list might become empty
        if (filteredLayoutIds.length > 0) {
          layoutIdLst['p:sldLayoutId'] = filteredLayoutIds;
        } else {
          // If the list becomes empty, remove the p:sldLayoutIdLst element entirely
          // Navigate back up one level to delete the parent key
          let parent = masterObj;
          for (let i = 0; i < layoutIdLstPath.length - 1; i++) {
              parent = parent[layoutIdLstPath[i]];
          }
          delete parent[layoutIdLstPath[layoutIdLstPath.length - 1]];
          console.log(`Removed empty p:sldLayoutIdLst from ${masterPath}`);
        }

        // Build XML using updated buildXml
        const updatedMasterXml = buildXml(masterObj);
        // Write back to memFS
        writeFileToMemFS(memFS, masterPath, updatedMasterXml);
        console.log(`Updated master XML ${masterPath}: removed ${originalLayoutIds.length - filteredLayoutIds.length} unused layout references`);
      }
    }
    return memFS; // Return modified (or original) memFS
  } catch (error) {
    console.error(`Error updating master XML ${masterPath} in memFS:`, error);
    throw error; // Rethrow or return original memFS
  }
}

// Removed the getUsedLayoutsAndMasters function as its logic is now integrated into removeUnusedLayouts
/*
async function getUsedLayoutsAndMasters(memFS, usedSlides) { ... }
*/