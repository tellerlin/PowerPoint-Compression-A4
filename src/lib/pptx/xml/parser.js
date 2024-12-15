import { parseStringPromise, Builder } from 'xml2js';

const DEFAULT_PARSE_OPTIONS = {
  explicitArray: false,
  mergeAttrs: false,
  xmlns: true,
  xmlnskey: 'xmlns',
  normalizeTags: true,
  normalize: true,
  trim: true,
  async: true
};

const NAMESPACE_PARSE_OPTIONS = {
  ...DEFAULT_PARSE_OPTIONS,
  attrNameProcessors: [(name) => name.replace(':', '_')],
  tagNameProcessors: [(name) => name.replace(':', '_')]
};

export async function parseXmlWithNamespaces(xml) {
  return await parseStringPromise(xml, NAMESPACE_PARSE_OPTIONS);
}

export async function parseXml(xml) {
  return await parseStringPromise(xml, {
    ...DEFAULT_PARSE_OPTIONS,
    mergeAttrs: true
  });
}

export function buildXml(obj) {
  const builder = new Builder({
    renderOpts: { pretty: true, indent: '  ' },
    xmldec: { version: '1.0', encoding: 'UTF-8', standalone: true },
    cdata: false
  });

  return builder.buildObject(obj)
    .replace(/p_/g, 'p:')
    .replace(/r_/g, 'r:')
    .replace(/a_/g, 'a:');
}
