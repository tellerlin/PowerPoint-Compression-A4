import { writable } from 'svelte/store';
import { browser } from '$app/environment';

function createThemeStore() {
  const { subscribe, set, update } = writable(browser ? localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : 'light');

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
        const theme = browser ? localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : 'light';
        document.documentElement.setAttribute('data-theme', theme);
        set(theme);
      }
    }
  };
}

export const themeStore = createThemeStore();