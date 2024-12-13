import { parseXml } from '../xml/parser';

export async function isSlideHidden(zip, slidePath) {
  try {
    const slideXml = await zip.file(slidePath)?.async('string');
    if (!slideXml) return false;

    const slideObj = await parseXml(slideXml);
    return slideObj?.p_sld?.show === '0';
  } catch (error) {
    return false;
  }
}

export async function removeSlide(zip, slideInfo) {
  try {
    zip.remove(slideInfo.path);
    
    if (zip.file(slideInfo.relsPath)) {
      zip.remove(slideInfo.relsPath);
    }
  } catch (error) {
    console.warn('Error removing slide:', error);
  }
}