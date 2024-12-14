<script>
  import Button from './Button.svelte';
  
  export let fileName = '';
  export let dragActive = false;
  
  let fileInput;
</script>

<div
  class="upload-zone"
  class:active={dragActive}
  on:dragenter
  on:dragleave
  on:dragover|preventDefault
  on:drop
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
      <div class="text-gray-900 font-medium mb-4 text-lg">{fileName}</div>
      <Button variant="secondary" on:click={() => fileInput.click()}>
        Choose Another File
      </Button>
    </div>
  {:else}
    <div class="text-center">
      <div class="mb-6">
        <svg class="mx-auto h-12 w-12 text-gray-400" stroke="currentColor" fill="none" viewBox="0 0 48 48">
          <path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4-4m4-4h8m-4-4v8m-12 4h.02" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </div>
      <p class="text-gray-700 text-lg mb-6">
        Drag and drop your PPTX file here, or
      </p>
      <Button variant="primary" on:click={() => fileInput.click()}>
        Browse Files
      </Button>
    </div>
  {/if}
</div>