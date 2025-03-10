<script>
  import { themeStore } from '../stores/theme';
  import { fade } from 'svelte/transition';
  
  function toggleTheme() {
    themeStore.update(current => current === 'light' ? 'dark' : 'light');
  }
</script>

<button
  type="button"
  class="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-surface/50 hover:bg-surface/80 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors"
  aria-label="Toggle theme"
  on:click={toggleTheme}
>
  {#if $themeStore === 'dark'}
    <div in:fade={{ duration: 200 }}>
      <svg class="w-5 h-5 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
          d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" 
        />
      </svg>
    </div>
  {:else}
    <div in:fade={{ duration: 200 }}>
      <svg class="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
          d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" 
        />
      </svg>
    </div>
  {/if}
</button>