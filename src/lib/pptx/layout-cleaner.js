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
      .filter(path => path.startsWith('ppt/slideLayouts/') && !path.includes('_rels'));
    
    const allMasterFiles = Object.keys(zip.files)
      .filter(path => path.startsWith('ppt/slideMasters/') && !path.includes('_rels'));
    
    console.log(`Total layouts: ${allLayoutFiles.length}, Total masters: ${allMasterFiles.length}`);
    
    onProgress('init', { percentage: 60, status: 'Removing unused layouts...' });
    
    // 5. 删除未使用的布局
    const unusedLayouts = allLayoutFiles.filter(path => !usedLayouts.has(path));
    console.log(`Found ${unusedLayouts.length} unused layouts to remove`);
    
    for (const layoutPath of unusedLayouts) {
      console.log(`Removing unused layout: ${layoutPath}`);
      zip.remove(layoutPath);
      
      // 删除相关的关系文件
      const layoutRelsPath = layoutPath.replace('slideLayouts/', 'slideLayouts/_rels/') + '.rels';
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
      console.log(`Removing unused master: ${masterPath}`);
      zip.remove(masterPath);
      
      // 删除相关的关系文件
      const masterRelsPath = masterPath.replace('slideMasters/', 'slideMasters/_rels/') + '.rels';
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
    const slidesList = presentationObj?.p_presentation?.p_sldIdLst?.p_sldId;
    
    if (!slidesList) return [];
    
    const slides = Array.isArray(slidesList) ? slidesList : [slidesList];
    
    return slides
      .filter(slide => slide && slide.$ && slide.$.r_id)
      .map(slide => ({
        id: slide.$.id,
        rId: slide.$.r_id
      }));
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
    // 获取presentation关系文件
    const relsPath = 'ppt/_rels/presentation.xml.rels';
    const relsXml = await zip.file(relsPath)?.async('string');
    if (!relsXml) return null;
    
    const relsObj = await parseXml(relsXml);
    const relationships = Array.isArray(relsObj.Relationships.Relationship)
      ? relsObj.Relationships.Relationship
      : [relsObj.Relationships.Relationship];
    
    // 找到幻灯片关系
    const slideRel = relationships.find(rel => rel.Id === slide.rId);
    if (!slideRel) return null;
    
    const slidePath = `ppt/${slideRel.Target.replace('../', '')}`;
    
    // 获取幻灯片XML
    const slideXml = await zip.file(slidePath)?.async('string');
    if (!slideXml) return null;
    
    // 获取幻灯片关系文件
    const slideRelsPath = slidePath.replace('slides/', 'slides/_rels/') + '.rels';
    const slideRelsXml = await zip.file(slideRelsPath)?.async('string');
    if (!slideRelsXml) return null;
    
    const slideRelsObj = await parseXml(slideRelsXml);
    const slideRels = Array.isArray(slideRelsObj.Relationships.Relationship)
      ? slideRelsObj.Relationships.Relationship
      : [slideRelsObj.Relationships.Relationship];
    
    // 找到布局关系
    const layoutRel = slideRels.find(rel => rel.Type.includes('/slideLayout'));
    if (!layoutRel) return null;
    
    return {
      path: `ppt/${layoutRel.Target.replace('../', '')}`,
      rId: layoutRel.Id
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
async function getLayoutMaster(zip, layoutPath) {
  try {
    // 获取布局关系文件
    const layoutRelsPath = layoutPath.replace('slideLayouts/', 'slideLayouts/_rels/') + '.rels';
    const layoutRelsXml = await zip.file(layoutRelsPath)?.async('string');
    if (!layoutRelsXml) return null;
    
    const layoutRelsObj = await parseXml(layoutRelsXml);
    const layoutRels = Array.isArray(layoutRelsObj.Relationships.Relationship)
      ? layoutRelsObj.Relationships.Relationship
      : [layoutRelsObj.Relationships.Relationship];
    
    // 找到母版关系
    const masterRel = layoutRels.find(rel => rel.Type.includes('/slideMaster'));
    if (!masterRel) return null;
    
    return {
      path: `ppt/${masterRel.Target.replace('../', '')}`,
      rId: masterRel.Id
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
async function updatePresentationReferences(zip, usedLayouts, usedMasters) {
  try {
    console.log('Updating presentation references...');
    // 更新presentation.xml.rels
    const relsPath = 'ppt/_rels/presentation.xml.rels';
    const relsXml = await zip.file(relsPath)?.async('string');
    if (!relsXml) {
      console.log('No presentation relationships file found');
      return;
    }
    
    const relsObj = await parseXml(relsXml);
    const relationships = Array.isArray(relsObj.Relationships.Relationship)
      ? relsObj.Relationships.Relationship
      : [relsObj.Relationships.Relationship];
    
    console.log(`Found ${relationships.length} relationships in presentation`);
    
    // 过滤出未使用的布局和母版关系
    const filteredRelationships = relationships.filter(rel => {
      // 保留非布局和非母版关系
      if (!rel.Type.includes('/slideLayout') && !rel.Type.includes('/slideMaster')) {
        return true;
      }
      
      // 检查布局是否使用
      if (rel.Type.includes('/slideLayout')) {
        const layoutPath = `ppt/${rel.Target.replace('../', '')}`;
        const isUsed = usedLayouts.has(layoutPath);
        if (!isUsed) console.log(`Removing unused layout reference: ${layoutPath}`);
        return isUsed;
      }
      
      // 检查母版是否使用
      if (rel.Type.includes('/slideMaster')) {
        const masterPath = `ppt/${rel.Target.replace('../', '')}`;
        const isUsed = usedMasters.has(masterPath);
        if (!isUsed) console.log(`Removing unused master reference: ${masterPath}`);
        return isUsed;
      }
      
      return false;
    });
    
    // 更新关系
    relsObj.Relationships.Relationship = filteredRelationships;
    
    // 更新关系文件
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
async function updateContentTypes(zip) {
  try {
    console.log('Updating content types...');
    const contentTypesXml = await zip.file('[Content_Types].xml')?.async('string');
    if (!contentTypesXml) {
      console.log('No content types file found');
      return;
    }
    
    const contentTypesObj = await parseXml(contentTypesXml);
    const overrides = Array.isArray(contentTypesObj.Types.Override)
      ? contentTypesObj.Types.Override
      : [contentTypesObj.Types.Override];
    
    console.log(`Found ${overrides.length} content type overrides`);
    
    // 过滤出存在的文件的覆盖
    const filteredOverrides = overrides.filter(override => {
      const path = override.PartName.replace(/^\//, '');
      const exists = zip.file(path) !== null;
      if (!exists) console.log(`Removing content type for deleted file: ${path}`);
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
    // 获取母版关系文件
    const masterRelsPath = masterPath.replace('slideMasters/', 'slideMasters/_rels/') + '.rels';
    const masterRelsXml = await zip.file(masterRelsPath)?.async('string');
    if (!masterRelsXml) return;
    
    const masterRelsObj = await parseXml(masterRelsXml);
    const relationships = Array.isArray(masterRelsObj.Relationships.Relationship)
      ? masterRelsObj.Relationships.Relationship
      : [masterRelsObj.Relationships.Relationship];
    
    // 过滤出未使用的布局关系
    const filteredRelationships = relationships.filter(rel => {
      // 保留非布局关系
      if (!rel.Type.includes('/slideLayout')) {
        return true;
      }
      
      // 检查布局是否使用
      const layoutPath = `ppt/${rel.Target.replace('../', '')}`;
      return usedLayouts.has(layoutPath);
    });
    
    // 如果有关系被移除
    if (filteredRelationships.length < relationships.length) {
      // 更新关系
      masterRelsObj.Relationships.Relationship = filteredRelationships;
      
      // 更新关系文件
      const updatedRelsXml = buildXml(masterRelsObj);
      zip.file(masterRelsPath, updatedRelsXml);
      
      console.log(`Updated master ${masterPath} references: removed ${relationships.length - filteredRelationships.length} unused layout references`);
      
      // 更新母版XML中的布局引用
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
    
    // 获取有效的布局ID
    const validLayoutIds = validRelationships
      .filter(rel => rel.Type.includes('/slideLayout'))
      .map(rel => rel.Id);
    
    // 更新sldLayoutIdLst
    if (masterObj?.p_sldMaster?.p_sldLayoutIdLst?.p_sldLayoutId) {
      const layoutIds = Array.isArray(masterObj.p_sldMaster.p_sldLayoutIdLst.p_sldLayoutId)
        ? masterObj.p_sldMaster.p_sldLayoutIdLst.p_sldLayoutId
        : [masterObj.p_sldMaster.p_sldLayoutIdLst.p_sldLayoutId];
      
      // 过滤出有效的布局ID
      const filteredLayoutIds = layoutIds.filter(layout => 
        layout && layout.$ && validLayoutIds.includes(layout.$.r_id)
      );
      
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