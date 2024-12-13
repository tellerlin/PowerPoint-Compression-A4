import { parseXmlWithNamespaces } from '../xml/parser';
import { getPresentationSlides, updatePresentationSlides } from './presentation';
import { getSlideInfo } from './relationships';
import { isSlideHidden, removeSlide } from './slide';
import { PRESENTATION_PATH } from '../constants';

export async function removeHiddenSlides(zip) {
  try {
    // Get presentation XML and parse it
    const presentationXml = await zip.file(PRESENTATION_PATH)?.async('string');
    if (!presentationXml) {
      console.warn('No presentation file found');
      return;
    }

    const presentationObj = await parseXmlWithNamespaces(presentationXml);
    const slides = await getPresentationSlides(zip);
    
    if (slides.length === 0) {
      console.warn('No slides found to process');
      return;
    }

    // Process each slide
    const remainingSlideIds = [];
    let slidesRemoved = false;

    for (const slide of slides) {
      const slideInfo = await getSlideInfo(zip, slide.rId);
      if (!slideInfo) {
        console.warn(`Could not get info for slide ${slide.id}`);
        remainingSlideIds.push(slide.id);
        continue;
      }

      const hidden = await isSlideHidden(zip, slideInfo.path);
      if (hidden) {
        await removeSlide(zip, slideInfo);
        slidesRemoved = true;
        console.log(`Removed hidden slide ${slide.id}`);
      } else {
        remainingSlideIds.push(slide.id);
      }
    }

    // Only update presentation if slides were actually removed
    if (slidesRemoved) {
      await updatePresentationSlides(zip, presentationObj, remainingSlideIds);
    }

  } catch (error) {
    console.error('Error removing hidden slides:', error);
    // Log error but don't throw to allow processing to continue
  }
}