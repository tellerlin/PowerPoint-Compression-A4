import { parseStringPromise, Builder } from 'xml2js';
import { PRESENTATION_PATH } from './constants';

export async function removeHiddenSlides(zip) {
  try {
    // Load the presentation XML
    const presentationXml = await zip.file(PRESENTATION_PATH)?.async('string');
    if (!presentationXml) throw new Error('Presentation file not found');

    // Debugging: Log the XML content
    console.log('Presentation XML:', presentationXml.substring(0, 200)); // Log first 200 chars for inspection

    // Parse the presentation XML with explicit options
    let presentationObj;
    try {
      presentationObj = await parseStringPromise(presentationXml, {
        explicitArray: false,
        explicitRoot: false,
        xmlns: true,
        async: true,
        trim: true,
        normalizeTags: true,
        normalize: true
      });
      console.log('Parsed presentation object:', JSON.stringify(presentationObj, null, 2));
    } catch (parseError) {
      console.error('Error parsing presentation XML:', parseError);
      console.error('Presentation XML content:', presentationXml);
      throw new Error('Failed to parse presentation XML');
    }

    const sldIdLst = presentationObj?.['p:presentation']?.['p:sldIdLst']?.[0]?.['p:sldId'] || [];
    console.log('Parsed slide list:', sldIdLst);

    // Iterate over each slide and remove if hidden
    for (const slide of sldIdLst) {
      const slideId = slide.$?.id;
      const slideRId = slide.$?.['r:id'];
      
      if (!slideId || !slideRId) {
        console.warn(`Slide ID or RID missing for slide: ${JSON.stringify(slide)}`);
        continue;
      }

      const slideInfo = await getSlideInfo(zip, slideRId);
      if (!slideInfo) {
        console.warn(`Slide info not found for RID: ${slideRId}`);
        continue;
      }

      if (await isSlideHidden(zip, slideInfo.path)) {
        console.log(`Removing hidden slide ID: ${slideId}`);
        await removeSlide(zip, slideInfo, slideId);

        // Remove from presentation's slide list
        const index = sldIdLst.indexOf(slide);
        if (index > -1) {
          sldIdLst.splice(index, 1);
        }
      }
    }

    // Update presentation.xml with removed slides
    const builder = new Builder();
    const updatedXml = builder.buildObject(presentationObj);
    zip.file(PRESENTATION_PATH, updatedXml);

  } catch (error) {
    console.error('Error removing hidden slides:', error);
    throw new Error('Failed to remove hidden slides: ' + error.message);
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
  try {
    // Remove slide file
    if (zip.file(slideInfo.path)) {
      zip.remove(slideInfo.path);
    } else {
      console.warn(`Slide file not found: ${slideInfo.path}`);
    }

    // Remove slide relationships file
    if (zip.file(slideInfo.relsPath)) {
      zip.remove(slideInfo.relsPath);
    } else {
      console.warn(`Slide relationships file not found: ${slideInfo.relsPath}`);
    }

    // Update presentation relationships
    await updatePresentationRelationships(zip, slideId);
  } catch (error) {
    console.warn('Error removing slide:', error);
  }
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
      const builder = new Builder();
      zip.file(relsPath, builder.buildObject(relsObj));
    }
  } catch (error) {
    console.warn('Error updating presentation relationships:', error);
  }
}
