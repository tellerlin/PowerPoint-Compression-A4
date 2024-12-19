let gtag;

export function initializeGoogleAnalytics() {
    if (typeof window !== 'undefined') {
        const script = document.createElement('script');
        script.async = true;
        script.src = `https://www.googletagmanager.com/gtag/js?id=G-M91P9505Z1`;
        document.head.appendChild(script);

        window.dataLayer = window.dataLayer || [];
        window.gtag = gtag = function() {
            window.dataLayer.push(arguments);
        };
        window.gtag('js', new Date());
        window.gtag('config', 'G-M91P9505Z1');
    }
}

export function initializeWeChatMetaTags(metadata) {
    const wechatMetaTags = [
        { name: 'description', content: metadata.description.zh },
        { property: 'og:type', content: 'website' },
        { property: 'og:title', content: metadata.title.zh },
        { property: 'og:description', content: metadata.description.zh },
        { property: 'og:image', content: `${metadata.url}${metadata.images.wechat}` },
        { name: 'weixin:type', content: 'webpage' },
        { name: 'weixin:title', content: metadata.title.zh },
        { name: 'weixin:description', content: metadata.description.zh },
        { name: 'weixin:image', content: `${metadata.url}${metadata.images.wechat}` }
    ];

    wechatMetaTags.forEach(tag => {
        const metaTag = document.createElement('meta');
        Object.entries(tag).forEach(([key, value]) => {
            metaTag.setAttribute(key, value);
        });
        metaTag.setAttribute('data-dynamic', 'true');
        document.head.appendChild(metaTag);
    });

    const wxScript = document.createElement('script');
    wxScript.src = 'https://res.wx.qq.com/open/js/jweixin-1.6.0.js';
    wxScript.async = true;
    document.head.appendChild(wxScript);
}

export { gtag };
