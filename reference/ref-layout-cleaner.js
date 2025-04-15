import { parseXmlWithNamespaces, buildXml, parseXml } from './xml/parser';

/**
 * Remove unused layouts and masters from the PPTX file
 * @param {JSZip} zip PPTX ZIP object
 * @param {Function} onProgress Progress callback function
 */
export async function removeUnusedLayouts(zip, onProgress = () => {}) {
  try {
    console.log('Starting layout cleanup process...');
    onProgress('init', { percentage: 50, status: 'Analyzing slide layouts...' });
    
    // 1. 获取所有幻灯片
    const slides = await getAllSlides(zip);
    if (slides.length === 0) {
      console.log('No slides found in the presentation');
      return false;
    }
    
    console.log(`Found ${slides.length} slides in the presentation`);
    
    // 2. 获取所有使用的布局
    const usedLayouts = new Set();
    for (const slide of slides) {
      const layoutInfo = await getSlideLayout(zip, slide);
      if (layoutInfo) {
        usedLayouts.add(layoutInfo.path);
        console.log(`Slide ${slide.id} uses layout: ${layoutInfo.path}`);
      }
    }
    
    console.log(`Found ${usedLayouts.size} used layouts`);
    
    // 3. 获取所有使用的母版
    const usedMasters = new Set();
    for (const layoutPath of usedLayouts) {
      const masterInfo = await getLayoutMaster(zip, layoutPath);
      if (masterInfo) {
        usedMasters.add(masterInfo.path);
        console.log(`Layout ${layoutPath} uses master: ${masterInfo.path}`);
      }
    }
    
    console.log(`Found ${usedMasters.size} used masters`);
    
    // 4. 获取所有布局和母版文件
    const allLayoutFiles = Object.keys(zip.files)
      .filter(path => path.startsWith('ppt/slideLayouts/') && path.endsWith('.xml') && !path.includes('_rels'));
    
    const allMasterFiles = Object.keys(zip.files)
      .filter(path => path.startsWith('ppt/slideMasters/') && path.endsWith('.xml') && !path.includes('_rels'));
    
    // 调试输出所有布局文件和已使用的布局文件
    console.log('All layout files:', allLayoutFiles);
    console.log('Used layout paths:', Array.from(usedLayouts));
    console.log('All master files:', allMasterFiles);
    console.log('Used master paths:', Array.from(usedMasters));
    
    console.log(`Total layouts: ${allLayoutFiles.length}, Total masters: ${allMasterFiles.length}`);
    
    onProgress('init', { percentage: 60, status: 'Removing unused layouts...' });
    
    // 我们只保留幻灯片直接使用的布局，不再将母版引用的布局添加到保留列表中
    // 这样可以删除更多未使用的布局，提高清理效率
    console.log('直接使用的布局:', Array.from(usedLayouts));
    
    // 删除未使用的布局（只保留幻灯片直接使用的布局）
    const unusedLayouts = allLayoutFiles.filter(path => !usedLayouts.has(path));
    console.log(`Found ${unusedLayouts.length} unused layouts to remove`);
    
    for (const layoutPath of unusedLayouts) {
      console.log(`Removing unused layout: ${layoutPath}`);
      zip.remove(layoutPath);
      
      // 删除相关的关系文件
      const layoutRelsPath = layoutPath.replace('ppt/slideLayouts/', 'ppt/slideLayouts/_rels/') + '.rels';
      if (zip.file(layoutRelsPath)) {
        console.log(`Removing layout relationship file: ${layoutRelsPath}`);
        zip.remove(layoutRelsPath);
      }
    }
    
    onProgress('init', { percentage: 70, status: 'Removing unused masters...' });
    
    // 6. 删除未使用的母版
    const unusedMasters = allMasterFiles.filter(path => !usedMasters.has(path));
    console.log(`Found ${unusedMasters.length} unused masters to remove`);
    
    for (const masterPath of unusedMasters) {
      if (!masterPath.includes('.xml')) continue; // 跳过非XML文件
      console.log(`Removing unused master: ${masterPath}`);
      zip.remove(masterPath);
      
      // 删除相关的关系文件
      const masterRelsPath = masterPath.replace('ppt/slideMasters/', 'ppt/slideMasters/_rels/') + '.rels';
      if (zip.file(masterRelsPath)) {
        console.log(`Removing master relationship file: ${masterRelsPath}`);
        zip.remove(masterRelsPath);
      }
    }
    
    // 7. 更新presentation.xml中的引用
    await updatePresentationReferences(zip, usedLayouts, usedMasters);
    
    // 8. 更新[Content_Types].xml
    await updateContentTypes(zip);
    
    // 9. 更新母版中的布局引用
    for (const masterPath of usedMasters) {
      await updateMasterLayoutReferences(zip, masterPath, usedLayouts);
    }
    
    // 在删除布局后添加验证逻辑
    console.log('删除后剩余布局文件:', Object.keys(zip.files).filter(p => p.startsWith('ppt/slideLayouts/')));
    // 验证内容类型
    const contentTypes = await zip.file('[Content_Types].xml')?.async('string');
    console.log('内容类型中的布局引用:', contentTypes?.match(/slideLayout/g) || []);
    
    console.log('Layout cleanup completed successfully');
    return true;
  } catch (error) {
    console.error('Error removing unused layouts:', error);
    return false;
  }
}

/**
 * Get all slides from the presentation
 * @param {JSZip} zip PPTX ZIP object
 */
async function getAllSlides(zip) {
  try {
    const presentationXml = await zip.file('ppt/presentation.xml')?.async('string');
    if (!presentationXml) return [];
    
    const presentationObj = await parseXmlWithNamespaces(presentationXml);
    console.log('DEBUG - Presentation XML structure:', JSON.stringify(presentationObj, null, 2));
    
    if (!presentationObj) {
      console.log('DEBUG - Presentation object is null or undefined');
      return [];
    }
    
    // Navigate through the structure to find slides
    let slidesList = null;
    
    // Based on the actual XML structure, we can directly access p:presentation
    if (presentationObj['p:presentation']?.['p:sldIdLst']?.['p:sldId']) {
      slidesList = presentationObj['p:presentation']['p:sldIdLst']['p:sldId'];
      console.log('DEBUG - Found slides using p:presentation.p:sldIdLst.p:sldId path');
    }
    
    if (!slidesList) {
      console.log('DEBUG - Could not find slides list in the presentation XML');
      return [];
    }
    
    const slides = Array.isArray(slidesList) ? slidesList : [slidesList];
    console.log('DEBUG - Slides array:', JSON.stringify(slides, null, 2));
    
    // Extract slide information based on the actual attribute structure
    return slides
      .filter(slide => {
        const hasAttributes = slide && (slide['@_id'] && slide['@_r:id']);
        if (!hasAttributes) {
          console.log('DEBUG - Slide missing attributes:', JSON.stringify(slide, null, 2));
        }
        return hasAttributes;
      })
      .map(slide => {
        const id = slide['@_id'];
        const rId = slide['@_r:id'];
        
        console.log(`DEBUG - Extracted slide: id=${id}, rId=${rId}`);
        
        return {
          id: id,
          rId: rId
        };
      });
  } catch (error) {
    console.error('Error getting all slides:', error);
    return [];
  }
}

/**
 * Get the layout used by a slide
 * @param {JSZip} zip PPTX ZIP object
 * @param {Object} slide Slide information
 */
async function getSlideLayout(zip, slide) {
  try {
    // Get presentation relationships file
    const relsPath = 'ppt/_rels/presentation.xml.rels';
    const relsXml = await zip.file(relsPath)?.async('string');
    if (!relsXml) return null;
    
    const relsObj = await parseXml(relsXml);
    console.log('DEBUG - Presentation relationships structure:', JSON.stringify(relsObj, null, 2));
    
    if (!relsObj.Relationships || !relsObj.Relationships.Relationship) {
      console.log('DEBUG - No relationships found in presentation.xml.rels');
      return null;
    }
    
    const relationships = Array.isArray(relsObj.Relationships.Relationship)
      ? relsObj.Relationships.Relationship
      : [relsObj.Relationships.Relationship];
    
    // Find slide relationship
    const slideRel = relationships.find(rel => {
      const relId = rel['@_Id'] || rel.Id;
      console.log(`DEBUG - Checking relationship: ${relId} against slide.rId: ${slide.rId}`);
      return relId === slide.rId;
    });
    
    if (!slideRel) {
      console.log(`DEBUG - Could not find relationship for slide rId: ${slide.rId}`);
      return null;
    }
    
    const target = slideRel['@_Target'] || slideRel.Target;
    if (!target) {
      console.log('DEBUG - No Target found in slide relationship');
      return null;
    }
    
    const slidePath = `ppt/${target.replace('../', '')}`;
    console.log(`DEBUG - Found slide path: ${slidePath}`);
    
    // Get slide XML
    const slideXml = await zip.file(slidePath)?.async('string');
    if (!slideXml) return null;
    
    // Get slide relationships file
    const slideRelsPath = slidePath.replace('slides/', 'slides/_rels/') + '.rels';
    const slideRelsXml = await zip.file(slideRelsPath)?.async('string');
    if (!slideRelsXml) return null;
    
    const slideRelsObj = await parseXml(slideRelsXml);
    console.log('DEBUG - Slide relationships structure:', JSON.stringify(slideRelsObj, null, 2));
    
    if (!slideRelsObj.Relationships || !slideRelsObj.Relationships.Relationship) {
      console.log('DEBUG - No relationships found in slide rels file');
      return null;
    }
    
    const slideRels = Array.isArray(slideRelsObj.Relationships.Relationship)
      ? slideRelsObj.Relationships.Relationship
      : [slideRelsObj.Relationships.Relationship];
    
    // Find layout relationship
    const layoutRel = slideRels.find(rel => {
      const relType = rel['@_Type'] || rel.Type;
      return relType && relType.includes('/slideLayout');
    });
    
    if (!layoutRel) {
      console.log('DEBUG - No layout relationship found in slide');
      return null;
    }
    
    const layoutTarget = layoutRel['@_Target'] || layoutRel.Target;
    const layoutId = layoutRel['@_Id'] || layoutRel.Id;
    
    if (!layoutTarget) {
      console.log('DEBUG - No Target found in layout relationship');
      return null;
    }
    
    return {
      path: `ppt/${layoutTarget.replace('../', '')}`,
      rId: layoutId
    };
  } catch (error) {
    console.error('Error getting slide layout:', error);
    return null;
  }
}

/**
 * Get the master used by a layout
 * @param {JSZip} zip PPTX ZIP object
 * @param {string} layoutPath Layout path
 */
export async function getLayoutMaster(zip, layoutPath) {
  try {
    // 获取布局关系文件
    const layoutRelsPath = layoutPath.replace('ppt/slideLayouts/', 'ppt/slideLayouts/_rels/') + '.rels';
    const layoutRelsXml = await zip.file(layoutRelsPath)?.async('string');
    if (!layoutRelsXml) return null;
    
    console.log(`Getting master for layout: ${layoutPath}, using rels file: ${layoutRelsPath}`);
    
    const layoutRelsObj = await parseXml(layoutRelsXml);
    console.log('DEBUG - Layout relationships structure:', JSON.stringify(layoutRelsObj, null, 2));
    
    if (!layoutRelsObj.Relationships || !layoutRelsObj.Relationships.Relationship) {
      console.log('DEBUG - No relationships found in layout rels file');
      return null;
    }
    
    const layoutRels = Array.isArray(layoutRelsObj.Relationships.Relationship)
      ? layoutRelsObj.Relationships.Relationship
      : [layoutRelsObj.Relationships.Relationship];
    
    // 找到母版关系，使用 @_Type 属性
    const masterRel = layoutRels.find(rel => {
      const relType = rel['@_Type'] || rel.Type;
      return relType && relType.includes('/slideMaster');
    });
    
    if (!masterRel) {
      console.log('DEBUG - No master relationship found in layout');
      return null;
    }
    
    // 使用 @_Target 和 @_Id 属性
    const target = masterRel['@_Target'] || masterRel.Target;
    const id = masterRel['@_Id'] || masterRel.Id;
    
    if (!target) {
      console.log('DEBUG - No Target found in master relationship');
      return null;
    }
    
    return {
      path: `ppt/${target.replace('../', '')}`,
      rId: id
    };
  } catch (error) {
    console.error('Error getting layout master:', error);
    return null;
  }
}

/**
 * Update presentation references to layouts and masters
 * @param {JSZip} zip PPTX ZIP object
 * @param {Set<string>} usedLayouts Set of used layout paths
 * @param {Set<string>} usedMasters Set of used master paths
 */
/**
 * Get layouts referenced by masters
 * @param {JSZip} zip PPTX ZIP object
 * @param {Set<string>} usedMasters Set of used master paths
 * @returns {Promise<Set<string>>} Set of layout paths referenced by masters
 * @deprecated This function is no longer used in the main flow as we only keep layouts directly used by slides
 */
async function getMasterReferencedLayouts(zip, usedMasters) {
  const referencedLayouts = new Set();
  
  try {
    // 遍历所有使用的母版
    for (const masterPath of usedMasters) {
      // 获取母版关系文件
      const masterRelsPath = masterPath.replace('ppt/slideMasters/', 'ppt/slideMasters/_rels/') + '.rels';
      const masterRelsXml = await zip.file(masterRelsPath)?.async('string');
      if (!masterRelsXml) continue;
      
      console.log(`Checking layouts referenced by master: ${masterPath}`);
      
      const masterRelsObj = await parseXml(masterRelsXml);
      const relationships = Array.isArray(masterRelsObj.Relationships.Relationship)
        ? masterRelsObj.Relationships.Relationship
        : [masterRelsObj.Relationships.Relationship];
      
      // 找到布局关系
      const layoutRels = relationships.filter(rel => rel.Type.includes('/slideLayout'));
      
      // 添加布局路径到引用集合
      for (const layoutRel of layoutRels) {
        const layoutPath = `ppt/${layoutRel.Target.replace('../', '')}`;
        referencedLayouts.add(layoutPath);
        console.log(`Master ${masterPath} references layout: ${layoutPath}`);
      }
      
      // 检查母版XML中的布局引用
      const masterXml = await zip.file(masterPath)?.async('string');
      if (masterXml) {
        const masterObj = await parseXmlWithNamespaces(masterXml);
        
        // 检查sldLayoutIdLst中的布局引用
        if (masterObj?.p_sldMaster?.p_sldLayoutIdLst?.p_sldLayoutId) {
          const layoutIds = Array.isArray(masterObj.p_sldMaster.p_sldLayoutIdLst.p_sldLayoutId)
            ? masterObj.p_sldMaster.p_sldLayoutIdLst.p_sldLayoutId
            : [masterObj.p_sldMaster.p_sldLayoutIdLst.p_sldLayoutId];
          
          console.log(`Master ${masterPath} has ${layoutIds.length} layout references in XML`);
        }
      }
    }
  } catch (error) {
    console.error('Error getting master referenced layouts:', error);
  }
  
  return referencedLayouts;
}

/**
 * Update presentation references to layouts and masters
 * @param {JSZip} zip PPTX ZIP object
 * @param {Set<string>} usedLayouts Set of used layout paths
 * @param {Set<string>} usedMasters Set of used master paths
 */
async function updatePresentationReferences(zip, usedLayouts, usedMasters) {
  try {
    console.log('Updating presentation references...');
    const relsPath = 'ppt/_rels/presentation.xml.rels';
    const relsXml = await zip.file(relsPath)?.async('string');
    if (!relsXml) {
      console.log('No presentation relationships file found');
      return;
    }
    
    const relsObj = await parseXml(relsXml);
    console.log('DEBUG - Presentation references structure:', JSON.stringify(relsObj, null, 2));
    
    if (!relsObj.Relationships || !relsObj.Relationships.Relationship) {
      console.log('DEBUG - No relationships found in presentation.xml.rels');
      return;
    }
    
    const relationships = Array.isArray(relsObj.Relationships.Relationship)
      ? relsObj.Relationships.Relationship
      : [relsObj.Relationships.Relationship];
    
    console.log(`Found ${relationships.length} relationships in presentation`);
    
    // Filter out unused layout and master relationships
    const filteredRelationships = relationships.filter(rel => {
      const relType = rel['@_Type'];
      const target = rel['@_Target'];
      
      // Keep non-layout and non-master relationships
      if (!relType || (!relType.includes('/slideLayout') && !relType.includes('/slideMaster'))) {
        return true;
      }
      
      // Check if layout is used
      if (relType.includes('/slideLayout')) {
        const layoutPath = `ppt/${target.replace('../', '')}`;
        const isUsed = usedLayouts.has(layoutPath);
        if (!isUsed) console.log(`Removing unused layout reference: ${layoutPath}`);
        return isUsed;
      }
      
      // Check if master is used
      if (relType.includes('/slideMaster')) {
        const masterPath = `ppt/${target.replace('../', '')}`;
        const isUsed = usedMasters.has(masterPath);
        if (!isUsed) console.log(`Removing unused master reference: ${masterPath}`);
        return isUsed;
      }
      
      return false;
    });
    
    // Update relationships
    relsObj.Relationships.Relationship = filteredRelationships;
    
    // Update relationship file
    const updatedRelsXml = buildXml(relsObj);
    zip.file(relsPath, updatedRelsXml);
    
    console.log(`Updated presentation references: removed ${relationships.length - filteredRelationships.length} unused references`);
  } catch (error) {
    console.error('Error updating presentation references:', error);
  }
}

/**
 * Update [Content_Types].xml to remove references to deleted files
 * @param {JSZip} zip PPTX ZIP object
 */
export async function updateContentTypes(zip) {
  try {
    console.log('Updating content types...');
    const contentTypesXml = await zip.file('[Content_Types].xml')?.async('string');
    if (!contentTypesXml) {
      console.log('No content types file found');
      return;
    }
    
    const contentTypesObj = await parseXml(contentTypesXml);
    console.log('DEBUG - Content types structure:', JSON.stringify(contentTypesObj, null, 2));
    
    if (!contentTypesObj.Types || !contentTypesObj.Types.Override) {
      console.log('DEBUG - No overrides found in content types');
      return;
    }
    
    const overrides = Array.isArray(contentTypesObj.Types.Override)
      ? contentTypesObj.Types.Override
      : [contentTypesObj.Types.Override];
    
    console.log(`Found ${overrides.length} content type overrides`);
    
    // 过滤出存在的文件的覆盖
    const filteredOverrides = overrides.filter(override => {
      const partName = override['@_PartName'] || override.PartName;
      if (!partName) {
        console.log('DEBUG - Override missing PartName:', JSON.stringify(override, null, 2));
        return false;
      }
      
      const filePath = partName.replace(/^\//, '');
      const exists = zip.file(filePath) !== null;
      if (!exists) console.log(`Removing content type for deleted file: ${filePath}`);
      return exists;
    });
    
    // 如果有覆盖被移除
    if (filteredOverrides.length < overrides.length) {
      // 更新覆盖
      contentTypesObj.Types.Override = filteredOverrides;
      
      // 更新内容类型文件
      const updatedContentTypesXml = buildXml(contentTypesObj);
      zip.file('[Content_Types].xml', updatedContentTypesXml);
      
      console.log(`Updated [Content_Types].xml: removed ${overrides.length - filteredOverrides.length} references to deleted files`);
    } else {
      console.log('No content type references needed to be removed');
    }
  } catch (error) {
    console.error('Error updating content types:', error);
  }
}

/**
 * Update master layout references
 * @param {JSZip} zip PPTX ZIP object
 * @param {string} masterPath Master path
 * @param {Set<string>} usedLayouts Set of used layout paths
 */
async function updateMasterLayoutReferences(zip, masterPath, usedLayouts) {
  try {
    // Get master relationship file
    const masterRelsPath = masterPath.replace('ppt/slideMasters/', 'ppt/slideMasters/_rels/') + '.rels';
    const masterRelsXml = await zip.file(masterRelsPath)?.async('string');
    if (!masterRelsXml) return;
    
    console.log(`Updating master layout references for: ${masterPath}, using rels file: ${masterRelsPath}`);
    
    const masterRelsObj = await parseXml(masterRelsXml);
    console.log('DEBUG - Master relationships structure:', JSON.stringify(masterRelsObj, null, 2));
    
    const relationships = Array.isArray(masterRelsObj.Relationships.Relationship)
      ? masterRelsObj.Relationships.Relationship
      : [masterRelsObj.Relationships.Relationship];
    
    // Filter out unused layout relationships
    const filteredRelationships = relationships.filter(rel => {
      // Keep non-layout relationships
      const relType = rel['@_Type'];
      if (!relType || !relType.includes('/slideLayout')) {
        return true;
      }
      
      // Check if layout is used
      const target = rel['@_Target'];
      const layoutPath = `ppt/${target.replace('../', '')}`;
      const isUsed = usedLayouts.has(layoutPath);
      if (!isUsed) {
        console.log(`Removing unused layout reference from master: ${layoutPath}`);
      }
      return isUsed;
    });
    
    // If relationships were removed
    if (filteredRelationships.length < relationships.length) {
      // Update relationships
      masterRelsObj.Relationships.Relationship = filteredRelationships;
      
      // Update relationship file
      const updatedRelsXml = buildXml(masterRelsObj);
      zip.file(masterRelsPath, updatedRelsXml);
      
      console.log(`Updated master ${masterPath} references: removed ${relationships.length - filteredRelationships.length} unused layout references`);
      
      // Update master XML layout references
      await updateMasterXml(zip, masterPath, filteredRelationships);
    }
  } catch (error) {
    console.error(`Error updating master layout references for ${masterPath}:`, error);
  }
}

/**
 * Update master XML to remove references to unused layouts
 * @param {JSZip} zip PPTX ZIP object
 * @param {string} masterPath Master path
 * @param {Array} validRelationships Valid relationships
 */
async function updateMasterXml(zip, masterPath, validRelationships) {
  try {
    const masterXml = await zip.file(masterPath)?.async('string');
    if (!masterXml) return;
    
    const masterObj = await parseXmlWithNamespaces(masterXml);
    console.log('DEBUG - Master XML structure:', JSON.stringify(masterObj, null, 2));
    
    // 获取有效的布局ID
    const validLayoutIds = validRelationships
      .filter(rel => rel['@_Type'] && rel['@_Type'].includes('/slideLayout'))
      .map(rel => rel['@_Id']);
    
    // 更新sldLayoutIdLst
    if (masterObj?.p_sldMaster?.p_sldLayoutIdLst?.p_sldLayoutId) {
      const layoutIds = Array.isArray(masterObj.p_sldMaster.p_sldLayoutIdLst.p_sldLayoutId)
        ? masterObj.p_sldMaster.p_sldLayoutIdLst.p_sldLayoutId
        : [masterObj.p_sldMaster.p_sldLayoutIdLst.p_sldLayoutId];
      
      // 过滤出有效的布局ID
      const filteredLayoutIds = layoutIds.filter(layout => {
        const rId = layout['@_r:id'] || (layout['@_'] && layout['@_']['r:id']);
        return rId && validLayoutIds.includes(rId);
      });
      
      // 更新布局ID列表
      if (filteredLayoutIds.length < layoutIds.length) {
        masterObj.p_sldMaster.p_sldLayoutIdLst.p_sldLayoutId = filteredLayoutIds.length > 0
          ? filteredLayoutIds
          : undefined;
        
        // 更新母版XML
        const updatedMasterXml = buildXml(masterObj);
        zip.file(masterPath, updatedMasterXml);
        
        console.log(`Updated master XML ${masterPath}: removed ${layoutIds.length - filteredLayoutIds.length} unused layout references`);
      }
    }
  } catch (error) {
    console.error(`Error updating master XML for ${masterPath}:`, error);
  }
}