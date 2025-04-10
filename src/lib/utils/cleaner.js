// 导入新的解析函数
import { parseXmlFromZip, parseXmlWithNamespacesFromZip } from './parser.js';

// ... 其他导入和代码 ...

/**
 * 获取使用的幻灯片
 * @param {JSZip} zip - JSZip实例
 * @returns {Promise<Array>} - 使用的幻灯片数组
 */
async function getUsedSlides(zip) {
  try {
    // 使用新的解析函数
    const presentationData = await parseXmlWithNamespacesFromZip(zip, 'ppt/presentation.xml');
    
    // 检查数据结构
    if (!presentationData || !presentationData['p:presentation'] || 
        !presentationData['p:presentation']['p:sldIdLst'] || 
        !presentationData['p:presentation']['p:sldIdLst']['p:sldId']) {
      console.warn('找不到幻灯片列表');
      return [];
    }
    
    // 获取幻灯片ID列表
    const slideIds = presentationData['p:presentation']['p:sldIdLst']['p:sldId'];
    const slides = Array.isArray(slideIds) ? slideIds : [slideIds];
    
    return slides.map(slide => {
      return {
        id: slide['@_id'],
        rId: slide['@_r:id'],
        path: `ppt/slides/slide${slide['@_id']}.xml`
      };
    });
  } catch (error) {
    console.error('获取使用的幻灯片时出错:', error);
    throw error;
  }
}

// ... 其他函数和代码 ...