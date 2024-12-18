export const siteMetadata = {  
    title: {
        en: 'ByteSlim - PowerPoint Compression Tool',
        zh: 'ByteSlim - PPT压缩工具'
    },
    description: {
        en: 'Free online PowerPoint compression tool. Reduce PPTX file size without quality loss. No upload needed - process files locally in your browser.',
        zh: '免费在线PPT压缩工具。在不损失质量的情况下减小PPTX文件大小。无需上传 - 在浏览器中本地处理文件。'
    },
    keywords: {
        en: 'PowerPoint compression, PPTX compression, reduce PowerPoint size, compress PPT online, file size reduction, document optimization',
        zh: 'PowerPoint 压缩, PPTX 压缩, 减小 PowerPoint 文件大小, 在线压缩 PPT, 文件大小减少, 文档优化'
    },
    author: 'ByteSlim.com',  
    url: 'https://byteslim.com',
    images: {
        og: '/images/og-image.jpg',
        twitter: '/images/twitter-image.jpg',
        wechat: '/images/wechat-image.jpg'
    }
};

export const preloadResources = [
    { rel: 'preload', href: '/favicon.svg', as: 'image' },
    { rel: 'preconnect', href: 'https://www.googletagmanager.com' }
];
