// 增强缓存管理器

export class CacheManager {
  constructor(options = {}) {
    this.caches = {};
    // Enhanced browser compatibility check for deviceMemory
    const hasDeviceMemory = typeof navigator !== 'undefined' && 
                           'deviceMemory' in navigator && 
                           typeof navigator.deviceMemory === 'number';
    
    if (hasDeviceMemory) {
      this.maxSize = Math.max(50 * 1024 * 1024, Math.floor(navigator.deviceMemory * 0.2 * 1024 * 1024 * 1024));
    } else {
      this.maxSize = options.maxSize || 100 * 1024 * 1024;
    }
    this.currentSize = 0;
    this.hits = 0;
    this.misses = 0;
  }
  
  getCache(name, subspace = '') {
    const fullName = subspace ? `${name}:${subspace}` : name;
    if (!this.caches[fullName]) {
      this.caches[fullName] = new Map();
    }
    return this.caches[fullName];
  }
  
  set(cacheName, key, value, size, subspace = '') {
    const cache = this.getCache(cacheName, subspace);
    if (cache.has(key)) {
      const oldItem = cache.get(key);
      this.currentSize -= oldItem.size;
      cache.delete(key);
    }
    // Evict until enough space
    while (this.currentSize + size > this.maxSize) {
      this.evictOldest();
    }
    const timestamp = Date.now();
    cache.set(key, { value, size, timestamp });
    this.currentSize += size;
    return value;
  }
  
  get(cacheName, key, subspace = '') {
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
  
  // 清除最旧的缓存项直到空间足够
  evictOldest() {
    // 收集所有缓存项
    const allItems = [];
    for (const cacheName in this.caches) {
      const cache = this.caches[cacheName];
      for (const [key, item] of cache.entries()) {
        allItems.push({ cacheName, key, ...item });
      }
    }
    
    // 按时间戳排序
    allItems.sort((a, b) => a.timestamp - b.timestamp);
    
    // 移除旧项直到空间足够
    for (const item of allItems) {
      if (this.currentSize <= this.maxSize * 0.8) break;
      
      const cache = this.caches[item.cacheName];
      cache.delete(item.key);
      this.currentSize -= item.size;
    }
  }
  
  // 清除指定缓存
  clear(cacheName) {
    if (cacheName && this.caches[cacheName]) {
      // 减少当前大小
      for (const item of this.caches[cacheName].values()) {
        this.currentSize -= item.size;
      }
      this.caches[cacheName].clear();
    } else {
      // 清除所有缓存
      this.caches = {};
      this.currentSize = 0;
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