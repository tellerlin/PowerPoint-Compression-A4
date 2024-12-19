<script>
  import { page } from '$app/stores';
  import { NAVIGATION_ITEMS } from './constants';
  
  $: currentPath = $page.url.pathname;
</script>

<header class="fixed top-0 w-full bg-dark-surface backdrop-blur-sm border-b border-dark-surface z-50">
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
    <nav class="flex items-center justify-between h-16">
      <div class="flex items-center">
        <img src="/images/logo.svg" alt="Logo" class="logo" style="max-height: 64px; max-width: auto;" />
        <a href="/" class="flex items-center space-x-2">
          <span class="text-xl font-display font-bold text-white">ByteSlim Compression</span>
        </a>
      </div>
      
      <div class="hidden md:flex items-center space-x-1">
        {#each NAVIGATION_ITEMS as item}
          <a
            href={item.href}
            class="px-4 py-2 rounded-md text-sm font-medium transition-all duration-200
              {currentPath === item.href 
                ? 'bg-surface/20 text-white' 
                : 'text-white hover:bg-dark-surface hover:text-gray-300'}"
          >
            {item.label}
          </a>
        {/each}
      </div>
    </nav>
  </div>
</header>

<style>
  .logo {
    max-height: 64px;
    max-width: 64px;
  }
</style>
