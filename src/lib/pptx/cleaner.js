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
 * @param {Object} options 清理选项
 * @returns {Promise<boolean>} Success status
 */
export async function cleanUnusedResources(zip, onProgress = () => {}, options = {}) {
  try {
    console.log('Starting resource cleanup process...');
    
    // 默认选项
    const cleanOptions = {
      removeUnusedLayouts: true, // 默认删除未使用布局
      cleanMediaInUnusedLayouts: false, // 默认不清理未使用布局中的媒体
      ...options
    };
    
    // Step 1: Get all used slides
    onProgress('init', { percentage: 10, status: 'Analyzing slides...' });
    const usedSlides = await getUsedSlides(zip);
    
    // Step 2: 获取所有使用的布局和母版
    onProgress('init', { percentage: 30, status: 'Analyzing slide layouts and masters...' });
    const { usedLayouts, usedMasters } = await getUsedLayoutsAndMasters(zip, usedSlides);
    
    // 如果需要删除未使用的布局
    if (cleanOptions.removeUnusedLayouts) {
      const layoutResult = await removeUnusedLayouts(zip, (status) => {
        onProgress('init', { percentage: status.percentage, status: status.status });
      });
    }
    
    // Step 3: 收集所有使用的媒体文件
    onProgress('init', { percentage: 70, status: 'Analyzing media files...' });
    
    let allLayoutsMedia = new Set();
    if (cleanOptions.cleanMediaInUnusedLayouts) {
      const allLayoutFiles = Object.keys(zip.files)
        .filter(path => path.startsWith('ppt/slideLayouts/') && 
                path.endsWith('.xml') && 
                !path.includes('_rels'));
      const unusedLayouts = allLayoutFiles.filter(path => !usedLayouts.has(path));
      console.log(`Found ${unusedLayouts.length} unused layouts for media analysis`);
      
      // 收集使用中的布局引用的媒体
      const usedLayoutsMedia = await getMediaFromLayouts(zip, Array.from(usedLayouts));
      usedLayoutsMedia.forEach(media => allLayoutsMedia.add(media));
      
      // 只在 removeUnusedLayouts=true 时才收集未使用布局引用的媒体
      if (cleanOptions.removeUnusedLayouts && cleanOptions.cleanMediaInUnusedLayouts) {
        console.log('Collecting media from unused layouts (since layouts will be removed)');
        const unusedLayoutsMedia = await getMediaFromLayouts(zip, unusedLayouts);
        unusedLayoutsMedia.forEach(media => allLayoutsMedia.add(media));
        console.log(`Found ${unusedLayoutsMedia.size} media files in unused layouts`);
      }
    }
    
    // 收集所有使用的媒体文件（包括幻灯片和使用中的布局）
    const usedMedia = await collectUsedMedia(zip, usedSlides, usedLayouts, usedMasters, allLayoutsMedia);
    
    // 新增：详细日志，便于排查
    console.log('==== 媒体清理前详细日志 ====');
    const allMediaFiles = findMediaFiles(zip);
    console.log('所有媒体文件:', allMediaFiles);
    console.log('已使用媒体文件:', Array.from(usedMedia));
    const unusedMediaFiles = allMediaFiles.filter(path => !usedMedia.has(path));
    console.log('未使用媒体文件:', unusedMediaFiles);
    console.log('==== 媒体清理前详细日志结束 ====');
    
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

/**
 * 从布局文件中获取引用的媒体文件
 * @param {JSZip} zip PPTX ZIP对象
 * @param {Array<string>} layoutPaths 布局文件路径数组
 * @returns {Promise<Set<string>>} 媒体文件路径集合
 */
async function getMediaFromLayouts(zip, layoutPaths) {
  const mediaSet = new Set();
  
  try {
    console.log(`Analyzing media references in ${layoutPaths.length} layouts`);
    
    for (const layoutPath of layoutPaths) {
      // 获取布局关系文件
      const layoutRelsPath = layoutPath.replace('ppt/slideLayouts/', 'ppt/slideLayouts/_rels/') + '.rels';
      const layoutRelsXml = await zip.file(layoutRelsPath)?.async('string');
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
      
      // 查找媒体引用
      let mediaCount = 0;
      for (const rel of relationships) {
        const relType = rel['@_Type'] || rel.Type;
        const target = rel['@_Target'] || rel.Target;
        
        if (!relType || !target) continue;
        
        if (relType.includes('/image') || 
            relType.includes('/audio') || 
            relType.includes('/video')) {
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

// 修改collectUsedMedia函数，添加对布局媒体的支持
async function collectUsedMedia(zip, usedSlides, usedLayouts, usedMasters, layoutsMedia = new Set()) {
  const usedMedia = new Set();
  
  try {
    if (zip.debug) console.time('collectUsedMedia');
    
    // 确保只处理非隐藏的幻灯片
    console.log(`Processing ${usedSlides.length} non-hidden slides for media references`);
    
    // 获取幻灯片中直接使用的媒体文件
    const slideMedia = await getUsedMedia(zip, usedSlides);
    slideMedia.forEach(mediaPath => usedMedia.add(mediaPath));
    
    // 添加使用中布局引用的媒体文件
    layoutsMedia.forEach(mediaPath => usedMedia.add(mediaPath));
    
    // 处理关系文件中的媒体引用
    await processRelationshipFiles(zip, usedLayouts, usedMasters, usedSlides, usedMedia);
    
    if (zip.debug) {
      console.timeEnd('collectUsedMedia');
      console.log('Media collection stats:', {
        slides: usedSlides.length,
        layouts: usedLayouts.size,
        masters: usedMasters.size,
        layoutsMedia: layoutsMedia.size,
        totalMedia: usedMedia.size
      });
    } else {
      console.log(`collectUsedMedia：${Date.now() - performance.now()} 毫秒 - 倒计时结束`);
      console.log('Media collection stats:', {
        slides: usedSlides.length,
        layouts: usedLayouts.size,
        masters: usedMasters.size,
        layoutsMedia: layoutsMedia.size,
        totalMedia: usedMedia.size
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
  // 只处理被引用的 slides、layouts、masters 的关系文件
  const slideRelsFiles = usedSlides.map(slide => slide.path.replace('slides/', 'slides/_rels/') + '.rels');
  const layoutRelsFiles = Array.from(usedLayouts).map(layout => layout.replace('slideLayouts/', 'slideLayouts/_rels/') + '.rels');
  const masterRelsFiles = Array.from(usedMasters).map(master => master.replace('slideMasters/', 'slideMasters/_rels/') + '.rels');

  // 合并并去重
  const relsFiles = Array.from(new Set([...slideRelsFiles, ...layoutRelsFiles, ...masterRelsFiles]))
    .filter(path => zip.file(path));

  console.log(`[processRelationshipFiles] Only analyzing referenced rels files:`);
  relsFiles.forEach(f => console.log(`  - ${f}`));
  console.log(`[processRelationshipFiles] Total referenced rels files: ${relsFiles.length}`);

  await Promise.all(relsFiles.map(async (relsPath) => {
    try {
      const relsXml = await zip.file(relsPath)?.async('string');
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
        if (relType && (
          relType.includes('/image') ||
          relType.includes('/audio') ||
          relType.includes('/video')
        )) {
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
    
    // 使用安全检查函数
    if (shouldSkipMediaRemoval(mediaFiles.length, unusedMedia.length)) {
      console.warn('Safety check: Skipping media removal due to safety constraints');
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

    // 新增：删除后再次输出剩余媒体文件
    const remainingMedia = Object.keys(zip.files).filter(path =>
      path.startsWith('ppt/media/') && !path.includes('_rels')
    );
    console.log('删除后剩余媒体文件:', remainingMedia);

  } catch (error) {
    console.error('Error removing unused media files:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
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
  }}