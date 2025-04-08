import { parseXmlWithNamespaces, buildXml, parseXml } from './xml/parser';
import { PRESENTATION_PATH } from './constants';

/**
 * 清理未使用的资源（布局、母版和媒体文件）
 * @param {JSZip} zip PPTX的ZIP对象
 * @param {Function} onProgress 进度回调函数
 */
/**
 * 清理未使用的资源
 * @param {JSZip} zip PPTX的ZIP对象
 * @param {Function} onProgress 进度回调函数
 */
export async function cleanUnusedResources(zip, onProgress = () => {}) {
  try {
    // 获取所有使用的媒体文件
    const usedMedia = await collectUsedMedia(zip);
    
    // 删除未使用的媒体文件
    await removeUnusedMedia(zip, usedMedia);
    
    return true;
  } catch (error) {
    console.error('清理未使用资源时出错:', error);
    return false;
  }
}

/**
 * 收集所有使用的媒体文件
 * @param {JSZip} zip PPTX的ZIP对象
 * @returns {Promise<Set<string>>} 使用的媒体文件路径集合
 */
async function collectUsedMedia(zip) {
  const usedMedia = new Set();
  
  try {
    // 获取所有关系文件
    const relsFiles = Object.keys(zip.files)
      .filter(path => path.includes('_rels/') && path.endsWith('.rels'));
    
    // 解析每个关系文件，查找媒体引用
    for (const relsPath of relsFiles) {
      const relsXml = await zip.file(relsPath)?.async('string');
      if (!relsXml) continue;
      
      // 解析XML
      const matches = relsXml.match(/Target="([^"]*media\/[^"]*)"/g);
      if (!matches) continue;
      
      // 添加到使用的媒体集合
      for (const match of matches) {
        const mediaPath = match.replace(/Target="\.\.\//, '').replace(/"$/, '');
        usedMedia.add(`ppt/${mediaPath}`);
      }
    }
  } catch (error) {
    console.error('收集使用的媒体文件时出错:', error);
  }
  
  return usedMedia;
}

/**
 * 获取演示文稿中使用的所有幻灯片
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
    console.error('获取使用的幻灯片时出错:', error);
    return [];
  }
}

/**
 * 获取幻灯片中使用的所有布局和母版
 */
async function getUsedLayoutsAndMasters(zip, usedSlides) {
  const usedLayouts = new Set();
  const usedMasters = new Set();
  
  try {
    // 处理每个幻灯片
    for (const slide of usedSlides) {
      const slideXml = await zip.file(slide.path)?.async('string');
      if (!slideXml) continue;
      
      const slideObj = await parseXmlWithNamespaces(slideXml);
      
      // 获取幻灯片使用的布局ID
      const layoutRId = slideObj?.p_sld?.p_cSld?.$?.layoutId;
      if (!layoutRId) continue;
      
      // 获取幻灯片关系文件
      const slideRelsPath = slide.path.replace('slides/', 'slides/_rels/') + '.rels';
      const slideRelsXml = await zip.file(slideRelsPath)?.async('string');
      if (!slideRelsXml) continue;
      
      const slideRelsObj = await parseXml(slideRelsXml);
      const slideRels = Array.isArray(slideRelsObj.Relationships.Relationship)
        ? slideRelsObj.Relationships.Relationship
        : [slideRelsObj.Relationships.Relationship];
      
      // 找到布局关系
      const layoutRel = slideRels.find(rel => rel.Type.includes('/slideLayout'));
      if (!layoutRel) continue;
      
      const layoutPath = `ppt/${layoutRel.Target.replace('../', '')}`;
      usedLayouts.add(layoutPath);
      
      // 获取布局使用的母版
      const layoutXml = await zip.file(layoutPath)?.async('string');
      if (!layoutXml) continue;
      
      const layoutObj = await parseXmlWithNamespaces(layoutXml);
      
      // 获取布局关系文件
      const layoutRelsPath = layoutPath.replace('slideLayouts/', 'slideLayouts/_rels/') + '.rels';
      const layoutRelsXml = await zip.file(layoutRelsPath)?.async('string');
      if (!layoutRelsXml) continue;
      
      const layoutRelsObj = await parseXml(layoutRelsXml);
      const layoutRels = Array.isArray(layoutRelsObj.Relationships.Relationship)
        ? layoutRelsObj.Relationships.Relationship
        : [layoutRelsObj.Relationships.Relationship];
      
      // 找到母版关系
      const masterRel = layoutRels.find(rel => rel.Type.includes('/slideMaster'));
      if (!masterRel) continue;
      
      const masterPath = `ppt/${masterRel.Target.replace('../', '')}`;
      usedMasters.add(masterPath);
    }
    
    return { usedLayouts, usedMasters };
  } catch (error) {
    console.error('获取使用的布局和母版时出错:', error);
    return { usedLayouts: new Set(), usedMasters: new Set() };
  }
}

/**
 * 获取幻灯片中使用的所有媒体文件
 */
async function getUsedMedia(zip, usedSlides) {
  const usedMedia = new Set();
  
  try {
    // 处理每个幻灯片及其关系
    for (const slide of usedSlides) {
      const slideRelsPath = slide.path.replace('slides/', 'slides/_rels/') + '.rels';
      const slideRelsXml = await zip.file(slideRelsPath)?.async('string');
      if (!slideRelsXml) continue;
      
      const slideRelsObj = await parseXml(slideRelsXml);
      const slideRels = Array.isArray(slideRelsObj.Relationships.Relationship)
        ? slideRelsObj.Relationships.Relationship
        : [slideRelsObj.Relationships.Relationship];
      
      // 找到媒体关系
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
    console.error('获取使用的媒体文件时出错:', error);
    return new Set();
  }
}

/**
 * 删除未使用的布局
 */
async function removeUnusedLayouts(zip, usedLayouts) {
  try {
    // 获取所有布局文件
    const layoutFiles = Object.keys(zip.files)
      .filter(path => path.startsWith('ppt/slideLayouts/') && !path.includes('_rels'));
    
    // 删除未使用的布局
    for (const layoutPath of layoutFiles) {
      if (!usedLayouts.has(layoutPath)) {
        zip.remove(layoutPath);
        
        // 删除相关的关系文件
        const layoutRelsPath = layoutPath.replace('slideLayouts/', 'slideLayouts/_rels/') + '.rels';
        if (zip.file(layoutRelsPath)) {
          zip.remove(layoutRelsPath);
        }
      }
    }
    
    // 更新presentation.xml中的布局引用
    await updatePresentationLayouts(zip, usedLayouts);
  } catch (error) {
    console.error('删除未使用的布局时出错:', error);
  }
}

/**
 * 删除未使用的母版
 */
async function removeUnusedMasters(zip, usedMasters) {
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
    
    // 更新presentation.xml中的母版引用
    await updatePresentationMasters(zip, usedMasters);
  } catch (error) {
    console.error('删除未使用的母版时出错:', error);
  }
}

/**
 * 删除未使用的媒体文件
 */
async function removeUnusedMedia(zip, usedMedia) {
  try {
    // 获取所有媒体文件
    const mediaFiles = Object.keys(zip.files)
      .filter(path => path.startsWith('ppt/media/'));
    
    // 删除未使用的媒体文件
    for (const mediaPath of mediaFiles) {
      if (!usedMedia.has(mediaPath)) {
        zip.remove(mediaPath);
      }
    }
  } catch (error) {
    console.error('删除未使用的媒体文件时出错:', error);
  }
}

/**
 * 更新presentation.xml中的布局引用
 */
async function updatePresentationLayouts(zip, usedLayouts) {
  try {
    const presentationXml = await zip.file(PRESENTATION_PATH)?.async('string');
    if (!presentationXml) return;
    
    const presentationObj = await parseXmlWithNamespaces(presentationXml);
    
    // 更新presentation.xml.rels
    const relsPath = 'ppt/_rels/presentation.xml.rels';
    const relsXml = await zip.file(relsPath)?.async('string');
    if (!relsXml) return;
    
    const relsObj = await parseXml(relsXml);
    const relationships = Array.isArray(relsObj.Relationships.Relationship)
      ? relsObj.Relationships.Relationship
      : [relsObj.Relationships.Relationship];
    
    // 过滤出非布局关系和使用的布局关系
    relsObj.Relationships.Relationship = relationships.filter(rel => {
      if (!rel.Type.includes('/slideLayout')) return true;
      
      const layoutPath = `ppt/${rel.Target.replace('../', '')}`;
      return usedLayouts.has(layoutPath);
    });
    
    // 更新关系文件
    const updatedRelsXml = buildXml(relsObj);
    zip.file(relsPath, updatedRelsXml);
  } catch (error) {
    console.error('更新演示文稿布局引用时出错:', error);
  }
}

/**
 * 更新presentation.xml中的母版引用
 */
async function updatePresentationMasters(zip, usedMasters) {
  try {
    const presentationXml = await zip.file(PRESENTATION_PATH)?.async('string');
    if (!presentationXml) return;
    
    const presentationObj = await parseXmlWithNamespaces(presentationXml);
    
    // 更新presentation.xml.rels
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
 * 更新[Content_Types].xml
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