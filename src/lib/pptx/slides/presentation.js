import { parseXmlWithNamespaces, buildXml } from '../xml/parser';
import { PRESENTATION_PATH } from '../constants';

export async function getPresentationSlides(zip) {
  try {
    const presentationXml = await zip.file(PRESENTATION_PATH)?.async('string');
    if (!presentationXml) {
      console.warn('Presentation file not found');
      return [];
    }

    const presentationObj = await parseXmlWithNamespaces(presentationXml);
    const slidesList = presentationObj?.p_presentation?.p_sldIdLst?.p_sldId;
    
    if (!slidesList) {
      console.warn('No slides found in presentation');
      return [];
    }

    const slides = Array.isArray(slidesList) ? slidesList : [slidesList];

    return slides
      .filter(slide => slide && slide.$ && slide.$.id && slide.$.r_id)
      .map(slide => ({
        id: slide.$.id,
        rId: slide.$.r_id
      }));
  } catch (error) {
    console.error('Error getting presentation slides:', error);
    return [];
  }
}

export async function updatePresentationSlides(zip, presentationObj, remainingSlideIds) {
  try {
    if (!presentationObj?.p_presentation?.p_sldIdLst?.p_sldId) {
      console.warn('Invalid presentation object structure');
      return;
    }

    const slides = Array.isArray(presentationObj.p_presentation.p_sldIdLst.p_sldId)
      ? presentationObj.p_presentation.p_sldIdLst.p_sldId
      : [presentationObj.p_presentation.p_sldIdLst.p_sldId];

    presentationObj.p_presentation.p_sldIdLst.p_sldId = 
      slides.filter(slide => remainingSlideIds.includes(slide.$.id));

    const finalXml = buildXml(presentationObj);
    zip.file(PRESENTATION_PATH, finalXml);
  } catch (error) {
    console.error('Error updating presentation slides:', error);
  }
}