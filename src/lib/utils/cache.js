// 增强缓存管理器

export class CacheManager {
  constructor(options = {}) {
    this.caches = {};
    // 增强浏览器兼容性检查
    const hasDeviceMemory = typeof navigator !== 'undefined' && 
                           'deviceMemory' in navigator && 
                           typeof navigator.deviceMemory === 'number';
    
    // 根据设备内存动态调整缓存大小
    if (hasDeviceMemory) {
      const deviceMemory = navigator.deviceMemory;
      this.maxSize = Math.min(
        Math.max(50 * 1024 * 1024, Math.floor(deviceMemory * 0.2 * 1024 * 1024 * 1024)),
        500 * 1024 * 1024 // 最大500MB
      );
    } else {
      this.maxSize = options.maxSize || 100 * 1024 * 1024;
    }
    
    this.currentSize = 0;
    this.hits = 0;
    this.misses = 0;
    this.lastCleanup = Date.now();
    this.cleanupInterval = 60000; // 1分钟清理一次
  }
  
  // 添加内存压力检测
  checkMemoryPressure() {
    if (typeof performance !== 'undefined' && performance.memory) {
      const memoryPressure = performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit;
      return memoryPressure > 0.8;
    }
    return false;
  }
  
  // 增强的缓存清理
  cleanup() {
    const now = Date.now();
    if (now - this.lastCleanup < this.cleanupInterval) {
      return;
    }
    
    this.lastCleanup = now;
    
    // 检查内存压力
    if (this.checkMemoryPressure()) {
      console.warn('[CacheManager] High memory pressure detected, performing aggressive cleanup');
      this.clear();
      return;
    }
    
    // 常规清理
    if (this.currentSize > this.maxSize * 0.8) {
      console.log('[CacheManager] Cache size near limit, cleaning up old entries');
      this.evictOldest();
    }
  }
  
  getCache(name, subspace = '') {
    const fullName = subspace ? `${name}:${subspace}` : name;
    if (!this.caches[fullName]) {
      this.caches[fullName] = new Map();
    }
    return this.caches[fullName];
  }
  
  set(cacheName, key, value, size, subspace = '') {
    this.cleanup();
    
    const cache = this.getCache(cacheName, subspace);
    if (cache.has(key)) {
      const oldItem = cache.get(key);
      this.currentSize -= oldItem.size;
      cache.delete(key);
    }
    
    // 如果单个项目太大，直接跳过缓存
    if (size > this.maxSize * 0.1) {
      console.warn(`[CacheManager] Item too large (${size} bytes), skipping cache`);
      return value;
    }
    
    // 清理直到有足够空间
    while (this.currentSize + size > this.maxSize * 0.9) {
      this.evictOldest();
    }
    
    const timestamp = Date.now();
    cache.set(key, { value, size, timestamp });
    this.currentSize += size;
    return value;
  }
  
  get(cacheName, key, subspace = '') {
    this.cleanup();
    
    const cache = this.getCache(cacheName, subspace);
    const item = cache.get(key);
    if (item) {
      item.timestamp = Date.now();
      this.hits++;
      return item.value;
    }
    this.misses++;
    return null;
  }
  
  // 增强的缓存项清理
  evictOldest() {
    const allItems = [];
    for (const cacheName in this.caches) {
      const cache = this.caches[cacheName];
      for (const [key, item] of cache.entries()) {
        allItems.push({ cacheName, key, ...item });
      }
    }
    
    // 按时间戳和大小排序
    allItems.sort((a, b) => {
      const timeDiff = a.timestamp - b.timestamp;
      if (Math.abs(timeDiff) > 60000) { // 1分钟以上的时间差
        return timeDiff;
      }
      return b.size - a.size; // 优先清理大文件
    });
    
    // 移除旧项直到空间足够
    for (const item of allItems) {
      if (this.currentSize <= this.maxSize * 0.7) break;
      
      const cache = this.caches[item.cacheName];
      cache.delete(item.key);
      this.currentSize -= item.size;
    }
  }
  
  // 增强的缓存清理
  clear(cacheName) {
    if (cacheName && this.caches[cacheName]) {
      for (const item of this.caches[cacheName].values()) {
        this.currentSize -= item.size;
      }
      this.caches[cacheName].clear();
    } else {
      this.caches = {};
      this.currentSize = 0;
    }
    
    // 强制GC
    if (typeof global !== 'undefined' && global.gc) {
      try {
        global.gc();
      } catch (e) {
        console.warn('[CacheManager] GC failed:', e);
      }
    }
  }
  
  // 获取缓存统计信息
  getStats() {
    return {
      size: this.currentSize,
      maxSize: this.maxSize,
      usage: (this.currentSize / this.maxSize) * 100,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hits + this.misses > 0 ? (this.hits / (this.hits + this.misses)) * 100 : 0,
      caches: Object.keys(this.caches).map(name => ({
        name,
        items: this.caches[name].size
      }))
    };
  }
}

// 创建图像缓存实例
const imageCacheManager = new CacheManager();

// 图像缓存
export const imageCache = {
  get(key, type = 'default') {
    return imageCacheManager.get('images', key, type);
  },
  set(key, value, type = 'default') {
    return imageCacheManager.set('images', key, value, value.data.byteLength, type);
  }
};