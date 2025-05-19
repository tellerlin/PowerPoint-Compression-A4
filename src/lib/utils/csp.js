/**
 * CSP工具函数，用于在客户端代码中获取和使用nonce值
 */

/**
 * 从文档中获取当前的nonce值
 * @returns {string} 当前的nonce值，如果不存在则返回空字符串
 */
export function getNonce() {
  let nonce = '';
  
  // 方法1: 从meta标签获取
  const nonceElement = document.querySelector('meta[name="csp-nonce"]');
  if (nonceElement) {
    nonce = nonceElement.getAttribute('content');
    if (nonce) return nonce;
  }
  
  // 方法2: 从当前脚本获取
  if (document.currentScript && document.currentScript.nonce) {
    return document.currentScript.nonce;
  }
  
  // 方法3: 从文档中任意脚本获取
  const scripts = document.querySelectorAll('script[nonce]');
  if (scripts.length > 0) {
    return scripts[0].nonce;
  }
  
  // 方法4: 尝试从响应头获取
  if (typeof window !== 'undefined' && window.fetch) {
    // 这是异步的，需要单独处理
    // 这里只返回当前可用的nonce
  }
  
  return nonce;
}

/**
 * 为创建的DOM元素添加正确的nonce属性
 * @param {HTMLElement} element - 要添加nonce的DOM元素
 * @returns {HTMLElement} 添加了nonce的相同元素
 */
export function applyNonce(element) {
  const nonce = getNonce();
  if (nonce && element) {
    element.nonce = nonce;
  }
  return element;
}

/**
 * 创建带有nonce的脚本元素
 * @param {Object} options - 脚本选项
 * @param {string} options.src - 脚本源URL
 * @param {boolean} options.async - 是否异步加载
 * @param {Function} options.onload - 加载完成回调
 * @param {Function} options.onerror - 加载错误回调
 * @returns {HTMLScriptElement} 创建的脚本元素
 */
export function createScriptWithNonce({ src, async = true, onload, onerror }) {
  const script = document.createElement('script');
  script.src = src;
  if (async) script.async = true;
  if (onload) script.onload = onload;
  if (onerror) script.onerror = onerror;
  
  // 应用nonce
  applyNonce(script);
  
  return script;
} 