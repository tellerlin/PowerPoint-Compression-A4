<script>
  import { Button } from '$lib/components/ui/Button';
  import { handleKeyDown } from './keyboard';
  import { gtag, initializeGoogleAnalytics } from '$lib/utils/analytics';
  
  initializeGoogleAnalytics();
  
  export let fileName = '';
  
  let fileInput;
  let dragActive = false;
  
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
    
    if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return;

    const file = e.dataTransfer.files[0];
    
    // More detailed file validation
    if (!file.name.toLowerCase().endsWith('.pptx')) {
      alert('Please select a PowerPoint (.pptx) format file');
      return;
    }
    
    if (file.size > 314572800) { // 300MB
      alert(`File size ${(file.size / 1024 / 1024).toFixed(2)}MB exceeds the 300MB limit`);
      return;
    }
    
    // Update file name display
    fileName = file.name;
    
    // Trigger change event
    const changeEvent = new Event('change', { bubbles: true });
    Object.defineProperty(changeEvent, 'target', {
      writable: false,
      value: { files: e.dataTransfer.files }
    });
    fileInput.dispatchEvent(changeEvent);
  }
</script>

<div
  class="border-2 border-dashed rounded-lg p-8 transition-all duration-200 ease-in-out cursor-pointer
    border-gray-600 hover:border-primary-500 hover:bg-primary-500/5 
    {dragActive ? '!border-primary-500 !bg-primary-500/10' : ''}"
  role="button"
  tabindex="0"
  aria-label="Upload file zone. Click to browse files or drag and drop files here"
  on:keydown={(e) => handleKeyDown(e, fileInput)}
  on:dragenter={handleDragEnter}
  on:dragleave={handleDragLeave}
  on:dragover={handleDragOver}
  on:drop={handleDrop}
>
  <input
    bind:this={fileInput}
    type="file"
    id="file-input"
    accept=".pptx"
    class="hidden"
    on:change
  />
  
  {#if fileName}
    <div class="text-center">
      <div class="text-text font-medium mb-4 text-lg">{fileName}</div>
      <Button variant="secondary" on:click={() => { gtag('event', 'upload'); fileInput.click(); }}>
        Choose Another File
      </Button>
    </div>
  {:else}
    <div class="text-center">
      <div class="mb-6">
        <svg class="mx-auto h-12 w-12 text-primary-500" stroke="currentColor" fill="none" viewBox="0 0 48 48">
          <path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4-4m4-4h8m-4-4v8m-12 4h.02" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </div>
      <p class="text-text/70 text-lg mb-6">
        Click to select a file or drag and drop it here
      </p>
      <Button variant="primary" on:click={() => { gtag('event', 'upload'); fileInput.click(); }}>
        Browse Files
      </Button>
      <p class="text-text/70 text-lg">up to 300MB</p>
    </div>
  {/if}
</div>