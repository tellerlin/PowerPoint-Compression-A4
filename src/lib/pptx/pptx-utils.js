// Replace the import line
import { Builder } from 'xml2js';

/**
 * Parse XML string using browser's DOMParser
 * @param {string} xmlString XML string to parse
 * @returns {Object} Parsed XML object
 */
async function parseXmlString(xmlString) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlString, 'text/xml');
  
  // Convert XML DOM to a JavaScript object similar to xml2js output
  function domToObject(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.nodeValue.trim();
    }
    
    const obj = {};
    
    // Add attributes
    if (node.attributes && node.attributes.length > 0) {
      obj.$ = {};
      for (let i = 0; i < node.attributes.length; i++) {
        const attr = node.attributes[i];
        obj.$[attr.name] = attr.value;
      }
    }
    
    // Process child nodes
    const childNodes = Array.from(node.childNodes).filter(n => 
      n.nodeType === Node.ELEMENT_NODE || 
      (n.nodeType === Node.TEXT_NODE && n.nodeValue.trim() !== '')
    );
    
    if (childNodes.length > 0) {
      childNodes.forEach(child => {
        if (child.nodeType === Node.TEXT_NODE) {
          const text = child.nodeValue.trim();
          if (text) {
            obj._ = text;
          }
        } else {
          const childName = child.nodeName;
          const childObj = domToObject(child);
          
          if (!obj[childName]) {
            obj[childName] = childObj;
          } else if (Array.isArray(obj[childName])) {
            obj[childName].push(childObj);
          } else {
            obj[childName] = [obj[childName], childObj];
          }
        }
      });
    }
    
    return obj;
  }
  
  return domToObject(xmlDoc.documentElement);
}

// Keep the existing functions but modify removeHiddenSlides
export function findMediaFiles(zip) {
  return Object.keys(zip.files)
    .filter(path => path.startsWith('ppt/media/') && !zip.files[path].dir);
}

export async function processMediaFile(zip, mediaPath, processor) {
  try {
    // 获取原始文件数据
    const fileData = await zip.file(mediaPath).async('uint8array');
    
    // 处理文件数据
    const processedData = await processor(fileData);
    
    // 更新文件
    if (processedData && processedData !== fileData) {
      zip.file(mediaPath, processedData);
    }
  } catch (error) {
    console.error(`Error processing ${mediaPath}:`, error);
    throw error;
  }
}

/**
 * 删除PPTX中的隐藏幻灯片
 * @param {JSZip} zip PPTX文件的JSZip对象
 * @returns {Promise<{removedSlides: number}>} 删除的幻灯片数量
 */
export async function removeHiddenSlides(zip) {
  try {
    // 读取presentation.xml文件
    const presentationXml = await zip.file('ppt/presentation.xml').async('text');
    const presentation = await parseXmlString(presentationXml);
    
    // Check if we have a slide list
    const p = presentation.p || presentation['p:presentation'];
    const sldIdLst = p && (p.sldIdLst || p['p:sldIdLst']);
    const sldId = sldIdLst && (sldIdLst.sldId || sldIdLst['p:sldId']);
    
    if (!sldId) {
      return { removedSlides: 0 };
    }
    
    // Get all slides
    const slides = Array.isArray(sldId) ? sldId : [sldId];
    const originalCount = slides.length;
    
    // Filter out hidden slides
    const visibleSlides = slides.filter(slide => {
      return !slide.$ || !slide.$.show || slide.$.show !== '0';
    });
    
    // If there are hidden slides, update presentation.xml
    if (visibleSlides.length < originalCount) {
      // Create a new XML document
      const xmlDoc = new DOMParser().parseFromString(presentationXml, 'text/xml');
      
      // Find and remove hidden slides
      const slideNodes = xmlDoc.querySelectorAll('p\\:sldId, sldId');
      for (const slideNode of slideNodes) {
        if (slideNode.getAttribute('show') === '0') {
          slideNode.parentNode.removeChild(slideNode);
        }
      }
      
      // Serialize back to XML
      const serializer = new XMLSerializer();
      const updatedXml = serializer.serializeToString(xmlDoc);
      
      // Update the file
      zip.file('ppt/presentation.xml', updatedXml);
      
      // Get the IDs of removed slides
      const removedSlideIds = slides
        .filter(slide => slide.$ && slide.$.show === '0')
        .map(slide => slide.$['r:id']);
      
      // Get slide paths from presentation.xml.rels
      const relsXml = await zip.file('ppt/_rels/presentation.xml.rels').async('text');
      const relsDoc = new DOMParser().parseFromString(relsXml, 'text/xml');
      
      // Find and remove the corresponding slide files
      const relationships = relsDoc.querySelectorAll('Relationship');
      for (const rel of relationships) {
        const id = rel.getAttribute('Id');
        if (removedSlideIds.includes(id)) {
          const target = rel.getAttribute('Target');
          const slidePath = 'ppt/' + target.replace('../', '');
          zip.remove(slidePath);
          
          // Remove related rels file
          const slideRelsPath = slidePath.replace('.xml', '.xml.rels').replace('slides/', 'slides/_rels/');
          if (zip.files[slideRelsPath]) {
            zip.remove(slideRelsPath);
          }
        }
      }
      
      return { removedSlides: originalCount - visibleSlides.length };
    }
    
    return { removedSlides: 0 };
  } catch (error) {
    console.error('Error removing hidden slides:', error);
    throw error;
  }
}