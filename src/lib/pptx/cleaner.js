import { parseXmlWithNamespaces, buildXml, parseXml } from './xml/parser';
import { PRESENTATION_PATH } from './constants';
import { removeUnusedLayouts, updateContentTypes, updatePresentationReferences } from './layout-cleaner';

/**
 * Clean unused resources (layouts, masters, and media files) from the PPTX file
 * @param {JSZip} zip PPTX ZIP object
 * @param {Function} onProgress Progress callback function
 * @returns {Promise<boolean>} Success status
 */
export async function cleanUnusedResources(zip, onProgress = () => {}) {
  try {
    console.log('Starting resource cleanup process...');
    
    // Step 1: Clean unused layouts and masters
    onProgress('init', { percentage: 10, status: 'Analyzing slide layouts and masters...' });
    const layoutResult = await removeUnusedLayouts(zip, (status) => {
      onProgress('init', { percentage: status.percentage, status: status.status });
    });
    
    // Step 2: Clean unused media files
    onProgress('init', { percentage: 70, status: 'Analyzing media files...' });
    const usedMedia = await collectUsedMedia(zip);
    await removeUnusedMedia(zip, usedMedia);
    onProgress('init', { percentage: 90, status: 'Cleaning unused media references...' });
    
    // Get used layouts and masters for updating presentation references
    const { usedLayouts, usedMasters } = await getUsedLayoutsAndMasters(zip, await getUsedSlides(zip));
    
    // Update presentation references with used layouts and masters
    await updatePresentationReferences(zip, usedLayouts, usedMasters);
    
    // Final update to content types to ensure all references are cleaned
    await updateContentTypes(zip);
    
    console.log('Resource cleanup completed successfully');
    return true;
  } catch (error) {
    console.error('Error cleaning unused resources:', error);
    return false;
  }
}

/**
 * Collect all used media files in the presentation
 * @param {JSZip} zip PPTX ZIP object
 * @returns {Promise<Set<string>>} Set of used media file paths
 */
async function collectUsedMedia(zip) {
  const usedMedia = new Set();
  
  try {
    console.log('Collecting used media files...');
    
    // Step 1: Get all slides in the presentation
    const usedSlides = await getUsedSlides(zip);
    console.log(`Found ${usedSlides.length} slides in the presentation`);
    
    // Step 2: Get all layouts and masters used in slides
    const { usedLayouts, usedMasters } = await getUsedLayoutsAndMasters(zip, usedSlides);
    console.log(`Found ${usedLayouts.size} used layouts and ${usedMasters.size} used masters`);
    
    // Step 3: Get all media files used directly in slides
    const slideMedia = await getUsedMedia(zip, usedSlides);
    console.log(`Found ${slideMedia.size} media files used in slides`);
    
    // Add slide media to the used media set
    for (const mediaPath of slideMedia) {
      usedMedia.add(mediaPath);
    }
    
    // Step 4: Get all relationship files
    const relsFiles = Object.keys(zip.files)
      .filter(path => path.includes('_rels/') && path.endsWith('.rels'));
    
    console.log(`Found ${relsFiles.length} relationship files to analyze`);
    
    // Step 5: Parse each relationship file to find media references
    for (const relsPath of relsFiles) {
      // Skip relationship files we've already processed in getUsedMedia
      if (relsPath.includes('slides/_rels/') && usedSlides.some(slide => 
          relsPath === slide.path.replace('slides/', 'slides/_rels/') + '.rels')) {
        continue;
      }
      
      // Check if this is a layout or master relationship file
      const isLayoutRels = relsPath.includes('slideLayouts/_rels/');
      const isMasterRels = relsPath.includes('slideMasters/_rels/');
      
      // If it's a layout or master relationship file, check if it's used
      if (isLayoutRels) {
        const layoutPath = relsPath.replace('_rels/', '').replace('.rels', '');
        if (!usedLayouts.has(layoutPath)) continue;
      } else if (isMasterRels) {
        const masterPath = relsPath.replace('_rels/', '').replace('.rels', '');
        if (!usedMasters.has(masterPath)) continue;
      }
      
      const relsXml = await zip.file(relsPath)?.async('string');
      if (!relsXml) continue;
      
      // Use XML parsing for more reliable results
      const relsObj = await parseXml(relsXml);
      if (!relsObj.Relationships || !relsObj.Relationships.Relationship) continue;
      
      const relationships = Array.isArray(relsObj.Relationships.Relationship)
        ? relsObj.Relationships.Relationship
        : [relsObj.Relationships.Relationship];
      
      // Find media relationships
      const mediaRels = relationships.filter(rel => 
        rel.Type.includes('/image') || 
        rel.Type.includes('/audio') || 
        rel.Type.includes('/video'));
      
      for (const mediaRel of mediaRels) {
        const mediaPath = `ppt/${mediaRel.Target.replace('../', '')}`;
        usedMedia.add(mediaPath);
      }
    }
    
    console.log(`Found ${usedMedia.size} total used media files`);
  } catch (error) {
    console.error('Error collecting used media files:', error);
  }
  
  return usedMedia;
}

/**
 * Get all slides used in the presentation
 * @param {JSZip} zip PPTX ZIP object
 * @returns {Promise<Array>} Array of slide objects with rId and path
 */
async function getUsedSlides(zip) {
  try {
    const relsPath = 'ppt/_rels/presentation.xml.rels';
    const relsXml = await zip.file(relsPath)?.async('string');
    if (!relsXml) return [];
    
    const relsObj = await parseXml(relsXml);
    const relationships = Array.isArray(relsObj.Relationships.Relationship)
      ? relsObj.Relationships.Relationship
      : [relsObj.Relationships.Relationship];
    
    return relationships
      .filter(rel => rel.Type.includes('/slide'))
      .map(rel => ({
        rId: rel.Id,
        path: `ppt/${rel.Target.replace('../', '')}`
      }));
  } catch (error) {
    console.error('Error getting used slides:', error);
    return [];
  }
}

/**
 * Get all layouts and masters used in slides
 * @param {JSZip} zip PPTX ZIP object
 * @param {Array} usedSlides Array of slide objects
 * @returns {Promise<Object>} Object with usedLayouts and usedMasters Sets
 */
async function getUsedLayoutsAndMasters(zip, usedSlides) {
  const usedLayouts = new Set();
  const usedMasters = new Set();
  
  try {
    // Process each slide
    for (const slide of usedSlides) {
      const slideXml = await zip.file(slide.path)?.async('string');
      if (!slideXml) continue;
      
      const slideObj = await parseXmlWithNamespaces(slideXml);
      
      // Get layout ID used by the slide
      const layoutRId = slideObj?.p_sld?.p_cSld?.$?.layoutId;
      if (!layoutRId) continue;
      
      // Get slide relationship file
      const slideRelsPath = slide.path.replace('slides/', 'slides/_rels/') + '.rels';
      const slideRelsXml = await zip.file(slideRelsPath)?.async('string');
      if (!slideRelsXml) continue;
      
      const slideRelsObj = await parseXml(slideRelsXml);
      const slideRels = Array.isArray(slideRelsObj.Relationships.Relationship)
        ? slideRelsObj.Relationships.Relationship
        : [slideRelsObj.Relationships.Relationship];
      
      // Find layout relationship
      const layoutRel = slideRels.find(rel => rel.Type.includes('/slideLayout'));
      if (!layoutRel) continue;
      
      const layoutPath = `ppt/${layoutRel.Target.replace('../', '')}`;
      usedLayouts.add(layoutPath);
      
      // Get master used by the layout
      const layoutXml = await zip.file(layoutPath)?.async('string');
      if (!layoutXml) continue;
      
      const layoutObj = await parseXmlWithNamespaces(layoutXml);
      
      // Get layout relationship file
      const layoutRelsPath = layoutPath.replace('slideLayouts/', 'slideLayouts/_rels/') + '.rels';
      const layoutRelsXml = await zip.file(layoutRelsPath)?.async('string');
      if (!layoutRelsXml) continue;
      
      const layoutRelsObj = await parseXml(layoutRelsXml);
      const layoutRels = Array.isArray(layoutRelsObj.Relationships.Relationship)
        ? layoutRelsObj.Relationships.Relationship
        : [layoutRelsObj.Relationships.Relationship];
      
      // Find master relationship
      const masterRel = layoutRels.find(rel => rel.Type.includes('/slideMaster'));
      if (!masterRel) continue;
      
      const masterPath = `ppt/${masterRel.Target.replace('../', '')}`;
      usedMasters.add(masterPath);
    }
    
    return { usedLayouts, usedMasters };
  } catch (error) {
    console.error('Error getting used layouts and masters:', error);
    return { usedLayouts: new Set(), usedMasters: new Set() };
  }
}

/**
 * Get all media files used in slides
 * @param {JSZip} zip PPTX ZIP object
 * @param {Array} usedSlides Array of slide objects
 * @returns {Promise<Set<string>>} Set of used media file paths
 */
async function getUsedMedia(zip, usedSlides) {
  const usedMedia = new Set();
  
  try {
    // Process each slide and its relationships
    for (const slide of usedSlides) {
      const slideRelsPath = slide.path.replace('slides/', 'slides/_rels/') + '.rels';
      const slideRelsXml = await zip.file(slideRelsPath)?.async('string');
      if (!slideRelsXml) continue;
      
      const slideRelsObj = await parseXml(slideRelsXml);
      const slideRels = Array.isArray(slideRelsObj.Relationships.Relationship)
        ? slideRelsObj.Relationships.Relationship
        : [slideRelsObj.Relationships.Relationship];
      
      // Find media relationships
      const mediaRels = slideRels.filter(rel => 
        rel.Type.includes('/image') || 
        rel.Type.includes('/audio') || 
        rel.Type.includes('/video'));
      
      for (const mediaRel of mediaRels) {
        const mediaPath = `ppt/${mediaRel.Target.replace('../', '')}`;
        usedMedia.add(mediaPath);
      }
    }
    
    return usedMedia;
  } catch (error) {
    console.error('Error getting used media files:', error);
    return new Set();
  }
}

/**
 * Remove unused media files from the PPTX
 * @param {JSZip} zip PPTX ZIP object
 * @param {Set<string>} usedMedia Set of used media file paths
 */
async function removeUnusedMedia(zip, usedMedia) {
  try {
    // Get all media files
    const mediaFiles = Object.keys(zip.files)
      .filter(path => path.startsWith('ppt/media/'));
    
    console.log(`Total media files: ${mediaFiles.length}`);
    console.log(`Used media files: ${usedMedia.size}`);
    
    // Double-check: Verify all media files in usedMedia actually exist
    for (const mediaPath of usedMedia) {
      if (!zip.file(mediaPath)) {
        console.warn(`Warning: Referenced media file does not exist: ${mediaPath}`);
      }
    }
    
    // Delete unused media files with additional verification
    const unusedMedia = mediaFiles.filter(path => !usedMedia.has(path));
    console.log(`Found ${unusedMedia.length} unused media files to remove`);
    
    // Additional safety check: Don't delete if we're removing too many files
    // This helps prevent accidental deletion of all media files due to a bug
    if (unusedMedia.length > 0 && unusedMedia.length === mediaFiles.length) {
      console.warn('Warning: Attempting to remove all media files. This may indicate an error in media detection. Skipping removal.');
      return;
    }
    
    // Additional safety check: Don't delete if the percentage is too high
    const removalPercentage = (unusedMedia.length / mediaFiles.length) * 100;
    if (removalPercentage > 80) {
      console.warn(`Warning: Attempting to remove ${removalPercentage.toFixed(1)}% of media files. This may indicate an error in media detection. Skipping removal.`);
      return;
    }
    
    for (const mediaPath of unusedMedia) {
      console.log(`Removing unused media: ${mediaPath}`);
      zip.remove(mediaPath);
    }
    
    // Update content types
    await updateContentTypes(zip);
  } catch (error) {
    console.error('Error removing unused media files:', error);
  }
}

// updatePresentationLayouts and updatePresentationMasters functions are replaced by updatePresentationReferences from layout-cleaner.js

// updateContentTypes function is now imported from layout-cleaner.js