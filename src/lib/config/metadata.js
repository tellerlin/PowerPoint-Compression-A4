export const siteMetadata = {  
    title: {
        en: 'ByteSlim - Professional File Compression Tools',
        zh: 'ByteSlim - 专业文件压缩工具'
    },
    description: {
        en: 'Professional online tools for PowerPoint and audio file compression, plus audio trimming. Reduce file sizes without quality loss. Process files locally in your browser with advanced optimization algorithms.',
        zh: '专业的在线PPT和音频文件压缩工具，以及音频剪辑功能。使用先进的优化算法，在不损失质量的情况下减小文件大小。在浏览器中本地处理文件。'
    },
    keywords: {
        en: 'PowerPoint compression, PPTX compression, audio compression, audio trimming, reduce file size, compress files online, file size reduction, document optimization, audio optimization, professional compression tools, local file processing, browser-based compression',
        zh: 'PowerPoint 压缩, PPTX 压缩, 音频压缩, 音频剪辑, 减小文件大小, 在线压缩文件, 文件大小减少, 文档优化, 音频优化, 专业压缩工具, 本地文件处理, 浏览器压缩'
    },
    author: 'ByteSlim.com',
    publisher: 'ByteSlim Technologies',
    url: 'https://byteslim.com',
    images: {
        og: {
            jpg: '/images/og-image.jpg',
            webp: '/images/og-image.webp',
            width: 1200,
            height: 630,
            alt: 'ByteSlim - Professional File Compression Tools'
        },
        twitter: {
            jpg: '/images/twitter-image.jpg',
            webp: '/images/twitter-image.webp',
            width: 1200,
            height: 600,
            alt: 'ByteSlim - Compress Your Files Online'
        },
        wechat: {
            jpg: '/images/wechat-image.jpg',
            width: 300,
            height: 300,
            alt: 'ByteSlim WeChat QR Code'
        },
        logo: {
            svg: '/images/logo.svg',
            width: 200,
            height: 50,
            alt: 'ByteSlim Logo'
        },
        hero: {
            jpg: '/images/hero-banner.jpg',
            webp: '/images/hero-banner.webp',
            width: 1920,
            height: 1080,
            alt: 'ByteSlim Hero Banner'
        },
        qr: {
            alipay: {
                webp: '/images/alipay_qr.webp',
                width: 300,
                height: 300,
                alt: 'Alipay QR Code'
            },
            bmc: {
                webp: '/images/bmc_qr.webp',
                width: 300,
                height: 300,
                alt: 'Buy Me a Coffee QR Code'
            }
        }
    },
    social: {
        twitter: '@byteslim',
        facebook: 'byteslim',
        linkedin: 'company/byteslim'
    },
    verification: {
        google: 'your-google-verification-code',
        bing: 'your-bing-verification-code'
    },
    app: {
        name: 'ByteSlim',
        version: '1.0.0',
        requirements: {
            browser: 'Chrome 80+, Firefox 75+, Safari 13+, Edge 80+',
            javascript: true
        },
        features: [
            'PowerPoint Compression',
            'Audio Compression',
            'Audio Trimming',
            'Local Processing',
            'Quality Preservation'
        ]
    }
};

export const preloadResources = [
    { rel: 'preload', href: '/favicon.svg', as: 'image' },
    { rel: 'preconnect', href: 'https://www.googletagmanager.com' }
];

export const structuredData = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    "name": "ByteSlim",
    "url": "https://byteslim.com",
    "description": "Professional online tools for PowerPoint and audio file compression",
    "applicationCategory": "UtilityApplication",
    "operatingSystem": "Web Browser",
    "offers": {
        "@type": "Offer",
        "price": "0",
        "priceCurrency": "USD"
    },
    "browserRequirements": "Requires JavaScript. Requires HTML5.",
    "softwareVersion": "1.0.0",
    "featureList": [
        "PowerPoint Compression",
        "Audio Compression",
        "Audio Trimming",
        "Local Processing",
        "Quality Preservation"
    ]
};
