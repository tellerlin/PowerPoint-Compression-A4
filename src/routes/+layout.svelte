<script>
  import '../app.css';
  import { onMount, beforeUpdate } from 'svelte';
  import { themeStore } from '$lib/stores/theme';
  import Header from '$lib/components/layout/Header/Header.svelte';
  import { Footer } from '$lib/components/layout/Footer';
  import { Container } from '$lib/components/ui';
  import { siteMetadata } from '$lib/config/metadata';
  import { initializeGoogleAnalytics, initializeWeChatMetaTags } from '$lib/utils/analytics';
  import { page } from '$app/stores'; // Import page store

  // Replace both export statements with just this one:
  export const data = {};

  // Initialize theme before page load
  beforeUpdate(() => {
    if (typeof window !== 'undefined') {
      const storedTheme = localStorage.getItem('theme') || 'dark';
      if (storedTheme === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    }
  });

  onMount(() => {
    themeStore.initialize();
    
    setTimeout(() => {
      initializeGoogleAnalytics();
      initializeWeChatMetaTags(siteMetadata);
    }, 2000);
  });
</script>

<svelte:head>
  <title>{siteMetadata.title.en}</title>
  <meta name="description" content={siteMetadata.description.en}>
  <meta name="keywords" content={siteMetadata.keywords.en}>
  <meta name="author" content={siteMetadata.author}>
  <meta name="publisher" content={siteMetadata.publisher}>
  <meta name="robots" content="index, follow">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="format-detection" content="telephone=no">
  <link rel="canonical" href={new URL($page.url.pathname, siteMetadata.url).href}>

  <!-- Google Site Verification -->
  <meta name="google-site-verification" content={siteMetadata.verification.google}>
  <meta name="msvalidate.01" content={siteMetadata.verification.bing}>

  <!-- Open Graph -->
  <meta property="og:type" content="website">
  <meta property="og:url" content={siteMetadata.url}>
  <meta property="og:title" content={siteMetadata.title.en}>
  <meta property="og:description" content={siteMetadata.description.en}>
  <meta property="og:image" content={`${siteMetadata.url}${siteMetadata.images.og.webp}`}>
  <meta property="og:image:width" content={siteMetadata.images.og.width}>
  <meta property="og:image:height" content={siteMetadata.images.og.height}>
  <meta property="og:image:alt" content={siteMetadata.images.og.alt}>
  <meta property="og:site_name" content={siteMetadata.app.name}>
  <meta property="og:locale" content="en_US">

  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:site" content={siteMetadata.social.twitter}>
  <meta name="twitter:url" content={siteMetadata.url}>
  <meta name="twitter:title" content={siteMetadata.title.en}>
  <meta name="twitter:description" content={siteMetadata.description.en}>
  <meta name="twitter:image" content={`${siteMetadata.url}${siteMetadata.images.twitter.webp}`}>
  <meta name="twitter:image:alt" content={siteMetadata.images.twitter.alt}>

  <!-- Application Info -->
  <meta name="application-name" content={siteMetadata.app.name}>
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black">
  <meta name="apple-mobile-web-app-title" content={siteMetadata.app.name}>
  <meta name="format-detection" content="telephone=no">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="theme-color" content="#ffffff">

  <!-- Structured Data -->
  <script type="application/ld+json">
    {JSON.stringify(structuredData)}
  </script>

  <!-- Preload Images -->
  <link rel="preload" as="image" href={siteMetadata.images.og.webp} type="image/webp">
  <link rel="preload" as="image" href={siteMetadata.images.twitter.webp} type="image/webp">
  <link rel="preload" as="image" href={siteMetadata.images.logo.svg} type="image/svg+xml">
  <link rel="preload" as="image" href={siteMetadata.images.hero.webp} type="image/webp">

  <!-- Fallback Images -->
  <link rel="preload" as="image" href={siteMetadata.images.og.jpg} type="image/jpeg">
  <link rel="preload" as="image" href={siteMetadata.images.twitter.jpg} type="image/jpeg">
  <link rel="preload" as="image" href={siteMetadata.images.hero.jpg} type="image/jpeg">

  <!-- QR Code Images -->
  <link rel="preload" as="image" href="/images/alipay_qr.webp" type="image/webp">
  <link rel="preload" as="image" href="/images/bmc_qr.webp" type="image/webp">
</svelte:head>

<div class="min-h-screen flex flex-col bg-background text-text transition-colors duration-200">
  <Header />
  
  <main class="flex-1 bg-background transition-colors duration-200">
    <Container>
      <slot />
    </Container>
  </main>

  <Footer />
</div>
