import { writable } from 'svelte/store';
import { browser } from '$app/environment';

function createThemeStore() {
  // Set default theme to dark
  const { subscribe, set } = writable('dark');

  // Set default theme immediately
  if (browser) {
    const root = document.documentElement;
    root.classList.add('dark');
    localStorage.setItem('theme', 'dark');
  }

  return {
    subscribe,
    update: (newTheme) => {
      console.log('[Theme] Updating theme to:', newTheme);
      if (browser) {
        const root = document.documentElement;
        
        if (newTheme === 'dark') {
          root.classList.add('dark');
        } else {
          root.classList.remove('dark');
        }
        
        localStorage.setItem('theme', newTheme);
        set(newTheme);
        console.log('[Theme] Theme updated, current class:', root.classList.contains('dark') ? 'dark' : 'light');
      }
    },
    initialize: () => {
      console.log('[Theme] Initializing theme...');
      if (browser) {
        const root = document.documentElement;
        // Use stored theme or default to dark
        const storedTheme = localStorage.getItem('theme') || 'dark';
        
        console.log('[Theme] Stored theme:', storedTheme);
        console.log('[Theme] Selected theme:', storedTheme);
        
        if (storedTheme === 'dark') {
          root.classList.add('dark');
        } else {
          root.classList.remove('dark');
        }
        
        set(storedTheme);
        console.log('[Theme] Theme initialized, current class:', root.classList.contains('dark') ? 'dark' : 'light');
      }
    }
  };
}

export const themeStore = createThemeStore();