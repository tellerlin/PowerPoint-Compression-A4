import { XMLParser, XMLBuilder } from 'fast-xml-parser';

/**
 * 解析XML内容
 * @param {string} xmlContent - 要解析的XML字符串
 * @returns {Object} - 解析后的JavaScript对象
 */
export function parseXml(xmlContent) {
  try {
    const options = {
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      isArray: (name, jpath, isLeafNode, isAttribute) => {
        // 某些元素应该始终作为数组处理，即使只有一个元素
        const arrayElements = ['p:sp', 'p:pic', 'a:p', 'a:r', 'p:nvSpPr', 'p:cNvPr', 'p:cNvSpPr', 
                              'p:spPr', 'a:xfrm', 'a:off', 'a:ext', 'p:txBody', 'a:bodyPr', 
                              'a:lstStyle', 'a:pPr', 'a:rPr', 'a:t'];
        return arrayElements.includes(name);
      }
    };
    
    const parser = new XMLParser(options);
    return parser.parse(xmlContent);
  } catch (error) {
    console.error('解析XML时出错:', error);
    throw error;
  }
}

/**
 * 解析带命名空间的XML内容
 * @param {string} xmlContent - 要解析的XML字符串
 * @returns {Object} - 解析后的JavaScript对象
 */
export function parseXmlWithNamespaces(xmlContent) {
  try {
    const options = {
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      isArray: (name, jpath, isLeafNode, isAttribute) => {
        // 某些元素应该始终作为数组处理，即使只有一个元素
        const arrayElements = ['p:sp', 'p:pic', 'a:p', 'a:r', 'p:nvSpPr', 'p:cNvPr', 'p:cNvSpPr', 
                              'p:spPr', 'a:xfrm', 'a:off', 'a:ext', 'p:txBody', 'a:bodyPr', 
                              'a:lstStyle', 'a:pPr', 'a:rPr', 'a:t'];
        return arrayElements.includes(name);
      },
      processEntities: true,
      htmlEntities: true
    };
    
    const parser = new XMLParser(options);
    return parser.parse(xmlContent);
  } catch (error) {
    console.error('解析XML时出错:', error);
    throw error;
  }
}

/**
 * 将JavaScript对象转换为XML字符串
 * @param {Object} jsObject - 要转换的JavaScript对象
 * @returns {string} - 生成的XML字符串
 */
export function buildXml(jsObject) {
  try {
    const options = {
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      format: true,
      indentBy: '  '
    };
    
    const builder = new XMLBuilder(options);
    const xmlContent = builder.build(jsObject);
    return xmlContent;
  } catch (error) {
    console.error('构建XML时出错:', error);
    throw error;
  }
}

/**
 * 从ZIP文件中读取并解析XML文件
 * @param {JSZip} zip - JSZip实例
 * @param {string} path - ZIP内的文件路径
 * @returns {Promise<Object>} - 解析后的JavaScript对象
 */
export async function parseXmlFromZip(zip, path) {
  try {
    const file = zip.file(path);
    if (!file) {
      console.warn(`文件不存在: ${path}`);
      return null;
    }
    
    const content = await file.async('text');
    return parseXml(content);
  } catch (error) {
    console.error(`解析ZIP中的XML文件时出错 (${path}):`, error);
    throw error;
  }
}

/**
 * 从ZIP文件中读取并解析带命名空间的XML文件
 * @param {JSZip} zip - JSZip实例
 * @param {string} path - ZIP内的文件路径
 * @returns {Promise<Object>} - 解析后的JavaScript对象
 */
export async function parseXmlWithNamespacesFromZip(zip, path) {
  try {
    const file = zip.file(path);
    if (!file) {
      console.warn(`文件不存在: ${path}`);
      return null;
    }
    
    const content = await file.async('text');
    return parseXmlWithNamespaces(content);
  } catch (error) {
    console.error('解析 XML 时出错:', error);
    throw error;
  }
}