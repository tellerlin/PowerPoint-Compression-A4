import { parseXmlWithNamespaces } from '../xml/parser';
import { getPresentationSlides, updatePresentationSlides } from './presentation';
import { getSlideInfo } from './relationships';
import { isSlideHidden, removeSlide } from './slide';
import { PRESENTATION_PATH } from '../constants';

export async function removeHiddenSlides(zip) {
  try {
    const presentationXml = await zip.file(PRESENTATION_PATH)?.async('string');
    if (!presentationXml) {
      return;
    }

    const presentationObj = await parseXmlWithNamespaces(presentationXml);
    const slides = await getPresentationSlides(zip);
    
    if (slides.length === 0) {
      return;
    }

    const remainingSlideIds = [];
    let slidesRemoved = false;

    for (const slide of slides) {
      const slideInfo = await getSlideInfo(zip, slide.rId);
      if (!slideInfo) {
        remainingSlideIds.push(slide.id);
        continue;
      }

      const hidden = await isSlideHidden(zip, slideInfo.path);
      if (hidden) {
        await removeSlide(zip, slideInfo);
        slidesRemoved = true;
      } else {
        remainingSlideIds.push(slide.id);
      }
    }

    if (slidesRemoved) {
      await updatePresentationSlides(zip, presentationObj, remainingSlideIds);
    }

  } catch (error) {
    // ... existing code ...
  }
}