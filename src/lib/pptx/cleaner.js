import { buildXml, parseXml } from './xml/parser';
import { PRESENTATION_PATH, MEDIA_PATH_PREFIX } from './constants';
import {
  removeUnusedLayouts,
  updatePresentationReferences
} from './layout-cleaner';
import { findMediaFiles } from './media';
import {
    zipToMemFS,
    memFSToZip,
    readFileFromMemFS,
    writeFileToMemFS,
    deleteFileFromMemFS,
    fileExistsInMemFS,
    listFilesFromMemFS
} from './zip-fs';

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

export async function cleanUnusedResources(inputMemFS, onProgress = () => {}, options = {}) {
  let memFS = inputMemFS;
  let usedLayouts = new Set();
  let usedMasters = new Set();
  try {
    console.log('Starting resource cleanup process...');

    const cleanOptions = {
      removeUnusedLayouts: true,
      cleanMediaInUnusedLayouts: false,
      ...options
    };

    onProgress('init', { percentage: 10, status: 'Analyzing slides...' });
    const usedSlides = await getUsedSlides(memFS);

    if (cleanOptions.removeUnusedLayouts) {
      onProgress('init', { percentage: 30, status: 'Cleaning unused layouts and masters...' });
      const layoutCleanupResult = await removeUnusedLayouts(memFS, (status) => {
        const basePercentage = 30;
        const range = 40;
        const currentPercentage = (typeof status?.percentage === 'number' && !isNaN(status.percentage)) ? status.percentage : 0;
        const calculatedPercentage = basePercentage + (currentPercentage / 100 * range);
        onProgress('init', { percentage: calculatedPercentage, status: status?.status || 'Processing layouts...' });
      });

      memFS = layoutCleanupResult && layoutCleanupResult.memFS ? layoutCleanupResult.memFS : memFS;
      usedLayouts = layoutCleanupResult && layoutCleanupResult.usedLayouts ? layoutCleanupResult.usedLayouts : new Set();
      usedMasters = layoutCleanupResult && layoutCleanupResult.usedMasters ? layoutCleanupResult.usedMasters : new Set();

      if (layoutCleanupResult && layoutCleanupResult.removedLayouts && layoutCleanupResult.removedLayouts.length > 0) {
        await removeContentTypesOverrides(memFS, layoutCleanupResult.removedLayouts);
      }

      if (layoutCleanupResult && layoutCleanupResult.error) {
        console.error("Layout cleanup failed, proceeding with potentially incomplete cleanup.", layoutCleanupResult.error);
      }
    } else {
      console.warn("Skipping layout removal. Media cleaning might be affected if used layouts/masters aren't determined.");
      onProgress('init', { percentage: 70, status: 'Skipped layout removal.' });
    }

    onProgress('init', { percentage: 70, status: 'Analyzing media files...' });

    let allLayoutsMedia = new Set();
    const usedLayoutPaths = Array.from(usedLayouts);
    console.log(`Analyzing media in ${usedLayoutPaths.length} used layouts (post-cleanup)`);
    const usedLayoutsMedia = await getMediaFromLayouts(memFS, usedLayoutPaths);
    usedLayoutsMedia.forEach(media => allLayoutsMedia.add(media));

    if (cleanOptions.cleanMediaInUnusedLayouts) {
      console.warn("'cleanMediaInUnusedLayouts' option might behave differently after refactoring. Focusing on media used by remaining slides/layouts/masters.");
    }

    const usedMedia = await collectUsedMedia(
      memFS || {},
      usedSlides || [],
      usedLayouts || new Set(),
      usedMasters || new Set(),
      allLayoutsMedia || new Set()
    );

    memFS = await removeUnusedMedia(memFS || {}, usedMedia || new Set());

    onProgress('init', { percentage: 90, status: 'Finalizing references...' });

    memFS = await updateContentTypes(memFS);

    console.log('Resource cleanup completed successfully');
    return { success: true, memFS: memFS, usedMedia: usedMedia };
  } catch (error) {
    console.error('Error cleaning unused resources:', error);
    return { success: false, memFS: memFS, error: error };
  }
}

async function getMediaFromLayouts(memFS, layoutPaths) {
  const mediaSet = new Set();
  try {
    console.log(`Analyzing media references in ${layoutPaths.length} layouts`);
    for (const layoutPath of layoutPaths) {
      const layoutRelsPath = layoutPath.replace('ppt/slideLayouts/', 'ppt/slideLayouts/_rels/') + '.rels';
      const layoutRelsXml = readFileFromMemFS(memFS, layoutRelsPath, 'string');
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

// 改进资源清理逻辑
async function collectUsedMedia(memFS, usedSlides, usedLayouts, usedMasters, layoutsMedia = new Set()) {
  const usedMedia = new Set();
  try {
    console.log(`Processing ${usedSlides.length} slides for media references`);
    
    // 处理幻灯片中的媒体引用
    const slideMedia = await getUsedMedia(memFS, usedSlides);
    slideMedia.forEach(mediaPath => usedMedia.add(mediaPath));
    
    // 处理布局中的媒体引用
    layoutsMedia.forEach(mediaPath => usedMedia.add(mediaPath));
    
    // 处理关系文件中的媒体引用
    await processRelationshipFiles(memFS, usedLayouts, usedMasters, usedSlides, usedMedia);
    
    // 处理主题中的媒体引用
    await processThemeMedia(memFS, usedMedia);
    
    console.log('Media collection complete:', {
      slides: usedSlides.length,
      layouts: usedLayouts.size,
      masters: usedMasters.size,
      layoutsMedia: layoutsMedia.size,
      totalMedia: usedMedia.size
    });
  } catch (error) {
    console.error('Error collecting media files:', error);
  }
  return usedMedia;
}

// 添加处理主题媒体的函数
async function processThemeMedia(memFS, usedMedia) {
  try {
    const themeFiles = Object.keys(memFS).filter(path => path.includes('ppt/theme/'));
    for (const themePath of themeFiles) {
      if (!themePath.endsWith('.xml')) continue;
      
      const themeRelsPath = themePath.replace('theme/', 'theme/_rels/') + '.rels';
      if (!fileExistsInMemFS(memFS, themeRelsPath)) continue;
      
      const relsXml = readFileFromMemFS(memFS, themeRelsPath, 'string');
      if (!relsXml) continue;
      
      const relsObj = await parseXml(relsXml);
      if (!relsObj?.Relationships?.Relationship) continue;
      
      const relationships = Array.isArray(relsObj.Relationships.Relationship)
        ? relsObj.Relationships.Relationship
        : [relsObj.Relationships.Relationship];
      
      for (const rel of relationships) {
        const relType = rel['@_Type'] || rel.Type;
        const target = rel['@_Target'] || rel.Target;
        
        if (relType && target && (relType.includes('/image') || relType.includes('/media'))) {
          const mediaPath = `ppt/${target.replace('../', '')}`;
          usedMedia.add(mediaPath);
          console.log(`Theme ${themePath} references media: ${mediaPath}`);
        }
      }
    }
  } catch (error) {
    console.error('Error processing theme media:', error);
  }
}
async function processRelationshipFiles(memFS, usedLayouts, usedMasters, usedSlides, usedMedia) {
  const slideRelsFiles = usedSlides.map(slide => slide.path.replace('slides/', 'slides/_rels/') + '.rels');
  const layoutRelsFiles = Array.from(usedLayouts).map(layout => layout.replace('slideLayouts/', 'slideLayouts/_rels/') + '.rels');
  const masterRelsFiles = Array.from(usedMasters).map(master => master.replace('slideMasters/', 'slideMasters/_rels/') + '.rels');

  const relsFiles = Array.from(new Set([...slideRelsFiles, ...layoutRelsFiles, ...masterRelsFiles]))
    .filter(path => fileExistsInMemFS(memFS, path));

  console.log(`[processRelationshipFiles] Analyzing referenced rels files:`);
  relsFiles.forEach(f => console.log(`  - ${f}`));
  console.log(`[processRelationshipFiles] Total referenced rels files: ${relsFiles.length}`);

  await Promise.all(relsFiles.map(async (relsPath) => {
    try {
      const relsXml = readFileFromMemFS(memFS, relsPath, 'string');
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

async function getUsedSlides(memFS) {
  try {
    const relsPath = 'ppt/_rels/presentation.xml.rels';
    const relsXml = readFileFromMemFS(memFS, relsPath, 'string');
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

async function getUsedMedia(memFS, usedSlides) {
  const usedMedia = new Set();
  try {
    for (const slide of usedSlides) {
      const slideRelsPath = slide.path.replace('slides/', 'slides/_rels/') + '.rels';
      const slideRelsXml = readFileFromMemFS(memFS, slideRelsPath, 'string');
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

async function removeUnusedMedia(memFS, usedMedia) {
  try {
    const mediaFiles = findMediaFiles(memFS);
    console.log(`Total media files: ${mediaFiles.length}`);
    console.log(`Used media files: ${usedMedia.size}`);

    const missingMedia = [];
    for (const mediaPath of usedMedia) {
      if (!fileExistsInMemFS(memFS, mediaPath)) {
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
      return memFS;
    }

    for (const mediaPath of unusedMedia) {
      console.log(`Removing unused media: ${mediaPath}`);
      deleteFileFromMemFS(memFS, mediaPath);
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
  return memFS;
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

async function updateContentTypes(memFS) {
  try {
    console.log('Updating content types...');
    const contentTypesPath = '[Content_Types].xml';
    const contentTypesXml = readFileFromMemFS(memFS, contentTypesPath, 'string');
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
        const exists = fileExistsInMemFS(memFS, filePath);
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
      contentTypesObj.Types.Override = filteredOverrides.length > 0 ? filteredOverrides : undefined;
      try {
        const updatedContentTypesXml = buildXml(contentTypesObj);
        writeFileToMemFS(memFS, contentTypesPath, updatedContentTypesXml);
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
  return memFS;
}