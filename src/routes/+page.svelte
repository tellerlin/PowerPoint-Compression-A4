<script>
  import { optimizePPTX } from '$lib/pptx/optimizer';
  import { createDownloadLink, cleanupDownload } from '$lib/utils/file';
  
  let files;
  let processing = false;
  let error = '';
  let removeHidden = false;

  async function handleSubmit() {
    const file = files?.[0];
    if (!file) return;
    
    processing = true;
    error = '';
    
    try {
      const optimizedBlob = await optimizePPTX(file, {
        compressImages: { quality: 0.7 },
        removeHiddenSlides: removeHidden
      });
      
      const { url, a } = createDownloadLink(optimizedBlob, file.name);
      a.click();
      cleanupDownload(url);
    } catch (e) {
      error = e.message;
    } finally {
      processing = false;
    }
  }

  $: file = files?.[0];
</script>

<div class="min-h-screen bg-gray-50 flex items-center justify-center p-4">
  <div class="max-w-md w-full bg-white rounded-lg shadow-lg p-6">
    <h1 class="text-2xl font-bold text-center mb-6">PPTX Compressor</h1>
    <form on:submit|preventDefault={handleSubmit} class="space-y-4">
      <div class="border-2 border-dashed border-gray-300 rounded-lg p-4">
        <input
          type="file"
          accept=".pptx"
          bind:files
          class="w-full"
          required
        />
      </div>
      <div class="flex items-center space-x-2">
        <input
          type="checkbox"
          id="removeHidden"
          bind:checked={removeHidden}
          class="rounded border-gray-300"
        />
        <label for="removeHidden" class="text-sm text-gray-700">
          Remove hidden slides
        </label>
      </div>
      {#if error}
        <p class="text-red-500 text-sm">{error}</p>
      {/if}
      <button
        type="submit"
        disabled={processing || !file}
        class="w-full bg-blue-500 text-white py-2 px-4 rounded-lg hover:bg-blue-600 disabled:opacity-50"
      >
        {processing ? 'Compressing...' : 'Compress PPTX'}
      </button>
    </form>
  </div>
</div>