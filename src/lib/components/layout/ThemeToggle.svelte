<script>
  import { onMount } from 'svelte';
  
  let theme = 'dark';
  
  onMount(() => {
    // Check system preference
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    // Check stored preference
    const storedTheme = localStorage.getItem('theme');
    theme = storedTheme || (prefersDark ? 'dark' : 'light');
    applyTheme(theme);
  });
  
  function toggleTheme() {
    theme = theme === 'dark' ? 'light' : 'dark';
    applyTheme(theme);
  }
  
  function applyTheme(newTheme) {
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
  }
</script>

<button
  type="button"
  class="theme-toggle"
  aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
  on:click={toggleTheme}
>
  {#if theme === 'dark'}
    <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
        d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" 
      />
    </svg>
  {:else}
    <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
        d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" 
      />
    </svg>
  {/if}
</button>

<style>
  .theme-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.5rem;
    height: 2.5rem;
    padding: 0.5rem;
    color: rgb(var(--text));
    background: rgb(var(--surface));
    border: 1px solid rgb(var(--border));
    border-radius: 0.5rem;
    transition: all var(--transition-fast) var(--ease-out);
  }

  .theme-toggle:hover {
    background: rgb(var(--primary) / 0.1);
    border-color: rgb(var(--primary));
  }

  .theme-toggle:focus-visible {
    outline: 2px solid rgb(var(--primary));
    outline-offset: 2px;
  }
</style>