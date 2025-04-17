import { XMLParser, XMLBuilder } from 'fast-xml-parser';
// Removed import for xml2js if it existed

/**
 * Parse XML content using fast-xml-parser.
 * This function handles attributes and attempts to correctly identify arrays for common PPTX elements.
 * @param {string} xmlContent - XML string to parse. Should be a valid XML string.
 * @returns {Object} - Parsed JavaScript object.
 * @throws {Error} Throws an error if parsing fails.
 */
export function parseXmlSync(xmlContent) {
  // Input validation
  if (typeof xmlContent !== 'string' || xmlContent.trim().length === 0) {
    console.warn('Attempted to parse empty or invalid XML content.');
    // Depending on requirements, either return null/empty object or throw
    throw new Error('Invalid XML content provided for parsing.');
  }
  try {
    const options = {
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      // Define which tags should always be treated as arrays
      isArray: (name, jpath, isLeafNode, isAttribute) => {
        const arrayElements = [
          'p:sldId', 'p:sldLayoutId', 'p:txBody', 'p:sp', 'p:pic', 'p:graphicFrame', 'p:grpSp', 'p:AlternateContent', // PresentationML specific
          'a:p', 'a:r', 'a:t', 'a:br', 'a:fld', // DrawingML text related
          'a:off', 'a:ext', 'a:prstGeom', 'a:custGeom', 'a:pathLst', 'a:path', // DrawingML shapes/geometry
          'a:gsLst', 'a:gs', // DrawingML gradients
          'a:ln', 'a:fillRef', 'a:effectRef', 'a:fontRef', // DrawingML references
          'Relationship', // Relationship files
          // Add other tags known to appear multiple times even if single
        ];
        // Simple check if the tag name exists in our list
        return arrayElements.includes(name);
      },
      // Optional: Configure handling of text nodes if needed
      // textNodeName: "#text",
      // trimValues: true, // Trim whitespace from values
      // processEntities: true, // Decode HTML entities
      // htmlEntities: true,
    };

    const parser = new XMLParser(options);
    const result = parser.parse(xmlContent);
    // Optional: Add a check for minimal structure if needed, e.g., check if root element exists
    if (Object.keys(result).length === 0) {
        console.warn(`XML parsing resulted in an empty object for content starting with: ${xmlContent.substring(0, 50)}...`);
        // Decide if this is an error or acceptable
    }
    return result;
  } catch (error) {
    console.error('Error parsing XML with fast-xml-parser:', error.message);
    // Provide more context if possible
    console.error(`XML content snippet (first 100 chars): ${xmlContent.substring(0, 100)}...`);
    // Re-throw the error to be handled by the caller
    throw new Error(`XML parsing failed: ${error.message}`);
  }
}

// Export parseXmlSync as the primary XML parsing function
export const parseXml = parseXmlSync;

// Removed the complex parseXmlWithNamespaces function and its helpers (fixUnclosedTags, sanitizeXmlString)
// Removed parseXmlSafely function

/**
 * Convert JavaScript object back to XML string using fast-xml-parser.
 * @param {Object} jsObject - JavaScript object to convert. Should be in the format expected by fast-xml-parser.
 * @returns {string} - Generated XML string.
 * @throws {Error} Throws an error if building fails.
 */
export function buildXml(jsObject) {
  // Input validation
  if (typeof jsObject !== 'object' || jsObject === null || Object.keys(jsObject).length === 0) {
      console.warn('Attempted to build XML from invalid or empty object.');
      throw new Error('Invalid JavaScript object provided for building XML.');
  }
  try {
    const options = {
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      format: true, // Enable pretty printing
      indentBy: '  ', // Indentation string
      // Optional: Configure handling of text nodes if needed
      // textNodeName: "#text",
      // suppressEmptyNode: true, // Remove empty tags like <a:pPr/>
      // processEntities: true, // Encode special characters to entities
    };

    const builder = new XMLBuilder(options);
    let xml = builder.build(jsObject);
    // 修正：只在没有声明时添加
    if (!xml.trim().startsWith('<?xml')) {
      xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + xml;
    }
    return xml;
  } catch (error) {
    console.error('Error building XML with fast-xml-parser:', error.message);
    console.error('Input JS Object (structure):', JSON.stringify(jsObject, null, 2).substring(0, 200) + '...'); // Log structure safely
    throw new Error(`XML building failed: ${error.message}`);
  }
}

// Removed parseXmlFromZip function
// Removed parseXmlWithNamespacesFromZip function
// Removed parseXmlAsync (xml2js based) function
