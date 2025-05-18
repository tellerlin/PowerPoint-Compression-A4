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
      if (browser) {
        const root = document.documentElement;
        
        if (newTheme === 'dark') {
          root.classList.add('dark');
        } else {
          root.classList.remove('dark');
        }
        
        localStorage.setItem('theme', newTheme);
        set(newTheme);
      }
    },
    initialize: () => {
      if (browser) {
        const root = document.documentElement;
        const storedTheme = localStorage.getItem('theme') || 'dark';
        
        if (storedTheme === 'dark') {
          root.classList.add('dark');
        } else {
          root.classList.remove('dark');
        }
        
        set(storedTheme);
      }
    }
  };
}

export const themeStore = createThemeStore();