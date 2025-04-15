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
                              'a:lstStyle', 'a:pPr', 'a:rPr', 'a:t', 'Relationship'];
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
// 增强XML解析函数，添加容错机制

export async function parseXmlWithNamespaces(xmlString) {
  try {
    // 原有解析逻辑
    const result = await parseXml(xmlString);
    return result;
  } catch (error) {
    console.error('XML解析错误:', error);
    
    // 尝试修复常见XML问题
    try {
      // 1. 修复未闭合的标签
      const fixedXml = fixUnclosedTags(xmlString);
      
      // 2. 修复无效字符
      const sanitizedXml = sanitizeXmlString(fixedXml);
      
      // 重新尝试解析
      return await parseXml(sanitizedXml);
    } catch (secondError) {
      console.error('XML修复后仍然解析失败:', secondError);
      // 返回一个最小可用的对象，避免null引用错误
      return { _parseFailed: true };
    }
  }
}

// 修复未闭合标签的辅助函数
function fixUnclosedTags(xmlString) {
  // 简单实现，实际应用中可能需要更复杂的逻辑
  const tagStack = [];
  const regex = /<\/?([a-zA-Z0-9:]+)[^>]*>/g;
  let match;
  
  while ((match = regex.exec(xmlString)) !== null) {
    const fullTag = match[0];
    const tagName = match[1];
    
    if (fullTag.startsWith('</')) {
      // 关闭标签
      if (tagStack.length > 0 && tagStack[tagStack.length - 1] === tagName) {
        tagStack.pop();
      }
    } else if (!fullTag.endsWith('/>')) {
      // 开放标签
      tagStack.push(tagName);
    }
  }
  
  // 添加缺失的关闭标签
  let result = xmlString;
  while (tagStack.length > 0) {
    const tagName = tagStack.pop();
    result += `</${tagName}>`;
  }
  
  return result;
}

// 清理XML字符串中的无效字符
function sanitizeXmlString(xmlString) {
  // 移除XML中不允许的控制字符
  return xmlString.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

// 增强parseXml函数，添加安全检查
export function parseXmlSafely(xmlString) {
  if (!xmlString || typeof xmlString !== 'string') {
    console.warn('尝试解析无效的XML内容:', xmlString);
    return { _invalid: true };
  }
  
  try {
    // 使用原有的parseXml函数
    return parseXml(xmlString);
  } catch (error) {
    console.error('XML解析错误:', error);
    return { _parseFailed: true, _error: error.message };
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
