import { parseXml } from '../xml/parser';

export async function getSlideInfo(zip, slideRId) {
  try {
    const relsPath = 'ppt/_rels/presentation.xml.rels';
    const relsXml = await zip.file(relsPath)?.async('string');
    if (!relsXml) {
      return null;
    }

    const relsObj = await parseXml(relsXml);
    const relationships = Array.isArray(relsObj.Relationships.Relationship)
      ? relsObj.Relationships.Relationship
      : [relsObj.Relationships.Relationship];

    const relationship = relationships.find(rel => rel.Id === slideRId);
    if (!relationship) return null;

    return {
      path: `ppt/${relationship.Target.replace('../', '')}`,
      relsPath: `ppt/slides/_rels/${relationship.Target.split('/').pop()}.rels`
    };
  } catch (error) {
    console.error('获取幻灯片信息时出错:', error);
    return null;
  }
}

export async function isSlideHidden(zip, slidePath) {
  try {
    const slideXml = await zip.file(slidePath)?.async('string');
    if (!slideXml) return false;

    const slideObj = await parseXml(slideXml);
    return slideObj?.p_sld?.show === '0';
  } catch (error) {
    console.error('判断幻灯片隐藏状态时出错:', error);
    return false;
  }
}

export async function removeSlide(zip, slideInfo) {
  try {
    zip.remove(slideInfo.path);
    
    if (zip.file(slideInfo.relsPath)) {
      zip.remove(slideInfo.relsPath);
    }
    
    await updateContentTypes(zip, slideInfo.path);
    await updatePresentationRels(zip, slideInfo.path);
  } catch (error) {
    console.warn('移除幻灯片时出错:', error);
  }
}