<script>
  import { page } from '$app/stores';
  import { NAVIGATION_ITEMS } from './constants';
  
  $: currentPath = $page.url.pathname;
</script>

<header class="fixed top-0 w-full bg-dark-surface backdrop-blur-sm border-b border-dark-surface z-50">
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
    <nav class="flex items-center justify-between h-16">
      <div class="flex items-center">
        <a href="/" class="flex items-center space-x-2">
          <svg class="w-8 h-8 text-white transition-transform group-hover:scale-110" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-7-7z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M13 2v7h7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span class="text-xl font-display font-bold text-white">PPTX Compressor</span>
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
