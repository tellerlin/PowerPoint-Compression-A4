<script>
    import { createEventDispatcher } from 'svelte';
    import { fade } from 'svelte/transition';
    import Icon from './ui/Icon.svelte';
    
    const dispatch = createEventDispatcher();
    
    export let accept = '.pptx';
    export let maxSize = 314572800; // 300MB
    
    let dragActive = false;
    let fileInput;
    
    function handleFileSelect(file) {
      if (!file) return;
      
      if (!file.name.toLowerCase().endsWith('.pptx')) {
        dispatch('error', { message: '请选择 PowerPoint (PPTX) 文件' });
        return;
      }
      
      if (file.size > maxSize) {
        dispatch('error', { message: '文件大小不能超过 300MB' });
        return;
      }
      
      dispatch('fileSelect', { file });
    }
    
    function handleDragEnter(e) {
      e.preventDefault();
      e.stopPropagation();
      dragActive = true;
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
    class="upload-area {dragActive ? 'drag-active' : ''}"
    role="button"
    tabindex="0"
    aria-label="点击或拖放文件以上传"
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
    
    <div class="upload-content">
      <Icon name="upload" size="48" class="text-primary mb-4" />
      <h3 class="text-lg font-medium mb-2">上传 PowerPoint 文件</h3>
      <p class="text-muted text-sm">
        点击或拖放文件到此处<br>
        支持 .pptx 格式，最大 300MB
      </p>
    </div>
    
    {#if dragActive}
      <div class="drag-overlay" transition:fade={{ duration: 200 }}>
        <span class="text-lg font-medium">释放文件以上传</span>
      </div>
    {/if}
  </div>
  
  <style>
    .upload-area {
      position: relative;
      width: 100%;
      min-height: 16rem;
      border: 2px dashed rgb(var(--border));
      border-radius: 0.5rem;
      background-color: rgb(var(--surface));
      cursor: pointer;
      transition: all 0.2s ease;
    }
    
    .upload-area:hover,
    .upload-area:focus {
      border-color: rgb(var(--primary));
      background-color: rgba(var(--primary), 0.05);
      outline: none;
    }
    
    .upload-area:focus-visible {
      box-shadow: 0 0 0 2px rgb(var(--background)), 0 0 0 4px rgb(var(--primary));
    }
    
    .drag-active {
      border-color: rgb(var(--primary));
      background-color: rgba(var(--primary), 0.05);
    }
    
    .upload-content {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 100%;
      padding: 2rem;
      text-align: center;
    }
    
    .drag-overlay {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background-color: rgba(var(--background), 0.8);
      border: 2px dashed rgb(var(--primary));
      border-radius: 0.5rem;
      z-index: 10;
    }
    
    .hidden {
      display: none;
    }
  </style>