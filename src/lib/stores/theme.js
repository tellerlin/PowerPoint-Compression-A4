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
  };
}

export const themeStore = createThemeStore();