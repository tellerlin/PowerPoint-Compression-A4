/**
 * 解析ZIP文件中的XML文档
 * @param {Object} zip - JSZip实例
 * @param {string} path - 文件路径
 * @param {Object} options - 选项
 * @param {boolean} options.verbose - 是否输出详细日志
 * @returns {Document|null} 解析后的DOM文档或null
 */
export async function parseXmlDOM(zip, path, options = { verbose: true }) {
    try {
        const xml = await zip.file(path)?.async('string');
        if (!xml) {
            if (options.verbose) {
                console.warn(`[parseXmlDOM] File not found or empty: ${path}`);
            }
            return null;
        }
        
        const parser = new DOMParser();
        const doc = parser.parseFromString(xml, 'application/xml');
        
        const parseError = doc.querySelector('parsererror');
        if (parseError) {
            // 尝试使用备用解析方法
            const fallbackDoc = parser.parseFromString(xml, 'text/xml');
            const fallbackError = fallbackDoc.querySelector('parsererror');
            if (fallbackError) {
                if (options.verbose) {
                    console.error(`[parseXmlDOM] XML parse error for ${path}:`, parseError.textContent);
                }
                return null;
            }
            return fallbackDoc;
        }
        
        return doc;
    } catch (error) {
        if (options.verbose) {
            console.error(`[parseXmlDOM] Error parsing XML for ${path}:`, error.message);
        }
        return null;
    }
}

export function resolvePath(basePath, target) {
    if (!target || typeof target !== 'string') return null;
    try {
        let baseDir;
        if (basePath.endsWith('.rels')) {
            const parts = basePath.split('/');
            const relsIndex = parts.indexOf('_rels');
            if (relsIndex !== -1 && parts[relsIndex + 1].endsWith('.rels')) {
                baseDir = parts.slice(0, relsIndex).join('/') + '/';
            } else {
                baseDir = basePath.substring(0, basePath.lastIndexOf('/') + 1);
            }
        } else {
            baseDir = basePath.endsWith('/') ? basePath : basePath.substring(0, basePath.lastIndexOf('/') + 1);
        }
        const baseUrl = new URL(baseDir, 'jszip://host/');
        const resolvedUrl = new URL(target, baseUrl);
        let path = resolvedUrl.pathname;
        if (path.startsWith('/')) {
            path = path.substring(1);
        }
        return path.replace(/\\/g, '/').replace(/\/$/, '');
    } catch (e) {
        console.error(`[resolvePath] Error resolving target "${target}" relative to "${basePath}": ${e.message}`);
        return null;
    }
}
