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
        const file = zip.file(path);
        if (!file) {
            if (options.verbose) {
                // 对于关系文件使用debug级别日志，其他文件使用warn级别
                if (path.includes('_rels/') && path.endsWith('.xml.rels')) {
                    console.debug(`[parseXmlDOM] File not found: ${path}`);
                } else {
                    console.warn(`[parseXmlDOM] File not found: ${path}`);
                }
            }
            return null;
        }
        
        const xml = await file.async('string');
        if (!xml) {
            if (options.verbose) {
                console.warn(`[parseXmlDOM] File is empty: ${path}`);
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

/**
 * 安全解析XML字符串为对象
 * @param {Object} zip - JSZip实例
 * @param {string} path - 文件路径
 * @returns {Object} 解析后的对象，失败时包含错误标记
 */
export async function parseXmlSafely(zip, path) {
    try {
        const xmlString = await zip.file(path)?.async('string');
        if (!xmlString) {
            // 对于关系文件，使用更低级别的日志
            if (path.includes('_rels/') && path.endsWith('.xml.rels')) {
                console.debug(`[parseXmlSafely] File not found or empty: ${path}`);
            } else {
                console.warn(`[parseXmlSafely] File not found or empty: ${path}`);
            }
            return { _notFoundOrEmpty: true };
        }
        const parsed = await parseXml(xmlString);
        if (parsed._parseFailed) {
             console.error(`[parseXmlSafely] Failed to parse XML: ${path}`);
        }
        return parsed;
    } catch (error) {
        console.error(`[parseXmlSafely] Error reading/parsing XML from ${path}:`, error.message);
        return { _parseFailed: true, _error: error.message };
    }
}

/**
 * 处理关系文件中的媒体引用
 * @param {Object} zip - JSZip实例
 * @param {Array} relsFilePaths - 关系文件路径数组
 * @param {Set} usedMedia - 已使用媒体集合
 * @param {string} context - 上下文描述
 */
export async function processGenericRelationshipFiles(zip, relsFilePaths, usedMedia, context) {
    if (!relsFilePaths || relsFilePaths.length === 0) {
        return;
    }
    await Promise.all(relsFilePaths.map(async (relsPath) => {
        try {
            const relsDoc = await parseXmlDOM(zip, relsPath);
            if (!relsDoc) {
                console.warn(`[processGenericRelationshipFiles] Failed to parse: ${relsPath}`);
                return;
            }
            const relationships = Array.from(relsDoc.querySelectorAll('Relationship'));
            if (!relationships.length) {
                console.warn(`[processGenericRelationshipFiles] No Relationship nodes found: ${relsPath}`);
            }
            relationships.forEach(rel => {
                if (!rel) return;
                const relType = rel.getAttribute('Type');
                const target = rel.getAttribute('Target');
                const targetMode = rel.getAttribute('TargetMode');
                if (!relType || !target) {
                    console.warn(`[processGenericRelationshipFiles] Relationship missing Type or Target: ${rel.outerHTML}`);
                    return;
                }
                if (targetMode === 'External') {
                    return;
                }
                if (relType === 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image' ||
                    relType === 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/audio' ||
                    relType === 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/video' ||
                    relType.includes('/image') || relType.includes('/audio') || relType.includes('/video')) {
                    let mediaPath = resolvePath(relsPath, target);
                    if (mediaPath && mediaPath.startsWith('ppt/media/')) {
                        usedMedia.add(mediaPath);
                    } else {
                        console.warn(`[processGenericRelationshipFiles] Resolved path "${mediaPath}" (target="${target}", relsPath="${relsPath}") does not start with ppt/media/. Skipping.`);
                    }
                }
            });
        } catch (error) {
            console.error(`[processGenericRelationshipFiles] Error processing ${relsPath} (context: ${context}):`, error.message, error.stack);
        }
    }));
}

/**
 * 从XML中提取关系对象
 * @param {Object} xmlObj - XML对象
 * @returns {Array} 关系数组
 */
export function extractRelationships(xmlObj) {
    if (!xmlObj || !xmlObj.Relationships) {
        return [];
    }
    
    const relsArr = Array.isArray(xmlObj.Relationships) 
        ? xmlObj.Relationships 
        : [xmlObj.Relationships];
        
    return relsArr.flatMap(r => {
        if (!r) return [];
        if (Array.isArray(r.Relationship)) return r.Relationship;
        if (r.Relationship) return [r.Relationship];
        return [];
    });
}

/**
 * 移除文件及其关系文件
 * @param {Object} zip - JSZip实例
 * @param {Array} filePaths - 文件路径数组
 * @param {string} prefix - 文件前缀
 * @returns {number} 移除的文件数量
 */
export async function removeFilesAndRels(zip, filePaths, prefix) {
    let removedCount = 0;
    for (const filePath of filePaths) {
        try {
            if (zip.file(filePath)) {
                zip.remove(filePath);
                const relsPath = filePath.replace(prefix, `${prefix}_rels/`) + '.rels';
                if (zip.file(relsPath)) {
                    zip.remove(relsPath);
                }
                removedCount++;
            }
        } catch (e) {
            console.error(`[removeFilesAndRels] Failed to remove ${filePath} or its rels: ${e.message}`);
        }
    }
    console.log(`[removeFilesAndRels] Removed ${removedCount}/${filePaths.length} ${prefix.includes('Layout') ? 'layouts' : 'masters'}.`);
    return removedCount;
}

/**
 * 导入parseXml函数，以便parseXmlSafely可以使用
 */
import { parseXml } from './xml/parser';
