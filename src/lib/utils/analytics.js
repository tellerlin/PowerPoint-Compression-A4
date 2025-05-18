// Google Analytics and WeChat meta tags initialization

export function initializeGoogleAnalytics() {
  if (typeof window !== 'undefined' && window.gtag) {
    window.gtag('config', 'G-XXXXXXXXXX'); // Replace with your actual GA ID
  }
}

export function initializeWeChatMetaTags(metadata) {
  if (typeof window !== 'undefined') {
    // Add WeChat meta tags
    const metaTags = [
      { name: 'wechat:title', content: metadata.title.zh },
      { name: 'wechat:description', content: metadata.description.zh },
      { name: 'wechat:image', content: `${metadata.url}${metadata.images.og}` }
    ];

    metaTags.forEach(tag => {
      const meta = document.createElement('meta');
      meta.setAttribute('name', tag.name);
      meta.setAttribute('content', tag.content);
      document.head.appendChild(meta);
    });
  }
} 