// 修改导入，使用浏览器原生的 XML 解析
// import { parseStringPromise, Builder } from 'xml2js';

/**
 * 删除未引用的Slide Layout和Slide Master
 * @param {JSZip} zip PPTX文件的JSZip对象
 * @param {Function} onProgress 进度回调函数
 * @returns {Promise<{removedLayoutsCount: number, removedMastersCount: number}>}
 */
export async function removeUnusedLayouts(zip, onProgress = () => {}) {
    try {
      onProgress('init', { percentage: 10, status: 'Analyzing presentation structure...' });
      
      // 1. 获取所有幻灯片关系文件
      const slideRelsFiles = Object.keys(zip.files).filter(file => 
        file.startsWith('ppt/slides/_rels/') && file.endsWith('.xml.rels')
      );
      
      // 2. 获取所有使用的布局文件路径
      const usedLayoutPaths = new Set();
      
      onProgress('init', { percentage: 20, status: 'Analyzing slide layout references...' });
      
      // 3. 解析每个幻灯片关系文件，获取使用的布局
      for (const relsFile of slideRelsFiles) {
        const relsXml = await zip.file(relsFile).async('text');
        const parser = new DOMParser();
        const relsDoc = parser.parseFromString(relsXml, 'text/xml');
        
        // 查找指向布局的关系
        const layoutRels = relsDoc.querySelectorAll('Relationship[Type*="slideLayout"]');
        for (const rel of layoutRels) {
          const target = rel.getAttribute('Target');
          if (target) {
            // 转换为完整路径
            const layoutPath = 'ppt/' + target.replace('../', '');
            usedLayoutPaths.add(layoutPath);
          }
        }
      }
      
      onProgress('init', { percentage: 40, status: 'Analyzing master and layout relationships...' });
      
      // 4. 获取所有布局文件
      const allLayoutFiles = Object.keys(zip.files).filter(file => 
        file.startsWith('ppt/slideLayouts/slideLayout') && file.endsWith('.xml')
      );
      
      // 5. 获取布局到母版的映射
      const layoutToMaster = new Map();
      const usedMasterPaths = new Set();
      
      // 6. 解析每个布局文件的关系，找出它们使用的母版
      for (const layoutFile of allLayoutFiles) {
        const relsFile = layoutFile.replace('.xml', '.xml.rels').replace('slideLayouts/', 'slideLayouts/_rels/');
        
        if (zip.files[relsFile]) {
          const relsXml = await zip.file(relsFile).async('text');
          const parser = new DOMParser();
          const relsDoc = parser.parseFromString(relsXml, 'text/xml');
          
          const masterRels = relsDoc.querySelectorAll('Relationship[Type*="slideMaster"]');
          for (const rel of masterRels) {
            const target = rel.getAttribute('Target');
            if (target) {
              const masterPath = 'ppt/' + target.replace('../', '');
              layoutToMaster.set(layoutFile, masterPath);
              
              // 如果这个布局被使用，那么它的母版也被使用
              if (usedLayoutPaths.has(layoutFile)) {
                usedMasterPaths.add(masterPath);
              }
            }
          }
        }
      }
      
      onProgress('init', { percentage: 60, status: 'Removing unused layouts...' });
      
      // 7. 删除未使用的布局
      let removedLayoutsCount = 0;
      for (const layoutFile of allLayoutFiles) {
        if (!usedLayoutPaths.has(layoutFile)) {
          // 删除布局文件
          zip.remove(layoutFile);
          
          // 删除关系文件
          const relsFile = layoutFile.replace('.xml', '.xml.rels').replace('slideLayouts/', 'slideLayouts/_rels/');
          if (zip.files[relsFile]) {
            zip.remove(relsFile);
          }
          
          removedLayoutsCount++;
        }
      }
      
      onProgress('init', { percentage: 80, status: 'Removing unused masters...' });
      
      // 8. 获取所有母版文件
      const allMasterFiles = Object.keys(zip.files).filter(file => 
        file.startsWith('ppt/slideMasters/slideMaster') && file.endsWith('.xml')
      );
      
      // 9. 删除未使用的母版
      let removedMastersCount = 0;
      for (const masterFile of allMasterFiles) {
        if (!usedMasterPaths.has(masterFile)) {
          // 删除母版文件
          zip.remove(masterFile);
          
          // 删除关系文件
          const relsFile = masterFile.replace('.xml', '.xml.rels').replace('slideMasters/', 'slideMasters/_rels/');
          if (zip.files[relsFile]) {
            zip.remove(relsFile);
          }
          
          removedMastersCount++;
        }
      }
      
      // 10. 更新presentation.xml.rels中的引用
      if (removedLayoutsCount > 0 || removedMastersCount > 0) {
        onProgress('init', { percentage: 90, status: 'Updating presentation structure...' });
        
        // 更新presentation.xml.rels
        const presentationRelsPath = 'ppt/_rels/presentation.xml.rels';
        if (zip.files[presentationRelsPath]) {
          const relsXml = await zip.file(presentationRelsPath).async('text');
          const parser = new DOMParser();
          const relsDoc = parser.parseFromString(relsXml, 'text/xml');
          
          // 删除指向已删除布局和母版的关系
          const relationships = relsDoc.querySelectorAll('Relationship');
          let modified = false;
          
          for (const rel of relationships) {
            const type = rel.getAttribute('Type');
            const target = rel.getAttribute('Target');
            
            if (target && (type.includes('slideLayout') || type.includes('slideMaster'))) {
              const fullPath = 'ppt/' + target.replace('../', '');
              
              // 如果这个布局或母版已被删除
              if ((type.includes('slideLayout') && !usedLayoutPaths.has(fullPath)) || 
                  (type.includes('slideMaster') && !usedMasterPaths.has(fullPath))) {
                rel.parentNode.removeChild(rel);
                modified = true;
              }
            }
          }
          
          // 如果有修改，更新文件
          if (modified) {
            const serializer = new XMLSerializer();
            const updatedXml = serializer.serializeToString(relsDoc);
            zip.file(presentationRelsPath, updatedXml);
          }
        }
      }
      
      onProgress('init', { percentage: 100, status: `Removed ${removedLayoutsCount} unused layouts and ${removedMastersCount} unused masters` });
      
      return {
        removedLayoutsCount,
        removedMastersCount
      };
    } catch (error) {
      console.error('Failed to remove unused layouts and masters:', error);
      throw error;
    }
  }