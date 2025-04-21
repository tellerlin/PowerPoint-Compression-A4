import { XMLParser, XMLBuilder } from 'fast-xml-parser';

/**
 * Parse XML content
 * @param {string} xmlContent - XML string to parse
 * @returns {Object} - Parsed JavaScript object
 */
export function parseXmlSync(xmlContent) {
  try {
    const options = {
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      isArray: (name, jpath, isLeafNode, isAttribute) => {
        // Some elements should always be treated as arrays, even if there's only one element
        const arrayElements = ['p:sp', 'p:pic', 'a:p', 'a:r', 'p:nvSpPr', 'p:cNvPr', 'p:cNvSpPr', 
                              'p:spPr', 'a:xfrm', 'a:off', 'a:ext', 'p:txBody', 'a:bodyPr', 
                              'a:lstStyle', 'a:pPr', 'a:rPr', 'a:t', 'Relationship'];
        return arrayElements.includes(name);
      }
    };
    
    const parser = new XMLParser(options);
    return parser.parse(xmlContent);
  } catch (error) {
    console.error('Error parsing XML:', error);
    throw error;
  }
}

// For backward compatibility
export const parseXml = parseXmlSync;

/**
 * Parse XML content with namespaces
 * @param {string} xmlContent - XML string to parse
 * @returns {Object} - Parsed JavaScript object
 */
// Enhanced XML parsing function with error handling

export async function parseXmlWithNamespaces(xmlString) {
  try {
    // Use the sync version for consistency
    const result = parseXmlSync(xmlString);
    return result;
  } catch (error) {
    console.error('XML parsing error:', error);
    
    // Try to fix common XML issues
    try {
      // 1. Fix unclosed tags
      const fixedXml = fixUnclosedTags(xmlString);
      
      // 2. Fix invalid characters
      const sanitizedXml = sanitizeXmlString(fixedXml);
      
      // Try parsing again with the sync version
      return parseXmlSync(sanitizedXml);
    } catch (secondError) {
      console.error('XML parsing still failed after fixes:', secondError);
      // Return a minimal usable object to avoid null reference errors
      return { _parseFailed: true };
    }
  }
}

// Helper function to fix unclosed tags
function fixUnclosedTags(xmlString) {
  // Simple implementation, more complex logic might be needed in real applications
  const tagStack = [];
  const regex = /<\/?([a-zA-Z0-9:]+)[^>]*>/g;
  let match;
  
  while ((match = regex.exec(xmlString)) !== null) {
    const fullTag = match[0];
    const tagName = match[1];
    
    if (fullTag.startsWith('</')) {
      // Closing tag
      if (tagStack.length > 0 && tagStack[tagStack.length - 1] === tagName) {
        tagStack.pop();
      }
    } else if (!fullTag.endsWith('/>')) {
      // Opening tag
      tagStack.push(tagName);
    }
  }
  
  // Add missing closing tags
  let result = xmlString;
  while (tagStack.length > 0) {
    const tagName = tagStack.pop();
    result += `</${tagName}>`;
  }
  
  return result;
}

// Clean invalid characters from XML string
function sanitizeXmlString(xmlString) {
  // Remove control characters not allowed in XML
  return xmlString.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

// Enhanced parseXml function with safety checks
function parseXmlSafely(xmlString) {
  if (!xmlString || typeof xmlString !== 'string') {
    console.warn('Attempted to parse invalid XML content:', xmlString);
    return { _invalid: true };
  }
  
  try {
    // Use the sync version
    return parseXmlSync(xmlString);
  } catch (error) {
    console.error('XML parsing error:', error);
    return { _parseFailed: true, _error: error.message };
  }
}

/**
 * Convert JavaScript object to XML string
 * @param {Object} jsObject - JavaScript object to convert
 * @returns {string} - Generated XML string
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
    console.error('Error building XML:', error);
    throw error;
  }
}

/**
 * Read and parse XML file from ZIP
 * @param {JSZip} zip - JSZip instance
 * @param {string} path - File path within ZIP
 * @returns {Promise<Object>} - Parsed JavaScript object
 */
export async function parseXmlFromZip(zip, path) {
  try {
    const file = zip.file(path);
    if (!file) {
      console.warn(`File does not exist: ${path}`);
      return null;
    }
    
    const content = await file.async('text');
    return parseXml(content);
  } catch (error) {
    console.error(`Error parsing XML file from ZIP (${path}):`, error);
    throw error;
  }
}

/**
 * Read and parse XML file with namespaces from ZIP
 * @param {JSZip} zip - JSZip instance
 * @param {string} path - File path within ZIP
 * @returns {Promise<Object>} - Parsed JavaScript object
 */
export async function parseXmlWithNamespacesFromZip(zip, path) {
  try {
    const file = zip.file(path);
    if (!file) {
      console.warn(`File does not exist: ${path}`);
      return null;
    }
    
    const content = await file.async('text');
    return parseXmlWithNamespaces(content);
  } catch (error) {
    console.error('Error parsing XML:', error);
    throw error;
  }
}

// Rename the async version to avoid conflict
export async function parseXmlAsync(xmlString) {
  try {
    // Try to fix unclosed tags
    const fixedXml = fixUnclosedTags(xmlString);
    const result = await xml2js.parseStringPromise(fixedXml, {
      explicitArray: false,
      normalizeTags: false
    });
    return result;
  } catch (error) {
    console.error('XML parsing error:', error.message);
    // Add more detailed error information
    const errorInfo = {
      message: error.message,
      xmlPreview: xmlString.length > 100 ? xmlString.substring(0, 100) + '...' : xmlString,
      errorPosition: error.line ? `Line ${error.line}, Column ${error.column}` : 'Unknown position'
    };
    
    // Throw enhanced error object
    const enhancedError = new Error(`XML parsing failed: ${error.message}`);
    enhancedError.details = errorInfo;
    throw enhancedError;
  }
}
