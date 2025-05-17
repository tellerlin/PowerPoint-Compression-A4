<script>
  import { page } from '$app/stores';
  import { NAV_ITEMS } from './constants';
  import ThemeToggle from '$lib/components/ThemeToggle.svelte';
  
  $: currentPath = $page.url.pathname;
  let isMobileMenuOpen = false;

  function toggleMobileMenu() {
    isMobileMenuOpen = !isMobileMenuOpen;
  }
</script>

<header class="bg-surface shadow-lg border-b border-border">
  <nav class="container mx-auto px-4 py-4">
    <div class="flex items-center justify-between">
      <!-- Logo -->
      <a href="/" class="text-xl font-bold text-text">
        Byte Slim
      </a>

      <!-- Mobile Menu Button -->
      <button
        class="md:hidden p-2 rounded-md text-text hover:bg-surface-hover"
        on:click={toggleMobileMenu}
        aria-label="Toggle menu"
      >
        <svg
          class="w-6 h-6"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          {#if isMobileMenuOpen}
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M6 18L18 6M6 6l12 12"
            />
          {:else}
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M4 6h16M4 12h16M4 18h16"
            />
          {/if}
        </svg>
      </button>

      <!-- Desktop Navigation -->
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

    <!-- Mobile Navigation -->
    {#if isMobileMenuOpen}
      <div class="md:hidden mt-4 space-y-4">
        {#each NAV_ITEMS as item}
          <a
            href={item.href}
            class="block py-2 text-muted hover:text-text transition-colors"
            on:click={() => isMobileMenuOpen = false}
          >
            {item.name}
          </a>
        {/each}
      </div>
    {/if}
  </nav>
</header>

<style>
  /* .logo类未被使用，已移除 */

  /* Add styles for mobile menu animation */
  .mobile-menu-enter {
    opacity: 0;
    transform: translateY(-10px);
  }
  .mobile-menu-enter-active {
    opacity: 1;
    transform: translateY(0);
    transition: opacity 200ms, transform 200ms;
  }
  .mobile-menu-exit {
    opacity: 1;
    transform: translateY(0);
  }
  .mobile-menu-exit-active {
    opacity: 0;
    transform: translateY(-10px);
    transition: opacity 200ms, transform 200ms;
  }
</style>
