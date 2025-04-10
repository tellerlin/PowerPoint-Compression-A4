import { parseXmlWithNamespaces, buildXml, parseXml } from './xml/parser';
import { PRESENTATION_PATH, MEDIA_PATH_PREFIX } from './constants';
import { removeUnusedLayouts, updateContentTypes, updatePresentationReferences, getLayoutMaster } from './layout-cleaner';
import { findMediaFiles } from './media';

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
    if (zip.debug) console.time('collectUsedMedia');
    
    // 并行获取幻灯片、布局和母版信息，避免重复调用getUsedSlides
    const usedSlides = await getUsedSlides(zip);
    console.log(`Found ${usedSlides ? usedSlides.length : 0} slides in the presentation`);
    
    if (!usedSlides || usedSlides.length === 0) {
      console.warn('No slides found when collecting media');
      return usedMedia;
    }
    
    // 并行获取布局、母版信息和幻灯片媒体，提高效率
    const [{ usedLayouts, usedMasters }, slideMedia] = await Promise.all([
      getUsedLayoutsAndMasters(zip, usedSlides),
      getUsedMedia(zip, usedSlides)
    ]);
    
    // 添加幻灯片中直接使用的媒体文件
    if (slideMedia) {
      slideMedia.forEach(mediaPath => mediaPath && usedMedia.add(mediaPath));
      console.log(`Found ${slideMedia.size} media files directly used in slides`);
    }
    
    // 处理关系文件中的媒体引用
    await processRelationshipFiles(zip, usedLayouts, usedMasters, usedSlides, usedMedia);
    
    if (zip.debug) {
      console.timeEnd('collectUsedMedia');
      console.log('媒体收集统计:', {
        slides: usedSlides.length,
        layouts: usedLayouts ? usedLayouts.size : 0,
        masters: usedMasters ? usedMasters.size : 0,
        media: usedMedia.size
      });
    } else {
      console.log('媒体收集统计:', {
        slides: usedSlides.length,
        layouts: usedLayouts ? usedLayouts.size : 0,
        masters: usedMasters ? usedMasters.size : 0,
        media: usedMedia.size
      });
    }
  } catch (error) {
    console.error('收集媒体文件错误:', {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
  }
  
  return usedMedia;
}

/**
 * Process relationship files to find media references
 * @param {JSZip} zip PPTX ZIP object
 * @param {Set<string>} usedLayouts Set of used layout paths
 * @param {Set<string>} usedMasters Set of used master paths
 * @param {Array} usedSlides Array of used slide objects
 * @param {Set<string>} usedMedia Set to store used media paths
 */
async function processRelationshipFiles(zip, usedLayouts, usedMasters, usedSlides, usedMedia) {
  // Get all relationship files
  const relsFiles = Object.keys(zip.files)
    .filter(path => path.includes('_rels/') && path.endsWith('.rels'));
  
  console.log(`Found ${relsFiles.length} relationship files to analyze`);
  
  // Parse each relationship file to find media references
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
    
    // Debug the structure for troubleshooting
    // console.log(`Relationship file ${relsPath} structure:`, JSON.stringify(relsObj, null, 2));
    
    if (!relsObj.Relationships || !relsObj.Relationships.Relationship) continue;
    
    const relationships = Array.isArray(relsObj.Relationships.Relationship)
      ? relsObj.Relationships.Relationship
      : [relsObj.Relationships.Relationship];
    
    // Find media relationships - check for both @_Type and Type attributes
    const mediaRels = relationships.filter(rel => {
      const relType = rel['@_Type'] || rel.Type;
      return relType && (
        relType.includes('/image') || 
        relType.includes('/audio') || 
        relType.includes('/video')
      );
    });
    
    for (const mediaRel of mediaRels) {
      const target = mediaRel['@_Target'] || mediaRel.Target;
      if (target) {
        const mediaPath = `ppt/${target.replace('../', '')}`;
        usedMedia.add(mediaPath);
        // console.log(`Found media reference in ${relsPath}: ${mediaPath}`);
      }
    }
  }
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
    
    // Debug the structure to help diagnose issues
    console.log('Presentation relationships structure:', JSON.stringify(relsObj, null, 2));
    
    if (!relsObj || !relsObj.Relationships || !relsObj.Relationships.Relationship) {
      console.warn('Invalid relationship structure in presentation.xml.rels');
      return [];
    }
    
    const relationships = Array.isArray(relsObj.Relationships.Relationship)
      ? relsObj.Relationships.Relationship
      : [relsObj.Relationships.Relationship];
    
    console.log(`Found ${relationships.length} relationships in presentation.xml.rels`);
    
    return relationships
      .filter(rel => {
        // 检查两种可能的属性名格式
        const relType = rel['@_Type'] || rel.Type;
        const hasSlideType = relType && (typeof relType === 'string') && relType.includes('/slide');
        if (hasSlideType) {
          console.log(`Found slide relationship: ${JSON.stringify(rel)}`);
        }
        return hasSlideType;
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
      
      // Get slide relationship file
      const slideRelsPath = slide.path.replace('slides/', 'slides/_rels/') + '.rels';
      const slideRelsXml = await zip.file(slideRelsPath)?.async('string');
      if (!slideRelsXml) continue;
      
      const slideRelsObj = await parseXml(slideRelsXml);
      const slideRels = Array.isArray(slideRelsObj.Relationships.Relationship)
        ? slideRelsObj.Relationships.Relationship
        : [slideRelsObj.Relationships.Relationship];
      
      // Find layout relationship with proper null checks
      const layoutRel = slideRels.find(rel => 
        rel && rel.Type && typeof rel.Type === 'string' && rel.Type.includes('/slideLayout')
      );
      if (!layoutRel || !layoutRel.Target) continue;
      
      const layoutPath = `ppt/${layoutRel.Target.replace('../', '')}`;
      usedLayouts.add(layoutPath);
      
      // Get master used by the layout using the imported function from layout-cleaner.js
      const masterInfo = await getLayoutMaster(zip, layoutPath);
      if (masterInfo && masterInfo.path) {
        usedMasters.add(masterInfo.path);
      }
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
      
      // Find media relationships with proper null checks
      const mediaRels = slideRels.filter(rel => 
        rel && rel.Type && typeof rel.Type === 'string' && (
          rel.Type.includes('/image') || 
          rel.Type.includes('/audio') || 
          rel.Type.includes('/video')
        ));
      
      for (const mediaRel of mediaRels) {
        if (mediaRel && mediaRel.Target) {
          const mediaPath = `ppt/${mediaRel.Target.replace('../', '')}`;
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

/**
 * Remove unused media files from the PPTX
 * @param {JSZip} zip PPTX ZIP object
 * @param {Set<string>} usedMedia Set of used media file paths
 */
async function removeUnusedMedia(zip, usedMedia) {
  try {
    // Get all media files using the imported function
    const mediaFiles = findMediaFiles(zip);
    
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
    
    // Safety checks to prevent accidental deletion
    if (shouldSkipMediaRemoval(mediaFiles.length, unusedMedia.length)) {
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

/**
 * Determine if media removal should be skipped based on safety checks
 * @param {number} totalCount Total number of media files
 * @param {number} unusedCount Number of unused media files
 * @returns {boolean} True if removal should be skipped
 */
function shouldSkipMediaRemoval(totalCount, unusedCount) {
  // Don't delete if we're removing all files (likely a detection error)
  if (unusedCount > 0 && unusedCount === totalCount) {
    console.warn('Warning: Attempting to remove all media files. This may indicate an error in media detection. Skipping removal.');
    return true;
  }
  
  // Don't delete if the percentage is too high
  const removalPercentage = (unusedCount / totalCount) * 100;
  if (removalPercentage > 80) {
    console.warn(`Warning: Attempting to remove ${removalPercentage.toFixed(1)}% of media files. This may indicate an error in media detection. Skipping removal.`);
    return true;
  }
  
  return false;
}

// updatePresentationLayouts and updatePresentationMasters functions are replaced by updatePresentationReferences from layout-cleaner.js

// updateContentTypes function is now imported from layout-cleaner.js