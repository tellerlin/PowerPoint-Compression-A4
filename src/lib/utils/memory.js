// 内存管理工具

/**
 * 监控内存使用情况
 * @param {Function} onWarning - 内存使用过高时的回调
 * @param {number} warningThreshold - 警告阈值(MB)
 * @returns {Function} 停止监控的函数
 */
export function monitorMemory(onWarning, warningThreshold = 1500) {
  if (typeof performance === 'undefined' || !performance.memory) {
    console.warn('Memory API not available in this browser');
    return () => {};
  }
  
  const intervalId = setInterval(() => {
    const memoryUsage = performance.memory.usedJSHeapSize / (1024 * 1024);
    if (memoryUsage > warningThreshold) {
      onWarning(memoryUsage);
    }
  }, 5000);
  
  return () => clearInterval(intervalId);
}

/**
 * 尝试释放内存
 */
export function attemptGarbageCollection() {
  // 尝试手动触发垃圾回收
  if (typeof window !== 'undefined') {
    if (window.gc) {
      try {
        window.gc();
        return true;
      } catch (e) {
        console.warn('Failed to trigger garbage collection:', e);
      }
    }
    
    // 如果gc不可用，尝试其他方法释放内存
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // 创建并释放大型对象以触发垃圾回收
        const largeArray = new Uint8Array(100 * 1024 * 1024);
        largeArray.fill(0);
        canvas.width = 1;
        canvas.height = 1;
        ctx.clearRect(0, 0, 1, 1);
      }
      return true;
    } catch (e) {
      console.warn('Failed to force memory cleanup:', e);
    }
  }
  return false;
}