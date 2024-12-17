import { writable } from 'svelte/store';

// Create a writable store to manage the theme state
export const themeStore = writable('light');

// Function to toggle the theme
export const toggleTheme = () => {
  themeStore.update(current => (current === 'light' ? 'dark' : 'light'));
};
