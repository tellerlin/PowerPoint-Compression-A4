import { getLayoutMaster, updatePresentationReferences, updateContentTypes } from './lib/pptx/layout-cleaner.js';
import { getAllSlides, getSlideLayout } from './lib/pptx/layout-cleaner.js';

export async function removeUnusedLayouts(zip, onProgress = () => {}) {
  try {
    const slides = await getAllSlides(zip);
    const usedLayouts = new Set();
    const usedMasters = new Set();
    
    // 只保留幻灯片直接使用的布局
    for (const slide of slides) {
      const layoutInfo = await getSlideLayout(zip, slide);
      if (layoutInfo) {
        usedLayouts.add(layoutInfo.path);
      }
    }
    
    // 获取所有使用的母版
    for (const layoutPath of usedLayouts) {
      const masterInfo = await getLayoutMaster(zip, layoutPath);
      if (masterInfo) {
        usedMasters.add(masterInfo.path);
      }
    }

    // 获取所有布局文件
    const allLayoutFiles = Object.keys(zip.files)
      .filter(path => path.startsWith('ppt/slideLayouts/') && 
              path.endsWith('.xml') && 
              !path.includes('_rels'));

    // 删除未使用的布局
    const unusedLayouts = allLayoutFiles.filter(path => !usedLayouts.has(path));
    for (const layoutPath of unusedLayouts) {
      zip.remove(layoutPath);
      
      // 删除相关的关系文件
      const layoutRelsPath = layoutPath.replace('slideLayouts/', 'slideLayouts/_rels/') + '.rels';
      if (zip.file(layoutRelsPath)) {
        zip.remove(layoutRelsPath);
      }
    }

    // 更新所有相关引用
    await updatePresentationReferences(zip, usedLayouts, usedMasters);
    await updateContentTypes(zip);
    
    return true;
  } catch (error) {
    console.error('Error removing unused layouts:', error);
    return false;
  }
}