import { parseXmlWithNamespaces, buildXml, parseXml } from './xml/parser';

/**
 * 删除未使用的布局和母版
 * @param {JSZip} zip PPTX的ZIP对象
 * @param {Function} onProgress 进度回调函数
 */
export async function removeUnusedLayouts(zip, onProgress = () => {}) {
  try {
    // 1. Get all slides
    const slides = await getAllSlides(zip);
    if (slides.length === 0) return;
    
    // 2. Get all used layouts
    const usedLayouts = new Set();
    for (const slide of slides) {
      const layoutInfo = await getSlideLayout(zip, slide);
      if (layoutInfo) {
        usedLayouts.add(layoutInfo.path);
      }
    }
    
    // 3. Get all used masters
    const usedMasters = new Set();
    for (const layoutPath of usedLayouts) {
      const masterInfo = await getLayoutMaster(zip, layoutPath);
      if (masterInfo) {
        usedMasters.add(masterInfo.path);
      }
    }
    
    // 4. Remove unused layouts
    await removeUnusedLayoutFiles(zip, usedLayouts);
    
    // 5. Remove unused masters
    await removeUnusedMasterFiles(zip, usedMasters);
    
    // 6. Update [Content_Types].xml
    await updateContentTypes(zip);
    
    return true;
  } catch (error) {
    console.error('Error removing unused layouts:', error);
    return false;
  }
}

/**
 * 获取所有幻灯片
 * @param {JSZip} zip PPTX的ZIP对象
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
    console.error('获取所有幻灯片时出错:', error);
    return [];
  }
}

/**
 * 获取幻灯片使用的布局
 * @param {JSZip} zip PPTX的ZIP对象
 * @param {Object} slide 幻灯片信息
 */
async function getSlideLayout(zip, slide) {
  try {
    // 获取幻灯片关系文件
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
    
    const slideObj = await parseXmlWithNamespaces(slideXml);
    
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
      path: `ppt/${layoutRel.Target.replace('../', '')}`
    };
  } catch (error) {
    console.error('获取幻灯片布局时出错:', error);
    return null;
  }
}

/**
 * 获取布局使用的母版
 * @param {JSZip} zip PPTX的ZIP对象
 * @param {string} layoutPath 布局路径
 */
async function getLayoutMaster(zip, layoutPath) {
  try {
    // 获取布局XML
    const layoutXml = await zip.file(layoutPath)?.async('string');
    if (!layoutXml) return null;
    
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
      path: `ppt/${masterRel.Target.replace('../', '')}`
    };
  } catch (error) {
    console.error('获取布局母版时出错:', error);
    return null;
  }
}

/**
 * 删除未使用的布局文件
 * @param {JSZip} zip PPTX的ZIP对象
 * @param {Set<string>} usedLayouts 使用的布局集合
 */
async function removeUnusedLayoutFiles(zip, usedLayouts) {
  try {
    // Get all layout files
    const layoutFiles = Object.keys(zip.files)
      .filter(path => path.startsWith('ppt/slideLayouts/') && !path.includes('_rels'));
    
    // Remove unused layouts
    for (const layoutPath of layoutFiles) {
      if (!usedLayouts.has(layoutPath)) {
        zip.remove(layoutPath);
        
        // Remove related relationship files
        const layoutRelsPath = layoutPath.replace('slideLayouts/', 'slideLayouts/_rels/') + '.rels';
        if (zip.file(layoutRelsPath)) {
          zip.remove(layoutRelsPath);
        }
      }
    }
  } catch (error) {
    console.error('Error removing unused layout files:', error);
  }
}

/**
 * 删除未使用的母版文件
 * @param {JSZip} zip PPTX的ZIP对象
 * @param {Set<string>} usedMasters 使用的母版集合
 */
async function removeUnusedMasterFiles(zip, usedMasters) {
  try {
    // 获取所有母版文件
    const masterFiles = Object.keys(zip.files)
      .filter(path => path.startsWith('ppt/slideMasters/') && !path.includes('_rels'));
    
    // 删除未使用的母版
    for (const masterPath of masterFiles) {
      if (!usedMasters.has(masterPath)) {
        zip.remove(masterPath);
        
        // 删除相关的关系文件
        const masterRelsPath = masterPath.replace('slideMasters/', 'slideMasters/_rels/') + '.rels';
        if (zip.file(masterRelsPath)) {
          zip.remove(masterRelsPath);
        }
      }
    }
    
    // 更新presentation.xml.rels中的母版引用
    await updatePresentationMasterRefs(zip, usedMasters);
  } catch (error) {
    console.error('删除未使用母版文件时出错:', error);
  }
}

/**
 * 更新演示文稿中的母版引用
 * @param {JSZip} zip PPTX的ZIP对象
 * @param {Set<string>} usedMasters 使用的母版集合
 */
async function updatePresentationMasterRefs(zip, usedMasters) {
  try {
    const relsPath = 'ppt/_rels/presentation.xml.rels';
    const relsXml = await zip.file(relsPath)?.async('string');
    if (!relsXml) return;
    
    const relsObj = await parseXml(relsXml);
    const relationships = Array.isArray(relsObj.Relationships.Relationship)
      ? relsObj.Relationships.Relationship
      : [relsObj.Relationships.Relationship];
    
    // 过滤出非母版关系和使用的母版关系
    relsObj.Relationships.Relationship = relationships.filter(rel => {
      if (!rel.Type.includes('/slideMaster')) return true;
      
      const masterPath = `ppt/${rel.Target.replace('../', '')}`;
      return usedMasters.has(masterPath);
    });
    
    // 更新关系文件
    const updatedRelsXml = buildXml(relsObj);
    zip.file(relsPath, updatedRelsXml);
  } catch (error) {
    console.error('更新演示文稿母版引用时出错:', error);
  }
}

/**
 * 更新内容类型
 * @param {JSZip} zip PPTX的ZIP对象
 */
async function updateContentTypes(zip) {
  try {
    const contentTypesXml = await zip.file('[Content_Types].xml')?.async('string');
    if (!contentTypesXml) return;
    
    const contentTypesObj = await parseXml(contentTypesXml);
    const overrides = Array.isArray(contentTypesObj.Types.Override)
      ? contentTypesObj.Types.Override
      : [contentTypesObj.Types.Override];
    
    // 过滤出实际存在的文件的Override
    contentTypesObj.Types.Override = overrides.filter(override => {
      const path = override.PartName.replace(/^\//, '');
      return zip.file(path) !== null;
    });
    
    // 更新内容类型文件
    const updatedContentTypesXml = buildXml(contentTypesObj);
    zip.file('[Content_Types].xml', updatedContentTypesXml);
  } catch (error) {
    console.error('更新内容类型时出错:', error);
  }
}