<script>
  import { page } from '$app/stores';
  import { NAV_ITEMS } from './constants';
  import ThemeToggle from '$lib/components/ThemeToggle.svelte';
  
  $: currentPath = $page.url.pathname;
</script>

<header class="bg-surface shadow-lg border-b border-border">
  <nav class="container mx-auto px-4 py-4">
    <div class="flex items-center justify-between">
      <!-- Logo -->
      <a href="/" class="text-xl font-bold text-text">
        Media Tools
      </a>

      <!-- Navigation -->
      <div class="hidden md:flex space-x-8">
        {#each NAV_ITEMS as item}
          <a
            href={item.href}
            class="text-muted hover:text-text transition-colors relative group"
          >
            {item.name}
            <div class="absolute bottom-0 left-0 w-full h-0.5 bg-primary transform scale-x-0 group-hover:scale-x-100 transition-transform"></div>
          </a>
        {/each}
      </div>

      <!-- Theme Toggle -->
      <div class="flex items-center space-x-4">
        <ThemeToggle />
      </div>
    </div>
  </nav>
</header>

<style>
  /* .logo类未被使用，已移除 */
</style>
