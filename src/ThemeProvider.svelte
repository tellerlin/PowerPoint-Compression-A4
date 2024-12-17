<script>
import { themeStore, toggleTheme } from './themeStore.js';
import { derived } from 'svelte/store';
import { onMount, afterUpdate } from 'svelte';

// Create a derived store to handle the theme class
export const themeClass = derived(themeStore, $themeStore => {
  return $themeStore === 'dark' ? 'dark' : 'light';
});

let currentClass;
themeClass.subscribe(value => {
  currentClass = value;
});

// Function to update the body data-theme attribute based on the current theme
function updateTheme() {
  document.body.setAttribute('data-theme', currentClass);
}

// Call updateTheme on mount
onMount(() => {
  updateTheme();
});

// Update the theme whenever currentClass changes after update
afterUpdate(() => {
  updateTheme();
});
</script>

<div class="theme-container {currentClass}">
  <slot />
  <button class="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded" on:click={toggleTheme}>Toggle Theme</button>
</div>
