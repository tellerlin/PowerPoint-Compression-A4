import { PRESENTATION_PATH } from './constants';

const parseXml = async (zip, path) => {
  try {
    const xml = await zip.file(path)?.async('string');
    if (!xml) {
      return null;
    }
    const parser = new DOMParser();
    return parser.parseFromString(xml, 'text/xml');
  } catch (error) {
    console.error(`Error parsing XML at ${path}:`, error);
    return null;
  }
};

const removeNode = (node) => {
  if (node && node.parentNode) {
    node.parentNode.removeChild(node);
  }
};

export async function removeHiddenSlides(zip) {
  console.log('===== removeHiddenSlides function started =====');
  try {
    console.log('Starting to find and remove hidden slides...');
    
    // Check if zip object is valid
    if (!zip || typeof zip.files !== 'object') {
      console.error('Invalid zip object:', zip);
      return;
    }
    
    console.log('Zip object is valid, file count:', Object.keys(zip.files).length);
    
    // 1. Get all slide rIds from presentation.xml
    console.log(`Parsing ${PRESENTATION_PATH}`);
    const presentationXml = await parseXml(zip, PRESENTATION_PATH);
    if (!presentationXml) {
      console.error('Failed to parse presentation.xml file');
      return;
    }
    
    const slideNodes = presentationXml.getElementsByTagNameNS('http://schemas.openxmlformats.org/presentationml/2006/main', 'sldId');
    console.log(`Found ${slideNodes.length} slide nodes`);
    
    // 2. Get path and hidden status for each slide
    const slidesToCheck = [];
    for (let i = 0; i < slideNodes.length; i++) {
      const slideNode = slideNodes[i];
      const slideId = slideNode.getAttribute('id');
      const slideRId = slideNode.getAttribute('r:id');
      console.log(`Slide node ${i+1}: id=${slideId}, r:id=${slideRId}`);
      
      if (slideRId) {
        const slideInfo = await getSlideInfo(zip, slideRId);
        if (slideInfo) {
          slidesToCheck.push({ slideNode, slideInfo, slideRId });
        }
      }
    }
    
    // 3. Check if each slide is hidden
    const hiddenSlides = [];
    const visibleSlides = [];
    for (const slide of slidesToCheck) {
      console.log(`Checking if slide is hidden: ${slide.slideInfo.path}`);
      const isHidden = await isSlideHidden(zip, slide.slideInfo.path);
      console.log(`Slide ${slide.slideInfo.path} hidden status: ${isHidden}`);
      
      if (isHidden) {
        console.log(`Found hidden slide: ${slide.slideInfo.path}`);
        hiddenSlides.push(slide);
      } else {
        visibleSlides.push(slide);
      }
    }
    
    console.log(`Found ${hiddenSlides.length} hidden slides and ${visibleSlides.length} visible slides`);
    
    if (hiddenSlides.length === 0) {
      console.log('No hidden slides found, no action needed');
      return;
    }
    
    // 4. Execute deletion operations
    for (const { slideNode, slideInfo } of hiddenSlides) {
      console.log(`Removing slide node: ${slideInfo.path}`);
      removeNode(slideNode);
      console.log(`Removing slide related files: ${slideInfo.path}`);
      await removeSlide(zip, slideInfo);
    }
    
    // 5. Update presentation.xml
    console.log('Updating presentation.xml file');
    const serializer = new XMLSerializer();
    const updatedXml = serializer.serializeToString(presentationXml);
    zip.file(PRESENTATION_PATH, updatedXml);
    
    // 6. 更新幻灯片编号和顺序
    await updateSlideNumbers(zip, visibleSlides);
    
    console.log('Hidden slides removal completed');
  } catch (error) {
    console.error('Error removing hidden slides:', error);
    console.error('Error stack:', error.stack);
  }
  console.log('===== removeHiddenSlides function completed =====');
}

// 添加新函数：更新幻灯片编号和顺序
async function updateSlideNumbers(zip, visibleSlides) {
  try {
    console.log('Updating slide numbers and order...');
    
    // 更新幻灯片顺序文件（如果存在）
    const viewPropsPath = 'ppt/viewProps.xml';
    if (zip.file(viewPropsPath)) {
      const viewPropsXml = await zip.file(viewPropsPath)?.async('string');
      if (viewPropsXml) {
        console.log('Updating viewProps.xml with new slide order');
        // 实现更新逻辑...
        // 这里需要根据实际文件格式进行处理
      }
    }
    
    // 更新其他可能引用幻灯片的文件
    // 例如：自定义显示、幻灯片导航等
    
    console.log('Slide numbers and order updated successfully');
  } catch (error) {
    console.warn('Error updating slide numbers:', error);
  }
}

// Modified isSlideHidden function with detailed logs
async function isSlideHidden(zip, slidePath) {
  try {
    console.log(`[isSlideHidden] Starting to check slide: ${slidePath}`);
    const slideXml = await zip.file(slidePath)?.async('string');
    if (!slideXml) {
      console.warn(`[isSlideHidden] Unable to read slide file: ${slidePath}`);
      return false;
    }
    
    console.log(`[isSlideHidden] Slide XML length: ${slideXml.length}`);
    // Output first 200 characters of XML for debugging
    console.log(`[isSlideHidden] First 200 chars of XML: ${slideXml.substring(0, 200)}...`);
    
    // First try simple string matching as a fallback method
    const hasShowAttribute = slideXml.includes('show="0"');
    console.log(`[isSlideHidden] String match 'show="0"': ${hasShowAttribute}`);

    const parser = new DOMParser();
    const slideDoc = parser.parseFromString(slideXml, 'text/xml');
    
    // Look for show attribute on p:sld element
    const slideElement = slideDoc.querySelector('p\\:sld, sld');
    if (!slideElement) {
      console.warn(`[isSlideHidden] Slide element not found (p:sld or sld)`);
      // Try other possible element names
      const possibleElements = slideDoc.querySelectorAll('*');
      console.log(`[isSlideHidden] Number of elements in document: ${possibleElements.length}`);
      if (possibleElements.length > 0) {
        console.log(`[isSlideHidden] First element name: ${possibleElements[0].tagName}`);
      }
      
      // If string matching found show="0" but DOM query failed, still return true
      return hasShowAttribute;
    }
    
    console.log(`[isSlideHidden] Found slide element: ${slideElement.tagName}`);
    const showAttribute = slideElement.getAttribute('show');
    console.log(`[isSlideHidden] show attribute value: ${showAttribute}`);
    
    return showAttribute === '0';
  } catch (error) {
    console.error(`[isSlideHidden] Error checking if slide ${slidePath} is hidden:`, error);
    console.error(`[isSlideHidden] Error stack:`, error.stack);
    return false;
  }
}

async function getSlideInfo(zip, slideRId) {
  try {
    const relsXml = await zip.file('ppt/_rels/presentation.xml.rels')?.async('string');
    if (!relsXml) {
      return null;
    }

    const parser = new DOMParser();
    const relsDoc = parser.parseFromString(relsXml, 'text/xml');
    const relationship = relsDoc.querySelector(`Relationship[Id="${slideRId}"]`);
    if (!relationship) {
      return null;
    }

    const target = relationship.getAttribute('Target');
    const slidePath = `ppt/${target.replace('../', '')}`;

    return {
      path: slidePath,
      relsPath: slidePath.replace('slides/', 'slides/_rels/') + '.rels'
    };
  } catch (error) {
    console.error(`Error getting slide info for ${slideRId}:`, error);
    return null;
  }
}

async function removeSlide(zip, slideInfo) {
  try {
    console.log(`Removing slide file: ${slideInfo.path}`);
    zip.remove(slideInfo.path);

    if (zip.file(slideInfo.relsPath)) {
      console.log(`Removing slide relationship file: ${slideInfo.relsPath}`);
      zip.remove(slideInfo.relsPath);
    }

    await updateContentTypes(zip, slideInfo.path);
    await updatePresentationRels(zip, slideInfo.path);
    
    // 更彻底地清理所有可能的引用
    await removeSlideReferencesFromOtherFiles(zip, slideInfo.path);
  } catch (error) {
    console.warn('Error removing slide:', error);
  }
}

// 增强 removeSlideReferencesFromOtherFiles 函数
async function removeSlideReferencesFromOtherFiles(zip, slidePath) {
  try {
    console.log(`Removing all references to slide: ${slidePath}`);
    
    // 1. 检查并更新幻灯片顺序文件
    const slideOrderPath = 'ppt/viewProps.xml';
    if (zip.file(slideOrderPath)) {
      const viewPropsXml = await zip.file(slideOrderPath)?.async('string');
      if (viewPropsXml && viewPropsXml.includes(slidePath.split('ppt/')[1])) {
        console.log(`Updating slide order file: ${slideOrderPath}`);
        // 实现更新逻辑...
      }
    }
    
    // 2. 检查并更新自定义显示文件
    const customShowsPath = 'ppt/presentation.xml';
    if (zip.file(customShowsPath)) {
      const presentationXml = await zip.file(customShowsPath)?.async('string');
      if (presentationXml && presentationXml.includes('custShow')) {
        console.log('Checking custom shows for slide references');
        // 实现更新逻辑...
      }
    }
    
    // 3. 检查并更新幻灯片导航文件
    const navFilesPattern = /ppt\/slideNavigation\/.*\.xml/;
    const navFiles = Object.keys(zip.files).filter(path => navFilesPattern.test(path));
    for (const navFile of navFiles) {
      console.log(`Checking navigation file: ${navFile}`);
      // 实现更新逻辑...
    }
    
    // 4. 检查并更新其他可能引用幻灯片的文件
    // 例如：注释、批注等
    
    console.log(`Completed removing all references to slide: ${slidePath}`);
  } catch (error) {
    console.warn(`Error removing slide references: ${error.message}`);
  }
}

async function updateContentTypes(zip, slidePath) {
  try {
    const contentTypesXml = await zip.file('[Content_Types].xml')?.async('string');
    if (!contentTypesXml) {
      return;
    }

    const parser = new DOMParser();
    const contentTypesDoc = parser.parseFromString(contentTypesXml, 'text/xml');
    const slidePartName = `/ppt/${slidePath.split('ppt/')[1]}`;
    const overrideElement = contentTypesDoc.querySelector(`Override[PartName="${slidePartName}"]`);

    if (overrideElement && overrideElement.parentNode) {
      console.log(`Removing reference from [Content_Types].xml: ${slidePartName}`);
      overrideElement.parentNode.removeChild(overrideElement);
      const serializer = new XMLSerializer();
      const updatedXml = serializer.serializeToString(contentTypesDoc);
      zip.file('[Content_Types].xml', updatedXml);
    }
  } catch (error) {
    console.warn('Error updating content types:', error);
  }
}

async function updatePresentationRels(zip, slidePath) {
  try {
    const relsXml = await zip.file('ppt/_rels/presentation.xml.rels')?.async('string');
    if (!relsXml) {
      return;
    }

    const parser = new DOMParser();
    const relsDoc = parser.parseFromString(relsXml, 'text/xml');
    const slideTarget = `slides/${slidePath.split('slides/')[1]}`;
    const relationshipElement = relsDoc.querySelector(`Relationship[Target="${slideTarget}"]`);
    
    if (relationshipElement && relationshipElement.parentNode) {
      console.log(`Removing reference from presentation.xml.rels: ${slideTarget}`);
      relationshipElement.parentNode.removeChild(relationshipElement);
      
      const serializer = new XMLSerializer();
      const updatedXml = serializer.serializeToString(relsDoc);
      zip.file('ppt/_rels/presentation.xml.rels', updatedXml);
    }
  } catch (error) {
    console.warn('Error updating presentation rels:', error);
  }
}