import { PRESENTATION_PATH } from './constants';

export async function removeHiddenSlides(zip) {
  try {
    console.log('Starting removeHiddenSlides...');
    const presentationXml = await zip.file(PRESENTATION_PATH)?.async('string');
    if (!presentationXml) {
      console.log('Presentation file not found');
      return;
    }

    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(presentationXml, 'text/xml');
    const slideNodes = xmlDoc.getElementsByTagNameNS('http://schemas.openxmlformats.org/presentationml/2006/main', 'sldId');
    console.log(`Found ${slideNodes.length} slides`);

    const slidesToRemove = [];
    for (let i = 0; i < slideNodes.length; i++) {
      const slideNode = slideNodes[i];
      const slideId = slideNode.getAttribute('id');
      const slideRId = slideNode.getAttribute('r:id');
      if (!slideId || !slideRId) continue;

      const slideInfo = await getSlideInfo(zip, slideRId);
      if (slideInfo && await isSlideHidden(zip, slideInfo.path)) {
        slidesToRemove.push({ slideNode, slideInfo });
      }
    }

    console.log(`Removing ${slidesToRemove.length} slides`);
    for (const { slideNode, slideInfo } of slidesToRemove) {
      slideNode.parentNode.removeChild(slideNode);
      await removeSlide(zip, slideInfo);
    }

    const serializer = new XMLSerializer();
    const updatedXml = serializer.serializeToString(xmlDoc);
    zip.file(PRESENTATION_PATH, updatedXml);  // 写入更新后的 XML

  } catch (error) {
    console.error('Error removing hidden slides:', error);
  }
}


async function getSlideInfo(zip, slideRId) {
  try {
    console.log(`Getting slide info for rId: ${slideRId}`);
    const relsPath = 'ppt/_rels/presentation.xml.rels';
    const relsXml = await zip.file(relsPath)?.async('string');
    if (!relsXml) {
      console.log('Relationship file not found');
      return null;
    }

    const parser = new DOMParser();
    const relsDoc = parser.parseFromString(relsXml, 'text/xml');
    const relationship = relsDoc.querySelector(`Relationship[Id="${slideRId}"]`);

    if (!relationship) {
      console.log(`No relationship found for rId: ${slideRId}`);
      return null;
    }

    const target = relationship.getAttribute('Target');
    const slidePath = `ppt/${target.replace('../', '')}`;
    console.log(`Found slide path: ${slidePath}`);

    return {
      path: slidePath,
      relsPath: slidePath.replace('slides/', 'slides/_rels/') + '.rels'
    };
  } catch (error) {
    console.warn('Error getting slide info:', error);
    return null;
  }
}

async function isSlideHidden(zip, slidePath) {
  try {
    console.log(`Checking if slide is hidden: ${slidePath}`);
    const slideXml = await zip.file(slidePath)?.async('string');
    if (!slideXml) {
      console.log(`Slide file not found: ${slidePath}`);
      return false;
    }

    console.log(`Slide content preview: ${slideXml.substring(0, 200)}`);
    const isHidden = slideXml.includes('show="0"');
    console.log(`Slide ${slidePath} hidden status: ${isHidden}`);
    return isHidden;
  } catch (error) {
    console.warn('Error checking if slide is hidden:', error);
    console.warn('Error stack:', error.stack);
    return false;
  }
}

async function removeSlide(zip, slideInfo) {
  try {
    console.log(`Removing slide file: ${slideInfo.path}`);
    zip.remove(slideInfo.path);

    console.log(`Checking for slide rels file: ${slideInfo.relsPath}`);
    if (zip.file(slideInfo.relsPath)) {
      console.log(`Removing slide rels file: ${slideInfo.relsPath}`);
      zip.remove(slideInfo.relsPath);
    }

    await updateContentTypes(zip, slideInfo.path);
    await updatePresentationRels(zip, slideInfo.path);
  } catch (error) {
    console.warn('Error removing slide:', error);
    console.warn('Error stack:', error.stack);
  }
}

async function updateContentTypes(zip, slidePath) {
  try {
    console.log('Updating [Content_Types].xml');
    const contentTypesXml = await zip.file('[Content_Types].xml')?.async('string');
    if (!contentTypesXml) {
      console.log('[Content_Types].xml not found');
      return;
    }

    const parser = new DOMParser();
    const contentTypesDoc = parser.parseFromString(contentTypesXml, 'text/xml');
    const slidePartName = `/ppt/${slidePath.split('ppt/')[1]}`;
    const overrideElement = contentTypesDoc.querySelector(`Override[PartName="${slidePartName}"]`);
    
    if (overrideElement && overrideElement.parentNode) {
      console.log(`Removing content type override for: ${slidePartName}`);
      overrideElement.parentNode.removeChild(overrideElement);
      
      const serializer = new XMLSerializer();
      const updatedXml = serializer.serializeToString(contentTypesDoc);
      zip.file('[Content_Types].xml', updatedXml);
    }
  } catch (error) {
    console.warn('Error updating content types:', error);
    console.warn('Error stack:', error.stack);
  }
}

async function updatePresentationRels(zip, slidePath) {
  try {
    console.log('Updating presentation.xml.rels');
    const relsPath = 'ppt/_rels/presentation.xml.rels';
    const relsXml = await zip.file(relsPath)?.async('string');
    if (!relsXml) {
      console.log('presentation.xml.rels not found');
      return;
    }

    const parser = new DOMParser();
    const relsDoc = parser.parseFromString(relsXml, 'text/xml');
    const slideTarget = `slides/${slidePath.split('slides/')[1]}`;
    const relationshipElement = relsDoc.querySelector(`Relationship[Target="${slideTarget}"]`);
    
    if (relationshipElement && relationshipElement.parentNode) {
      console.log(`Removing relationship for: ${slideTarget}`);
      relationshipElement.parentNode.removeChild(relationshipElement);
      
      const serializer = new XMLSerializer();
      const updatedXml = serializer.serializeToString(relsDoc);
      zip.file(relsPath, updatedXml);
    }
  } catch (error) {
    console.warn('Error updating presentation rels:', error);
    console.warn('Error stack:', error.stack);
  }
}