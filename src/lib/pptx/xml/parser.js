import { XMLParser, XMLBuilder } from 'fast-xml-parser';

const DEFAULT_PARSE_OPTIONS = {
	ignoreAttributes: false,
	attributeNamePrefix: '@_',
    attributesGroupName: false, // Don't group attributes
    textNodeName: '_text', // Consistent name for text content
    removeNSPrefix: false, // Keep namespace prefixes (e.g., p:sld)
    allowBooleanAttributes: false, // Keep boolean attributes as strings e.g. show="0"
    parseAttributeValue: false, // Keep attribute values as strings "0" vs 0
    parseTagValue: false,      // Keep tag values as strings
	trimValues: true,         // Trim whitespace from values
	isArray: (name, jpath, isLeafNode, isAttribute) => {
		// Define elements that should always be arrays, even with one item
        // Added more common PPTX list elements + root list containers
		const arrayElements = [
            // Root list containers
            'Types', 'Relationships', 'p:sldMasterIdLst', 'p:notesMasterIdLst', 'p:handoutMasterIdLst', 'p:sldIdLst', 'p:sldLayoutIdLst', 'p:extLst', 'a:extLst',

            // Common list items
            'p:sldId', 'p:sldLayoutId', 'p:txBody', 'p:sp', 'p:pic', 'p:grpSp', 'p:graphicFrame', 'p:cxnSp', 'p:contentPart', 'p:sldMasterId', 'p:notesMasterId', 'p:handoutMasterId',
            'a:p', 'a:r', 'a:t', 'a:br', 'a:fld', 'a:ln', 'a:buFont', 'a:buChar', 'a:tab', 'a:tc', 'a:tr', 'a:txBody', 'a:graphicData', 'a:gs', 'a:effect', 'a:effectLst', 'a:gradFill',
            'Relationship', 'Override', 'Default',
            'p:ph', // Placeholder shapes often appear multiple times
            'a:ext', 'a:off', 'a:hslClr', 'a:lin', 'a:prstClr', 'a:schemeClr', 'a:scrgbClr', 'a:srgbClr', 'a:sysClr', // Color types
            'a:pattFill', 'a:tileRect', // Fills and effects
            'p:custShow', 'p:sld', // Custom shows
            'v:shape', 'v:shapetype', 'v:group', 'o:OLEObject' // VML/OLE objects if present
        ];
        // Check the element name itself or the last part of the jpath
		return arrayElements.includes(name) || arrayElements.includes(jpath.split('.').pop());
	}
};

const DEFAULT_BUILD_OPTIONS = {
	ignoreAttributes: false,
	attributeNamePrefix: '@_',
    attributesGroupName: false,
    textNodeName: '_text',
	format: true, // Pretty print XML
	indentBy: '  ',
    suppressEmptyNode: false, // *** CHANGED: Keep empty tags like <p:txBody /> or <a:p/> ***
    suppressBooleanAttributes: false, // Keep boolean attributes like show="0"
    processEntities: true // Encode special characters like & to &amp;
};

function sanitizeXmlString(xmlString) {
    if (typeof xmlString !== 'string') return '';
	// Remove specific ranges of control characters except tab, newline, carriage return
    // eslint-disable-next-line no-control-regex
	return xmlString.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}


export function parseXml(xmlContent) {
    if (!xmlContent || typeof xmlContent !== 'string') {
        console.warn('[parseXml] Input is not a valid string.');
        return { _parseFailed: true, _error: 'Invalid input string' };
    }

	try {
		const sanitizedXml = sanitizeXmlString(xmlContent);
        if (!sanitizedXml && xmlContent) {
             console.warn('[parseXml] XML content became empty after sanitization.');
        }
		const parser = new XMLParser(DEFAULT_PARSE_OPTIONS);
		const result = parser.parse(sanitizedXml);
        // Check for parser errors if the library provides them (fast-xml-parser might throw instead)
		return result;
	} catch (error) {
		console.error('[parseXml] XML parsing error:', error.message);
        // Provide more context if possible
        const context = xmlContent.length > 200 ? xmlContent.substring(0, 100) + '...' + xmlContent.substring(xmlContent.length - 100) : xmlContent;
        console.error('[parseXml] Context:', context);
		return { _parseFailed: true, _error: error.message };
	}
}


export function buildXml(jsObject) {
    if (!jsObject || typeof jsObject !== 'object') {
         console.error('[buildXml] Invalid input: jsObject must be an object.');
         throw new Error('Cannot build XML from invalid input object');
    }
    if (jsObject._parseFailed) {
         console.error('[buildXml] Attempting to build XML from a previously failed parse result.');
         throw new Error('Cannot build XML from failed parse result');
    }

	try {
		const builder = new XMLBuilder(DEFAULT_BUILD_OPTIONS);
		const xmlContent = builder.build(jsObject);
        // Add XML declaration manually if needed (fast-xml-parser v4 doesn't add it by default)
        // Ensure it's not added twice if the builder starts adding it in future versions
        if (!xmlContent.startsWith('<?xml')) {
            return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${xmlContent}`;
        }
        return xmlContent;

	} catch (error) {
		console.error('[buildXml] Error building XML:', error.message);
		throw error; // Re-throw after logging
	}
}


export async function parseXmlFromZip(zip, path) {
	try {
		const file = zip.file(path);
		if (!file) {
			console.warn(`[parseXmlFromZip] File not found in ZIP: ${path}`);
			return { _notFound: true };
		}

		const content = await file.async('text');
        if (!content) {
             console.warn(`[parseXmlFromZip] File is empty: ${path}`);
             return { _empty: true };
        }
		return parseXml(content); // Use the main safe parser
	} catch (error) {
		console.error(`[parseXmlFromZip] Error reading/parsing XML from ZIP (${path}):`, error.message);
		return { _parseFailed: true, _error: error.message }; // Return error state object
	}
}
