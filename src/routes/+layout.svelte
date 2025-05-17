<script>
  import '../app.css';
  import { onMount, beforeUpdate } from 'svelte';
  import { themeStore } from '$lib/stores/theme';
  import { Header } from '$lib/components/layout/Header';
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
  <meta name="keywords" content={siteMetadata.keywords}>
  <meta name="author" content={siteMetadata.author}>
  <meta name="robots" content="index, follow">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="canonical" href={new URL($page.url.pathname, siteMetadata.url).href}>

  <meta property="og:type" content="website">
  <meta property="og:url" content={siteMetadata.url}>
  <meta property="og:title" content={siteMetadata.title.zh}>
  <meta property="og:description" content={siteMetadata.description.zh}>
  <meta property="og:image" content="{siteMetadata.url}{siteMetadata.images.og}">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:url" content={siteMetadata.url}>
  <meta name="twitter:title" content={siteMetadata.title.en}>
  <meta name="twitter:description" content={siteMetadata.description.en}>
  <meta name="twitter:image" content="{siteMetadata.url}{siteMetadata.images.twitter}">
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
