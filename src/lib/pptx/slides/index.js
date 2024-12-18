import { parseXmlWithNamespaces } from '../xml/parser';
import { getPresentationSlides, updatePresentationSlides } from './presentation';
import { getSlideInfo } from './relationships';
import { isSlideHidden, removeSlide } from './slide';
import { PRESENTATION_PATH } from '../constants';

/**
 * 移除隐藏的幻灯片
 * @param {JSZip} zip - 处理中的 ZIP 文件
 */
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

    const slideChecks = await Promise.all(slides.map(async (slide) => {
      const slideInfo = await getSlideInfo(zip, slide.rId);
      if (!slideInfo) {
        return { id: slide.id, hidden: false };
      }
      const hidden = await isSlideHidden(zip, slideInfo.path);
      return { id: slide.id, hidden, slideInfo };
    }));

    const remainingSlideIds = [];
    const slidesToRemove = [];

    slideChecks.forEach(check => {
      if (check.hidden) {
        slidesToRemove.push(check.slideInfo);
      } else {
        remainingSlideIds.push(check.id);
      }
    });

    if (slidesToRemove.length > 0) {
      await Promise.all(slidesToRemove.map(slideInfo => removeSlide(zip, slideInfo)));
      await updatePresentationSlides(zip, presentationObj, remainingSlideIds);
    }

  } catch (error) {
    console.error('Error removing hidden slides:', error);
  }
}

// 如果有其他需要导出的函数，继续在这里导出