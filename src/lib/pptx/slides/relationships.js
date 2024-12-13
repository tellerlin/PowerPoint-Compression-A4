import { parseXml } from '../xml/parser';

export async function getSlideInfo(zip, slideRId) {
  try {
    const relsXml = await zip.file('ppt/_rels/presentation.xml.rels')?.async('string');
    if (!relsXml) return null;

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
    return null;
  }
}