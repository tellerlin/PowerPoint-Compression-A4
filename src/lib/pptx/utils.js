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
