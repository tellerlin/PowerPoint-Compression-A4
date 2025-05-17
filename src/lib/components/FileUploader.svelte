<script>
    import { createEventDispatcher, onMount } from 'svelte';
    import { fade } from 'svelte/transition';
    import Icon from './ui/Icon.svelte';
    import { themeStore } from '$lib/stores/theme';
    
    const dispatch = createEventDispatcher();
    
    export let accept = '.pptx';
    export let maxSize = 314572800; // 300MB
    
    let dragActive = false;
    let fileInput;
    let currentTheme = $themeStore;
    
    // Subscribe to theme changes
    $: {
      currentTheme = $themeStore;
      console.log('[FileUploader] Theme changed to:', currentTheme);
      console.log('[FileUploader] Dark class exists:', document.documentElement.classList.contains('dark'));
      console.log('[FileUploader] Current background color:', getComputedStyle(document.documentElement).getPropertyValue('--color-background'));
    }
    
    onMount(() => {
      console.log('[FileUploader] Component mounted');
      console.log('[FileUploader] Initial theme:', currentTheme);
      console.log('[FileUploader] Initial dark class:', document.documentElement.classList.contains('dark'));
    });
    
    function handleFileSelect(file) {
      if (!file) return;
      
      if (!file.name.toLowerCase().endsWith('.pptx')) {
        dispatch('error', { message: 'Please select a PowerPoint (PPTX) file' });
        return;
      }
      
      if (file.size > maxSize) {
        dispatch('error', { message: 'File size cannot exceed 300MB' });
        return;
      }
      
      dispatch('fileSelect', { file });
    }
    
    function handleDragEnter(e) {
      e.preventDefault();
      e.stopPropagation();
      dragActive = true;
      console.log('[FileUploader] Drag enter, current theme:', currentTheme);
      console.log('[FileUploader] Current background color:', getComputedStyle(e.currentTarget).backgroundColor);
    }
    
    function handleDragLeave(e) {
      e.preventDefault();
      e.stopPropagation();
      dragActive = false;
    }
    
    function handleDragOver(e) {
      e.preventDefault();
      e.stopPropagation();
    }
    
    function handleDrop(e) {
      e.preventDefault();
      e.stopPropagation();
      dragActive = false;
      
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleFileSelect(e.dataTransfer.files[0]);
      }
    }
    
    function handleClick() {
      fileInput.click();
    }
  </script>
  
  <div 
    class="relative w-full min-h-64 border-2 border-dashed border-border bg-surface rounded-lg cursor-pointer transition-all duration-200 hover:border-primary hover:bg-primary/5 focus:outline-none focus:border-primary {dragActive ? 'border-primary bg-primary/5' : ''}"
    role="button"
    tabindex="0"
    aria-label="Click or drag and drop file to upload"
    on:dragenter={handleDragEnter}
    on:dragleave={handleDragLeave}
    on:dragover={handleDragOver}
    on:drop={handleDrop}
    on:click={handleClick}
    on:keydown={e => e.key === 'Enter' && handleClick()}
  >
    <input
      bind:this={fileInput}
      type="file"
      {accept}
      class="hidden"
      on:change={e => handleFileSelect(e.target.files[0])}
    />
    
    <div class="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-full p-8 text-center">
      <Icon name="upload" size="48" class="text-primary mb-4" />
      <h3 class="text-lg font-medium mb-2 text-text">Upload PowerPoint File</h3>
      <p class="text-muted text-sm">
        Click or drag and drop file here<br>
        Supports .pptx format, max 300MB
      </p>
    </div>
    
    {#if dragActive}
      <div 
        class="absolute inset-0 flex items-center justify-center bg-surface/80 border-2 border-dashed border-primary rounded-lg z-10"
        transition:fade={{ duration: 200 }}
      >
        <span class="text-lg font-medium text-text">Drop file to upload</span>
      </div>
    {/if}
  </div>