import { parseStringPromise } from 'xml2js';
import { PRESENTATION_PATH, SLIDE_PREFIX } from './constants';

export async function removeHiddenSlides(zip) {
  try {
    const presentationXml = await zip.file(PRESENTATION_PATH)?.async('string');
    if (!presentationXml) throw new Error('Presentation file not found');

    const presentationObj = await parseStringPromise(presentationXml);
    const sldIdLst = presentationObj?.['p:presentation']?.['p:sldIdLst']?.[0]?.['p:sldId'] || [];
    
    for (const slide of sldIdLst) {
      const slideId = slide.$?.id;
      const slideRId = slide.$?.['r:id'];
      if (!slideId || !slideRId) continue;

      const slideInfo = await getSlideInfo(zip, slideRId);
      if (!slideInfo) continue;

      if (await isSlideHidden(zip, slideInfo.path)) {
        await removeSlide(zip, slideInfo, slideId);
        // Remove from presentation's slide list
        const index = sldIdLst.indexOf(slide);
        if (index > -1) sldIdLst.splice(index, 1);
      }
    }

    // Update presentation.xml with removed slides
    const builder = new xml2js.Builder();
    zip.file(PRESENTATION_PATH, builder.buildObject(presentationObj));
  } catch (error) {
    console.error('Error removing hidden slides:', error);
    throw new Error('Failed to remove hidden slides');
  }
}

async function getSlideInfo(zip, slideRId) {
  try {
    const relsXml = await zip.file('ppt/_rels/presentation.xml.rels')?.async('string');
    if (!relsXml) return null;

    const relsObj = await parseStringPromise(relsXml);
    const relationship = relsObj.Relationships.Relationship
      .find(rel => rel.$.Id === slideRId);

    if (!relationship) return null;

    return {
      path: `ppt/${relationship.$.Target.replace('../', '')}`,
      relsPath: `ppt/slides/_rels/${relationship.$.Target.split('/').pop()}.rels`
    };
  } catch (error) {
    console.warn('Error getting slide info:', error);
    return null;
  }
}

async function isSlideHidden(zip, slidePath) {
  try {
    const slideXml = await zip.file(slidePath)?.async('string');
    if (!slideXml) return false;

    const slideObj = await parseStringPromise(slideXml);
    return slideObj['p:sld']?.$.show === '0';
  } catch (error) {
    console.warn('Error checking if slide is hidden:', error);
    return false;
  }
}

async function removeSlide(zip, slideInfo, slideId) {
  // Remove slide file
  zip.remove(slideInfo.path);
  
  // Remove slide relationships file
  zip.remove(slideInfo.relsPath);
  
  // Update presentation relationships
  await updatePresentationRelationships(zip, slideId);
}

async function updatePresentationRelationships(zip, slideId) {
  try {
    const relsPath = 'ppt/_rels/presentation.xml.rels';
    const relsXml = await zip.file(relsPath)?.async('string');
    if (!relsXml) return;

    const relsObj = await parseStringPromise(relsXml);
    const relationships = relsObj.Relationships.Relationship;
    
    // Remove relationship for the deleted slide
    const index = relationships.findIndex(rel => 
      rel.$.Target.includes(`slide${slideId}.xml`)
    );
    
    if (index > -1) {
      relationships.splice(index, 1);
      const builder = new xml2js.Builder();
      zip.file(relsPath, builder.buildObject(relsObj));
    }
  } catch (error) {
    console.warn('Error updating presentation relationships:', error);
  }
}