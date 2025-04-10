async function removeUnusedMedia(zip, usedMedia) {
  try {
    const mediaFiles = findMediaFiles(zip);
    console.log(`Total media files: ${mediaFiles.length}`);
    console.log(`Used media files: ${usedMedia.size}`);

    // 更严格的验证
    for (const mediaPath of usedMedia) {
      if (!zip.file(mediaPath)) {
        console.warn(`Referenced media file does not exist: ${mediaPath}`);
        usedMedia.delete(mediaPath); // 删除无效引用
      }
    }

    const unusedMedia = mediaFiles.filter(path => !usedMedia.has(path));
    console.log(`Found ${unusedMedia.length} unused media files to remove`);

    // 安全检查
    if (unusedMedia.length > 0 && unusedMedia.length === mediaFiles.length) {
      console.warn('Skipping removal - attempting to remove all media files');
      return;
    }

    // 删除未使用的媒体文件
    for (const mediaPath of unusedMedia) {
      console.log(`Removing unused media: ${mediaPath}`);
      zip.remove(mediaPath);
      
      // 同时删除相关的关系文件
      const mediaRelsPath = mediaPath.replace('media/', 'media/_rels/') + '.rels';
      if (zip.file(mediaRelsPath)) {
        zip.remove(mediaRelsPath);
      }
    }

    // 更新内容类型
    await updateContentTypes(zip);
  } catch (error) {
    console.error('Error removing unused media:', error);
  }
}


async function cleanRelationshipFiles(zip) {
  try {
    const relsFiles = Object.keys(zip.files)
      .filter(path => path.includes('_rels/') && path.endsWith('.rels'));

    console.log(`Processing ${relsFiles.length} relationship files...`);

    for (const relsPath of relsFiles) {
      try {
        const relsXml = await zip.file(relsPath)?.async('string');
        if (!relsXml) {
          console.log(`Skipping empty relationship file: ${relsPath}`);
          continue;
        }

        console.log(`Processing relationship file: ${relsPath}`);
        
        const relsObj = await parseXmlSafely(relsXml);
        if (!relsObj) {
          console.warn(`Failed to parse relationship file: ${relsPath}`);
          continue;
        }
        
        // 使用findNestedProperty查找Relationships.Relationship
        const relationshipsNode = findNestedProperty(relsObj, 'Relationships.Relationship');
        if (!relationshipsNode) {
          console.log(`No relationships found in ${relsPath}`);
          continue;
        }

        const relationships = Array.isArray(relationshipsNode)
          ? relationshipsNode
          : [relationshipsNode];

        // 过滤无效引用
        const validRels = relationships.filter(rel => {
          try {
            const target = getXmlAttribute(rel, 'Target');
            if (!target) {
              console.log('Invalid relationship: missing target');
              return false;
            }

            const targetPath = `ppt/${target.replace('../', '')}`;
            const exists = zip.file(targetPath) !== null;
            if (!exists) {
              console.log(`Invalid relationship: target file does not exist: ${targetPath}`);
            }
            return exists;
          } catch (err) {
            console.warn(`Error processing relationship in ${relsPath}:`, err.message);
            return false;
          }
        });

        if (validRels.length < relationships.length) {
          console.log(`Removing ${relationships.length - validRels.length} invalid relationships from ${relsPath}`);
          
          // 找到正确的路径来设置关系
          if (relsObj.Relationships && relsObj.Relationships.Relationship) {
            relsObj.Relationships.Relationship = validRels;
          } else if (findNestedProperty(relsObj, 'Relationships')) {
            const relNode = findNestedProperty(relsObj, 'Relationships');
            relNode.Relationship = validRels;
          }
          
          const updatedRelsXml = buildXml(relsObj);
          zip.file(relsPath, updatedRelsXml);
        }
      } catch (fileError) {
        console.error(`Error processing relationship file ${relsPath}:`, fileError);
        console.error('Error details:', {
          path: relsPath,
          error: fileError.message,
          stack: fileError.stack
        });
        // 继续处理下一个文件
        continue;
      }
    }
  } catch (error) {
    console.error('Error cleaning relationship files:', error);
    console.error('Error details:', {
      error: error.message,
      stack: error.stack
    });
  }
}


export async function cleanUnusedResources(zip, onProgress = () => {}) {
  try {
    console.log('Starting enhanced resource cleanup...');
    
    // 1. 清理未使用的布局和母版
    await removeUnusedLayouts(zip, onProgress);
    
    // 2. 清理未使用的媒体文件
    const usedMedia = await collectUsedMedia(zip);
    await removeUnusedMedia(zip, usedMedia);
    
    // 3. 清理关系文件
    await cleanRelationshipFiles(zip);
    
    // 4. 最终更新内容类型
    await updateContentTypes(zip);
    
    return true;
  } catch (error) {
    console.error('Error in resource cleanup:', error);
    return false;
  }
}

// 添加一个辅助函数来安全地获取属性值
// 优化 getXmlAttribute 函数
function getXmlAttribute(element, attributeName) {
  try {
    if (!element) return null;
    if (typeof element !== 'object') return null;

    // 检查所有可能的属性格式
    const possibleKeys = [
      attributeName,
      `_${attributeName}`,
      `@${attributeName}`,
      `@_${attributeName}`,
      `$${attributeName}`,
      `r:${attributeName}`,
      `p:${attributeName}`,
      `a:${attributeName}`,
      `ct:${attributeName}`,
      `o:${attributeName}`,
      `w:${attributeName}`,
      `m:${attributeName}`,
      attributeName.toLowerCase(),
      attributeName.toUpperCase(),
      `_${attributeName.toLowerCase()}`,
      `_${attributeName.toUpperCase()}`,
      `@${attributeName.toLowerCase()}`,
      `@${attributeName.toUpperCase()}`,
      `http://schemas.openxmlformats.org/officeDocument/2006/relationships:${attributeName}`,
      `http://schemas.openxmlformats.org/package/2006/relationships:${attributeName}`,
      `http://schemas.openxmlformats.org/presentationml/2006/main:${attributeName}`,
      `http://schemas.openxmlformats.org/drawingml/2006/main:${attributeName}`,
      `http://schemas.openxmlformats.org/package/2006/content-types:${attributeName}`
    ];

    // 检查元素本身
    for (const key of possibleKeys) {
      if (element[key] !== undefined && element[key] !== null) return element[key];
    }

    // 检查元素的 $ 对象
    if (element.$ && typeof element.$ === 'object') {
      for (const key of possibleKeys) {
        if (element.$[key] !== undefined && element.$[key] !== null) return element.$[key];
      }
    }

    // 检查元素的 attributes 对象
    if (element.attributes && typeof element.attributes === 'object') {
      for (const key of possibleKeys) {
        if (element.attributes[key] !== undefined && element.attributes[key] !== null) return element.attributes[key];
      }
    }

    // 检查元素的 _attributes 对象
    if (element._attributes && typeof element._attributes === 'object') {
      for (const key of possibleKeys) {
        if (element._attributes[key] !== undefined && element._attributes[key] !== null) return element._attributes[key];
      }
    }
    
    // 检查元素的 attrs 对象
    if (element.attrs && typeof element.attrs === 'object') {
      for (const key of possibleKeys) {
        if (element.attrs[key] !== undefined && element.attrs[key] !== null) return element.attrs[key];
      }
    }
    
    // 检查元素的 attr 对象
    if (element.attr && typeof element.attr === 'object') {
      for (const key of possibleKeys) {
        if (element.attr[key] !== undefined && element.attr[key] !== null) return element.attr[key];
      }
    }
    
    // 检查元素的 _attr 对象
    if (element._attr && typeof element._attr === 'object') {
      for (const key of possibleKeys) {
        if (element._attr[key] !== undefined && element._attr[key] !== null) return element._attr[key];
      }
    }
    
    // 尝试直接访问属性名的小写版本
    const lowerCaseAttr = attributeName.toLowerCase();
    if (element[lowerCaseAttr] !== undefined && element[lowerCaseAttr] !== null) {
      return element[lowerCaseAttr];
    }
    
    // 尝试直接访问属性名的大写版本
    const upperCaseAttr = attributeName.toUpperCase();
    if (element[upperCaseAttr] !== undefined && element[upperCaseAttr] !== null) {
      return element[upperCaseAttr];
    }

    return null;
  } catch (error) {
    console.warn(`Error getting XML attribute ${attributeName}:`, error.message);
    return null;
  }
}

// 修改 getUsedSlides 函数
async function getUsedSlides(zip) {
  try {
    // 首先尝试从presentation.xml获取幻灯片列表
    const presentationXml = await zip.file('ppt/presentation.xml')?.async('string');
    if (presentationXml) {
      const presentationObj = await parseXmlSafely(presentationXml);
      if (presentationObj) {
        // 尝试多种可能的路径获取幻灯片列表
        let slideIds = null;
        
        // 尝试直接路径
        if (presentationObj['p:presentation']?.['p:sldIdLst']?.['p:sldId']) {
          slideIds = presentationObj['p:presentation']['p:sldIdLst']['p:sldId'];
        }
        
        // 尝试使用findNestedProperty
        if (!slideIds) {
          const possiblePaths = [
            'p:presentation.p:sldIdLst.p:sldId',
            'presentation.sldIdLst.sldId',
            'Presentation.SlideIdList.SlideId',
            'Presentation.SldIdLst.SldId'
          ];
          
          for (const path of possiblePaths) {
            const found = findNestedProperty(presentationObj, path);
            if (found) {
              slideIds = found;
              break;
            }
          }
        }
        
        if (slideIds) {
          const slides = Array.isArray(slideIds) ? slideIds : [slideIds];
          
          const result = slides.map(slide => {
            const id = getXmlAttribute(slide, 'id');
            const rId = getXmlAttribute(slide, 'r:id') || getXmlAttribute(slide, 'id');
            
            if (!id) {
              console.warn('Slide missing id attribute');
              return null;
            }
            
            return {
              id,
              rId: rId || id, // 如果没有r:id，使用id作为备用
              path: `ppt/slides/slide${id}.xml`
            };
          }).filter(Boolean);
          
          if (result.length > 0) {
            console.log(`Found ${result.length} slides from presentation.xml`);
            return result;
          }
        }
      }
    }

    console.log('Falling back to relationships file to find slides');
    // 如果从presentation.xml获取失败，尝试从relationships文件获取
    const relsPath = 'ppt/_rels/presentation.xml.rels';
    const relsXml = await zip.file(relsPath)?.async('string');
    if (!relsXml) {
      console.error('Neither presentation.xml nor relationships file found');
      return [];
    }
    
    const relsObj = await parseXmlSafely(relsXml);
    if (!relsObj) {
      console.error('Failed to parse presentation relationships');
      return [];
    }

    // 尝试多种可能的路径获取关系列表
    let relationships = null;
    
    // 直接尝试获取
    if (relsObj.Relationships && relsObj.Relationships.Relationship) {
      relationships = relsObj.Relationships.Relationship;
    }
    
    // 使用findNestedProperty
    if (!relationships) {
      relationships = findNestedProperty(relsObj, 'Relationships.Relationship');
    }
    
    if (!relationships) {
      console.error('No relationships found in presentation.xml.rels');
      return [];
    }
    
    const relsArray = Array.isArray(relationships) ? relationships : [relationships];

    return relsArray
      .filter(rel => {
        try {
          const relType = getXmlAttribute(rel, 'Type');
          // 检查Type是否包含slide字符串，不区分大小写
          return relType && typeof relType === 'string' && 
                (relType.toLowerCase().includes('/slide') || 
                 relType.toLowerCase().includes('slide'));
        } catch (err) {
          console.warn('Error filtering relationship:', err.message);
          return false;
        }
      })
      .map(rel => {
        try {
          const rId = getXmlAttribute(rel, 'Id');
          const target = getXmlAttribute(rel, 'Target');
          if (!rId || !target) {
            console.warn('Invalid relationship attributes:', {rId, target});
            return null;
          }
          const slideNumber = target.match(/slide(\d+)\.xml/)?.[1];
          return slideNumber ? {
            id: slideNumber,
            rId,
            path: `ppt/${target.replace('../', '')}`
          } : null;
        } catch (err) {
          console.warn('Error mapping relationship:', err.message);
          return null;
        }
      })
      .filter(Boolean);
  } catch (error) {
    console.error('Error getting used slides:', error);
    return [];
  }
}

// 添加辅助函数来深度查找嵌套属性
function findNestedProperty(obj, path) {
  return path.split('.').reduce((o, p) => 
    (o && o[p] !== undefined) ? o[p] : undefined, obj);
}

// 优化 XML 解析函数
async function parseXmlSafely(xmlString) {
  try {
    // 首先尝试使用带命名空间的解析
    const result = await parseXmlWithNamespaces(xmlString);
    if (result) return result;

    // 如果失败，尝试使用基本解析
    return await parseXml(xmlString);
  } catch (error) {
    console.error('XML parsing error:', error);
    return null;
  }
}

// 优化关系文件处理
async function processRelationshipFiles(zip, usedLayouts, usedMasters, usedSlides, usedMedia) {
  try {
    const relsFiles = Object.keys(zip.files)
      .filter(path => path.includes('_rels/') && path.endsWith('.rels'));
    
    console.log(`Processing ${relsFiles.length} relationship files...`);
    
    for (const relsPath of relsFiles) {
      try {
        const relsXml = await zip.file(relsPath)?.async('string');
        if (!relsXml) {
          console.log(`Skipping empty relationship file: ${relsPath}`);
          continue;
        }
        
        console.log(`Processing relationship file: ${relsPath}`);
        
        const relsObj = await parseXmlSafely(relsXml);
        if (!relsObj) {
          console.warn(`Failed to parse relationship file: ${relsPath}`);
          continue;
        }
        
        const relationships = findNestedProperty(relsObj, 'Relationships.Relationship') || [];
        const relsArray = Array.isArray(relationships) ? relationships : [relationships];
        
        if (relsArray.length === 0) {
          console.log(`No relationships found in ${relsPath}`);
          continue;
        }
        
        let validRelationships = 0;
        for (const rel of relsArray) {
          const relType = getXmlAttribute(rel, 'Type');
          const target = getXmlAttribute(rel, 'Target');
          const rId = getXmlAttribute(rel, 'Id');
          
          if (!relType || !target || !rId) {
            console.warn('Invalid relationship:', { relType, target, rId });
            continue;
          }
          
          // 验证目标文件是否存在
          const targetPath = `ppt/${target.replace('../', '')}`;
          const targetExists = zip.file(targetPath) !== null;
          
          if (!targetExists) {
            console.warn(`Referenced file does not exist: ${targetPath}`);
            continue;
          }
          
          // 检查并记录媒体引用
          if (relType.includes('/image') || 
              relType.includes('/audio') || 
              relType.includes('/video')) {
            usedMedia.add(targetPath);
            console.log(`Found valid media reference: ${targetPath}`);
          }
          
          validRelationships++;
        }
        
        console.log(`Found ${validRelationships} valid relationships in ${relsPath}`);
      } catch (error) {
        console.error(`Error processing ${relsPath}:`, error);
        console.error('Error details:', {
          path: relsPath,
          error: error.message,
          stack: error.stack
        });
      }
    }
  } catch (error) {
    console.error('Error processing relationship files:', error);
    throw error; // 向上传播错误以便调用者处理
  }
}

// 优化内容类型更新
async function updateContentTypes(zip) {
  try {
    const contentTypesXml = await zip.file('[Content_Types].xml')?.async('string');
    if (!contentTypesXml) {
      console.warn('Content types file not found');
      return;
    }
    
    console.log('Parsing content types XML...');
    const contentTypesObj = await parseXmlSafely(contentTypesXml);
    if (!contentTypesObj) {
      console.error('Failed to parse content types XML');
      return;
    }
    
    // 获取Types节点，支持多种可能的属性路径
    let types = null;
    const possibleTypesKeys = ['Types', 'ct:Types', 'types', 'TYPES'];
    
    // 尝试直接访问
    for (const key of possibleTypesKeys) {
      if (contentTypesObj[key]) {
        types = contentTypesObj[key];
        break;
      }
    }
    
    // 如果直接访问失败，尝试使用findNestedProperty
    if (!types) {
      for (const key of possibleTypesKeys) {
        const found = findNestedProperty(contentTypesObj, key);
        if (found) {
          types = found;
          break;
        }
      }
    }
    
    if (!types) {
      console.error('Invalid content types structure: missing Types node');
      return;
    }
    
    // 处理Default节点
    const possibleDefaultKeys = ['Default', 'ct:Default', 'default', 'DEFAULT'];
    let defaultNode = null;
    
    // 尝试找到Default节点
    for (const key of possibleDefaultKeys) {
      if (types[key]) {
        defaultNode = types[key];
        break;
      }
    }
    
    if (defaultNode) {
      const defaults = Array.isArray(defaultNode) ? defaultNode : [defaultNode];
      const validDefaults = defaults.filter(def => {
        try {
          const extension = getXmlAttribute(def, 'Extension');
          const contentType = getXmlAttribute(def, 'ContentType');
          if (!extension || !contentType) {
            console.warn('Invalid default content type:', { extension, contentType });
            return false;
          }
          return true;
        } catch (err) {
          console.warn('Error processing default content type:', err.message);
          return false;
        }
      });
      
      // 找到正确的键来设置Default
      for (const key of possibleDefaultKeys) {
        if (types[key]) {
          types[key] = validDefaults;
          break;
        }
      }
    }
    
    // 处理Override节点
    const possibleOverrideKeys = ['Override', 'ct:Override', 'override', 'OVERRIDE'];
    let overrideNode = null;
    let overrideKey = null;
    
    // 尝试找到Override节点
    for (const key of possibleOverrideKeys) {
      if (types[key]) {
        overrideNode = types[key];
        overrideKey = key;
        break;
      }
    }
    
    if (overrideNode) {
      const overrides = Array.isArray(overrideNode) ? overrideNode : [overrideNode];
      console.log(`Processing ${overrides.length} content type overrides`);
      
      const filteredOverrides = overrides.filter(override => {
        try {
          // 尝试多种方式获取PartName和ContentType
          let partName = null;
          let contentType = null;
          
          // 尝试使用getXmlAttribute
          partName = getXmlAttribute(override, 'PartName');
          contentType = getXmlAttribute(override, 'ContentType');
          
          // 如果失败，尝试直接访问各种可能的属性名
          if (!partName) {
            const possiblePartNameKeys = ['PartName', 'partName', 'partname', '@_PartName', '_PartName', '@PartName'];
            for (const key of possiblePartNameKeys) {
              if (override[key]) {
                partName = override[key];
                break;
              }
              // 检查嵌套对象
              if (override.$ && override.$[key]) {
                partName = override.$[key];
                break;
              }
              if (override._attributes && override._attributes[key]) {
                partName = override._attributes[key];
                break;
              }
            }
          }
          
          if (!contentType) {
            const possibleContentTypeKeys = ['ContentType', 'contentType', 'contenttype', '@_ContentType', '_ContentType', '@ContentType'];
            for (const key of possibleContentTypeKeys) {
              if (override[key]) {
                contentType = override[key];
                break;
              }
              // 检查嵌套对象
              if (override.$ && override.$[key]) {
                contentType = override.$[key];
                break;
              }
              if (override._attributes && override._attributes[key]) {
                contentType = override._attributes[key];
                break;
              }
            }
          }
          
          if (!partName || !contentType) {
            console.warn('Invalid override:', { partName, contentType });
            return false;
          }
          
          const filePath = partName.replace(/^\//, '');
          const exists = zip.file(filePath) !== null;
          
          if (!exists) {
            console.log(`Removing reference to non-existent file: ${filePath}`);
            return false;
          }
          
          return true;
        } catch (err) {
          console.warn('Error processing content type override:', err.message);
          return false;
        }
      });
      
      if (filteredOverrides.length < overrides.length) {
        types[overrideKey] = filteredOverrides;
        console.log(`Removed ${overrides.length - filteredOverrides.length} invalid content type overrides`);
        
        const updatedContentTypesXml = buildXml(contentTypesObj);
        zip.file('[Content_Types].xml', updatedContentTypesXml);
      }
    }
  } catch (error) {
    console.error('Error updating content types:', error);
    console.error('Error details:', {
      error: error.message,
      stack: error.stack
    });
    // 捕获错误但不抛出，允许程序继续运行
    // 只记录错误，不向上传播
  }
}