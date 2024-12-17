import { writable } from 'svelte/store';
import { browser } from '$app/environment';

function createThemeStore() {
  // Get initial theme from localStorage or system preference
  const getInitialTheme = () => {
    if (!browser) return 'light';
    
    const stored = localStorage.getItem('theme');
    if (stored) return stored;
    
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  };

  const { subscribe, set, update } = writable(getInitialTheme());

  return {
    subscribe,
    update: (newTheme) => {
      update(() => {
        if (browser) {
          document.documentElement.setAttribute('data-theme', newTheme);
          localStorage.setItem('theme', newTheme);
        }
        return newTheme;
      });
    },
    initialize: () => {
      if (browser) {
        const theme = getInitialTheme();
        document.documentElement.setAttribute('data-theme', theme);
        set(theme);
      }
    }
  };
}

export const themeStore = createThemeStore();