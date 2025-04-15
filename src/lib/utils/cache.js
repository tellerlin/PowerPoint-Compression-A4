// 增强缓存管理器

export class CacheManager {
  constructor(options = {}) {
    this.caches = {};
    this.maxSize = options.maxSize || 100 * 1024 * 1024; // 默认100MB
    this.currentSize = 0;
    this.hits = 0;
    this.misses = 0;
  }
  
  // 创建或获取指定名称的缓存
  getCache(name) {
    if (!this.caches[name]) {
      this.caches[name] = new Map();
    }
    return this.caches[name];
  }
  
  // 设置缓存项
  set(cacheName, key, value, size) {
    const cache = this.getCache(cacheName);
    
    // 如果已存在相同键，先移除旧值
    if (cache.has(key)) {
      const oldItem = cache.get(key);
      this.currentSize -= oldItem.size;
      cache.delete(key);
    }
    
    // 检查缓存大小限制
    if (this.currentSize + size > this.maxSize) {
      this.evictOldest();
    }
    
    // 添加新项
    const timestamp = Date.now();
    cache.set(key, { value, size, timestamp });
    this.currentSize += size;
    
    return value;
  }
  
  // 获取缓存项
  get(cacheName, key) {
    const cache = this.getCache(cacheName);
    const item = cache.get(key);
    
    if (item) {
      // 更新访问时间
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

// 创建全局缓存实例
export const globalCache = new CacheManager();

// 图像缓存现在使用全局缓存管理器
export const imageCache = {
  get(key) {
    return globalCache.get('images', key);
  },
  set(key, value) {
    return globalCache.set('images', key, value, value.data.byteLength);
  }
};