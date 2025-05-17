<script>
  import { themeStore } from '../stores/theme';
  import { fade } from 'svelte/transition';
  import { onMount } from 'svelte';
  
  onMount(() => {
    console.log('[ThemeToggle] Component mounted');
    console.log('[ThemeToggle] Current theme:', $themeStore);
    themeStore.initialize();
  });
  
  function toggleTheme() {
    console.log('[ThemeToggle] Toggling theme');
    console.log('[ThemeToggle] Current theme before toggle:', $themeStore);
    const newTheme = $themeStore === 'light' ? 'dark' : 'light';
    console.log('[ThemeToggle] New theme will be:', newTheme);
    themeStore.update(newTheme);
    
    // 直接操作DOM添加调试
    const isDark = document.documentElement.classList.contains('dark');
    console.log('[ThemeToggle] After toggle, dark class exists:', isDark);
    
    // 强制应用样式变化
    const currentBackground = getComputedStyle(document.documentElement).getPropertyValue('--color-background');
    console.log('[ThemeToggle] Current background color:', currentBackground);
  }
</script>

<button
  type="button"
  class="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-surface hover:bg-primary/20 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors"
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

<style>
  /* 添加一些本地样式，帮助按钮在任何主题下都可见 */
  button {
    border: 1px solid rgb(var(--color-border));
  }
</style>