import { parseXmlWithNamespaces, buildXml, parseXml } from './xml/parser';
import { MEDIA_PATH_PREFIX } from './constants';

/**
 * 查找所有媒体文件
 * @param {JSZip} zip PPTX的ZIP对象
 * @returns {Array<string>} 媒体文件路径数组
 */
export function findMediaFiles(zip) {
  return Object.keys(zip.files)
    .filter(path => path.startsWith(MEDIA_PATH_PREFIX));
}

/**
 * 处理媒体文件
 * @param {JSZip} zip PPTX的ZIP对象
 * @param {string} mediaPath 媒体文件路径
 * @param {Function} processor 处理函数
 */
export async function processMediaFile(zip, mediaPath, processor) {
  const file = zip.file(mediaPath);
  if (!file) return;
  
  const data = await file.async('uint8array');
  const processedData = await processor(data);
  
  if (processedData) {
    zip.file(mediaPath, processedData);
  }
}

/**
 * 删除隐藏的幻灯片
 * @param {JSZip} zip PPTX的ZIP对象
 */
export async function removeHiddenSlides(zip) {
  try {
    // Get presentation.xml
    const presentationXml = await zip.file('ppt/presentation.xml')?.async('string');
    if (!presentationXml) return false;
    
    // Parse XML
    const presentationObj = await parseXmlWithNamespaces(presentationXml);
    const slidesList = presentationObj?.p_presentation?.p_sldIdLst?.p_sldId;
    
    if (!slidesList) return false;
    
    // Convert to array
    const slides = Array.isArray(slidesList) ? slidesList : [slidesList];
    
    // Find hidden slides
    const hiddenSlides = slides.filter(slide => 
      slide && slide.$ && slide.$.show === '0'
    );
    
    if (hiddenSlides.length === 0) return false;
    
    // Get slide relationships
    const relsPath = 'ppt/_rels/presentation.xml.rels';
    const relsXml = await zip.file(relsPath)?.async('string');
    if (!relsXml) return false;
    
    const relsObj = await parseXml(relsXml);
    
    // Remove hidden slides
    for (const hiddenSlide of hiddenSlides) {
      const slideId = hiddenSlide.$.id;
      const slideRId = hiddenSlide.$.r_id;
      
      // Find corresponding relationship
      const relationship = relsObj.Relationships.Relationship.find(rel => 
        rel.Id === slideRId
      );
      
      if (!relationship) continue;
      
      // Get slide path
      const slidePath = `ppt/${relationship.Target.replace('../', '')}`;
      
      // Remove slide file
      zip.remove(slidePath);
      
      // Remove slide relationship file
      const slideRelsPath = slidePath.replace('slides/', 'slides/_rels/') + '.rels';
      if (zip.file(slideRelsPath)) {
        zip.remove(slideRelsPath);
      }
      
      // Remove slide reference from presentation.xml
      const slideIdIndex = slides.findIndex(s => s.$.id === slideId);
      if (slideIdIndex !== -1) {
        slides.splice(slideIdIndex, 1);
      }
      
      // Remove reference from relationship file
      const relIndex = relsObj.Relationships.Relationship.findIndex(rel => 
        rel.Id === slideRId
      );
      if (relIndex !== -1) {
        relsObj.Relationships.Relationship.splice(relIndex, 1);
      }
    }
    
    // Update presentation.xml
    if (Array.isArray(slidesList)) {
      presentationObj.p_presentation.p_sldIdLst.p_sldId = slides;
    } else {
      presentationObj.p_presentation.p_sldIdLst.p_sldId = slides.length > 0 ? slides : undefined;
    }
    
    const updatedPresentationXml = buildXml(presentationObj);
    zip.file('ppt/presentation.xml', updatedPresentationXml);
    
    // Update relationship file
    const updatedRelsXml = buildXml(relsObj);
    zip.file(relsPath, updatedRelsXml);
    
    return true;
  } catch (error) {
    console.error('Error removing hidden slides:', error);
    return false;
  }
}