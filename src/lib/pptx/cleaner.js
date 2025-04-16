import { parseXmlWithNamespaces, buildXml, parseXml } from './xml/parser';
import { PRESENTATION_PATH, MEDIA_PATH_PREFIX } from './constants';
import { 
  removeUnusedLayouts, 
  updatePresentationReferences, 
  getLayoutMaster,
  getUsedLayoutsAndMasters
} from './layout-cleaner';
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
    
    // Step 1: Get all used slides
    onProgress('init', { percentage: 10, status: 'Analyzing slides...' });
    const usedSlides = await getUsedSlides(zip);
    
    // Step 2: Clean unused layouts and masters
    onProgress('init', { percentage: 30, status: 'Analyzing slide layouts and masters...' });
    const { usedLayouts, usedMasters } = await getUsedLayoutsAndMasters(zip, usedSlides);
    const layoutResult = await removeUnusedLayouts(zip, (status) => {
      onProgress('init', { percentage: status.percentage, status: status.status });
    });
    
    // Step 3: Clean unused media files
    onProgress('init', { percentage: 70, status: 'Analyzing media files...' });
    const usedMedia = await collectUsedMedia(zip, usedSlides, usedLayouts, usedMasters);
    await removeUnusedMedia(zip, usedMedia);
    onProgress('init', { percentage: 90, status: 'Cleaning unused media references...' });
    
    // 更新演示文稿引用
    await updatePresentationReferences(zip, usedLayouts, usedMasters);
    
    // 最终更新内容类型
    await updateContentTypes(zip);
    
    console.log('Resource cleanup completed successfully');
    return true;
  } catch (error) {
    console.error('Error cleaning unused resources:', error);
    return false;
  }
}

async function collectUsedMedia(zip, usedSlides, usedLayouts, usedMasters) {
  const usedMedia = new Set();
  
  try {
    if (zip.debug) console.time('collectUsedMedia');
    
    // 获取幻灯片中直接使用的媒体文件
    const slideMedia = await getUsedMedia(zip, usedSlides);
    slideMedia.forEach(mediaPath => usedMedia.add(mediaPath));
    
    // 处理关系文件中的媒体引用
    await processRelationshipFiles(zip, usedLayouts, usedMasters, usedSlides, usedMedia);
    
    if (zip.debug) {
      console.timeEnd('collectUsedMedia');
      console.log('Media collection stats:', {
        slides: usedSlides.length,
        layouts: usedLayouts.size,
        masters: usedMasters.size,
        media: usedMedia.size
      });
    }
  } catch (error) {
    console.error('Error collecting media files:', {
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
  const relsFiles = Object.keys(zip.files)
    .filter(path => path.includes('_rels/') && path.endsWith('.rels'));

  console.log(`Found ${relsFiles.length} relationship files to analyze`);

  await Promise.all(relsFiles.map(async (relsPath) => {
    try {
      // === 修改点：不再跳过未被引用的 master/layout 关系文件，始终收集媒体引用 ===
      const relsXml = await zip.file(relsPath)?.async('string');
      if (!relsXml) return;

      const relsObj = await parseXml(relsXml);

      if (!relsObj.Relationships || !relsObj.Relationships.Relationship) return;

      const relationships = Array.isArray(relsObj.Relationships.Relationship)
        ? relsObj.Relationships.Relationship
        : [relsObj.Relationships.Relationship];

      relationships.forEach(rel => {
        const relType = rel['@_Type'] || rel.Type;
        if (relType && (
          relType.includes('/image') ||
          relType.includes('/audio') ||
          relType.includes('/video')
        )) {
          const target = rel['@_Target'] || rel.Target;
          if (target) {
            const mediaPath = `ppt/${target.replace('../', '')}`;
            usedMedia.add(mediaPath);
          }
        }
      });
    } catch (error) {
      console.error(`Error processing relationship file ${relsPath}:`, error);
    }
  }));
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

/**
 * Get all media files used in slides
 * @param {JSZip} zip PPTX ZIP object
 * @param {Array} usedSlides Array of slide objects
 * @returns {Promise<Set<string>>} Set of used media file paths
 */
async function getUsedMedia(zip, usedSlides) {
  const usedMedia = new Set();
  
  try {
    for (const slide of usedSlides) {
      const slideRelsPath = slide.path.replace('slides/', 'slides/_rels/') + '.rels';
      const slideRelsXml = await zip.file(slideRelsPath)?.async('string');
      if (!slideRelsXml) continue;
      
      const slideRelsObj = await parseXml(slideRelsXml);
      
      if (!slideRelsObj.Relationships || !slideRelsObj.Relationships.Relationship) continue;
      
      const slideRels = Array.isArray(slideRelsObj.Relationships.Relationship)
        ? slideRelsObj.Relationships.Relationship
        : [slideRelsObj.Relationships.Relationship];
      
      const mediaRels = slideRels.filter(rel => {
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
 * 移除未使用的媒体文件
 * @param {JSZip} zip PPTX ZIP对象
 * @param {Set<string>} usedMedia 已使用的媒体文件路径集合
 */
async function removeUnusedMedia(zip, usedMedia) {
  try {
    const mediaFiles = findMediaFiles(zip);
    
    console.log(`Total media files: ${mediaFiles.length}`);
    console.log(`Used media files: ${usedMedia.size}`);
    
    // 验证已使用的媒体文件是否存在
    const missingMedia = [];
    for (const mediaPath of usedMedia) {
      if (!zip.file(mediaPath)) {
        console.warn(`Warning: Referenced media file does not exist: ${mediaPath}`);
        missingMedia.push(mediaPath);
      }
    }
    
    // 从已使用的媒体集合中移除不存在的文件
    missingMedia.forEach(path => {
      console.log(`Removing non-existent media reference: ${path}`);
      usedMedia.delete(path);
    });
    
    // 找出未使用的媒体文件
    const unusedMedia = mediaFiles.filter(path => !usedMedia.has(path));
    console.log(`Found ${unusedMedia.length} unused media files to remove`);
    
    // 安全检查，避免删除所有媒体文件
    if (unusedMedia.length > 0 && unusedMedia.length === mediaFiles.length) {
      console.warn('Safety check: Skipping removal - attempting to remove all media files');
      return;
    }
    
    // 删除未使用的媒体文件
    for (const mediaPath of unusedMedia) {
      console.log(`Removing unused media: ${mediaPath}`);
      try {
        zip.remove(mediaPath);
      } catch (removeError) {
        console.error(`Error removing media file ${mediaPath}:`, removeError);
      }
    }
    
    // 记录剩余的媒体文件
    const remainingMedia = Object.keys(zip.files).filter(path => 
      path.startsWith('ppt/media/') && !path.includes('_rels')
    );
    console.log(`Remaining media files after cleanup: ${remainingMedia.length}`);
    
  } catch (error) {
    console.error('Error removing unused media files:', error);
    console.error('Error details:', {
      name: error.name,
      message: error.message,
      stack: error.stack
    });
    // 不抛出异常，让流程继续
  }
}

/**
 * Determine if media removal should be skipped based on safety checks
 * @param {number} totalCount Total number of media files
 * @param {number} unusedCount Number of unused media files
 * @returns {boolean} True if removal should be skipped
 */
function shouldSkipMediaRemoval(totalCount, unusedCount) {
  if (totalCount === 0) {
    console.warn('No media files found in the presentation.');
    return true;
  }
  
  if (unusedCount > 0 && unusedCount === totalCount) {
    console.warn('Warning: Attempting to remove all media files. Skipping removal.');
    return true;
  }
  
  const removalPercentage = (unusedCount / totalCount) * 100;
  if (removalPercentage > 80) {
    console.warn(`Warning: Attempting to remove ${removalPercentage.toFixed(1)}% of media files. Skipping removal.`);
    return true;
  }
  
  return false;
}

/**
 * 更新内容类型文件，移除对不存在文件的引用
 * @param {JSZip} zip PPTX ZIP对象
 */
async function updateContentTypes(zip) {
  try {
    console.log('Updating content types...');
    const contentTypesXml = await zip.file('[Content_Types].xml')?.async('string');
    if (!contentTypesXml) {
      console.warn('Content types file not found');
      return;
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
      console.error('XML content:', contentTypesXml.substring(0, 200) + '...');
      return; // 解析失败时提前返回，避免使用未定义的变量
    }
    
    // 确保Types节点存在
    if (!contentTypesObj.Types) {
      console.error('Invalid content types structure: missing Types node');
      console.error('Content types object:', JSON.stringify(contentTypesObj, null, 2).substring(0, 500) + '...');
      return;
    }
    
    // 处理Override节点
    if (!contentTypesObj.Types.Override) {
      console.warn('No Override nodes found in content types');
      return;
    }
    
    const overrides = Array.isArray(contentTypesObj.Types.Override)
      ? contentTypesObj.Types.Override
      : [contentTypesObj.Types.Override];
    
    console.log(`Found ${overrides.length} content type overrides`);
    
    // 过滤出存在的文件的覆盖
    const filteredOverrides = overrides.filter(override => {
      try {
        if (!override) {
          console.warn('Invalid override: undefined or null');
          return false;
        }
        
        // 尝试多种方式获取PartName属性
        const partName = override['@_PartName'] || 
                         override.PartName || 
                         (override.$ && override.$['PartName']);
        
        if (!partName) {
          console.warn('Override missing PartName attribute:', JSON.stringify(override).substring(0, 100));
          return false;
        }
        
        const filePath = partName.replace(/^\//, '');
        const exists = zip.file(filePath) !== null;
        
        if (!exists) {
          console.log(`Removing content type for deleted file: ${filePath}`);
        }
        
        return exists;
      } catch (err) {
        console.error('Error processing override:', err);
        return false;
      }
    });
    
    // 如果有覆盖被移除
    if (filteredOverrides.length < overrides.length) {
      // 更新覆盖
      contentTypesObj.Types.Override = filteredOverrides;
      
      // 更新内容类型文件
      try {
        const updatedContentTypesXml = buildXml(contentTypesObj);
        zip.file('[Content_Types].xml', updatedContentTypesXml);
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
    // 不抛出异常，让流程继续
  }
}