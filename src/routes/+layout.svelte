<script>
  import '../app.css';
  import Header from '$lib/components/layout/Header.svelte';
  import Footer from '$lib/components/layout/Footer.svelte';
  import ThemeProvider from '../ThemeProvider.svelte';
  import { themeStore, toggleTheme } from '../themeStore.js';

  export let theme = $themeStore;
</script>

<ThemeProvider>
  <div class="flex flex-col min-h-screen">
    <Header />
    <button class="p-2 m-4" on:click={toggleTheme}>Toggle Theme</button>
    <p>Current Theme: {theme}</p>
    <main class="flex-grow">
      <slot />
    </main>
    <Footer />
  </div>
</ThemeProvider>