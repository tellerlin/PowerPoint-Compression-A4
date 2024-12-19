import { PRESENTATION_PATH } from './constants';

const parseXml = async (zip, path) => {
  try {
    const xml = await zip.file(path)?.async('string');
    if (!xml) {
      return null;
    }
    const parser = new DOMParser();
    return parser.parseFromString(xml, 'text/xml');
  } catch (error) {
    console.error(`Error parsing XML at ${path}:`, error);
    return null;
  }
};

const removeNode = (node) => {
  if (node && node.parentNode) {
    node.parentNode.removeChild(node);
  }
};

export async function removeHiddenSlides(zip) {
  try {
    const presentationXml = await parseXml(zip, PRESENTATION_PATH);
    if (!presentationXml) {
      return;
    }

    const slideNodes = presentationXml.getElementsByTagNameNS('http://schemas.openxmlformats.org/presentationml/2006/main', 'sldId');

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

    for (const { slideNode, slideInfo } of slidesToRemove) {
      removeNode(slideNode);
      await removeSlide(zip, slideInfo);
    }

    const serializer = new XMLSerializer();
    const updatedXml = serializer.serializeToString(presentationXml);
    zip.file(PRESENTATION_PATH, updatedXml);  

  } catch (error) {
    console.error('Error removing hidden slides:', error);
  }
}

async function getSlideInfo(zip, slideRId) {
  try {
    const relsXml = await zip.file('ppt/_rels/presentation.xml.rels')?.async('string');
    if (!relsXml) {
      return null;
    }

    const parser = new DOMParser();
    const relsDoc = parser.parseFromString(relsXml, 'text/xml');
    const relationship = relsDoc.querySelector(`Relationship[Id="${slideRId}"]`);
    if (!relationship) {
      return null;
    }

    const target = relationship.getAttribute('Target');
    const slidePath = `ppt/${target.replace('../', '')}`;

    return {
      path: slidePath,
      relsPath: slidePath.replace('slides/', 'slides/_rels/') + '.rels'
    };
  } catch (error) {
    console.error(`Error getting slide info for ${slideRId}:`, error);
    return null;
  }
}

async function isSlideHidden(zip, slidePath) {
  try {
    const slideXml = await zip.file(slidePath)?.async('string');
    if (!slideXml) {
      return false;
    }

    const isHidden = slideXml.includes('show="0"');
    return isHidden;
  } catch (error) {
    return false;
  }
}

async function removeSlide(zip, slideInfo) {
  try {
    zip.remove(slideInfo.path);

    if (zip.file(slideInfo.relsPath)) {
      zip.remove(slideInfo.relsPath);
    }

    await updateContentTypes(zip, slideInfo.path);
    await updatePresentationRels(zip, slideInfo.path);
  } catch (error) {
    console.warn('Error removing slide:', error);
  }
}

async function updateContentTypes(zip, slidePath) {
  try {
    const contentTypesXml = await zip.file('[Content_Types].xml')?.async('string');
    if (!contentTypesXml) {
      return;
    }

    const parser = new DOMParser();
    const contentTypesDoc = parser.parseFromString(contentTypesXml, 'text/xml');
    const slidePartName = `/ppt/${slidePath.split('ppt/')[1]}`;
    const overrideElement = contentTypesDoc.querySelector(`Override[PartName="${slidePartName}"]`);

    if (overrideElement && overrideElement.parentNode) {
      overrideElement.parentNode.removeChild(overrideElement);
      const serializer = new XMLSerializer();
      const updatedXml = serializer.serializeToString(contentTypesDoc);
      zip.file('[Content_Types].xml', updatedXml);
    }
  } catch (error) {
    console.warn('Error updating content types:', error);
  }
}

async function updatePresentationRels(zip, slidePath) {
  try {
    const relsXml = await zip.file('ppt/_rels/presentation.xml.rels')?.async('string');
    if (!relsXml) {
      return;
    }

    const parser = new DOMParser();
    const relsDoc = parser.parseFromString(relsXml, 'text/xml');
    const slideTarget = `slides/${slidePath.split('slides/')[1]}`;
    const relationshipElement = relsDoc.querySelector(`Relationship[Target="${slideTarget}"]`);
    
    if (relationshipElement && relationshipElement.parentNode) {
      relationshipElement.parentNode.removeChild(relationshipElement);
      
      const serializer = new XMLSerializer();
      const updatedXml = serializer.serializeToString(relsDoc);
      zip.file('ppt/_rels/presentation.xml.rels', updatedXml);
    }
  } catch (error) {
    console.warn('Error updating presentation rels:', error);
  }
}