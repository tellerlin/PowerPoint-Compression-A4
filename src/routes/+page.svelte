<script>
  import { optimizePPTX } from '$lib/pptx/optimizer';
  import { createDownloadLink, cleanupDownload } from '$lib/utils/file';
  import { Button } from '$lib/components/ui/Button';
  import { UploadZone } from '$lib/components/ui/UploadZone';
  import { ProgressBar } from '$lib/components/ui/ProgressBar';
  
  let files;
  let processing = false;
  let error = '';
  let progress = 0;
  let dragActive = false;

  async function handleSubmit() {
    const file = files?.[0];
    if (!file) return;
    
    processing = true;
    error = '';
    progress = 0;
    
    try {
      const interval = setInterval(() => {
        if (progress < 90) {
          progress += 10;
        }
      }, 500);

      const optimizedBlob = await optimizePPTX(file, {
        compressImages: { quality: 0.7 },
        removeHiddenSlides: true
      });

      clearInterval(interval);
      progress = 100;

      const { url, a } = createDownloadLink(optimizedBlob, file.name);
      a.click();
      cleanupDownload(url);
    } catch (e) {
      error = e.message;
    } finally {
      processing = false;
    }
  }

  $: fileName = files?.[0]?.name;
</script>

<div class="pt-24 pb-16 px-4 sm:px-6 lg:px-8">
  <div class="max-w-3xl mx-auto">
    <div class="text-center mb-12 animate-fade-in">
      <h1 class="text-4xl font-display font-bold text-gray-900 mb-4">
        Compress Your Presentations
      </h1>
      <p class="text-xl text-gray-600">
        Optimize your PowerPoint files without compromising quality
      </p>
    </div>

    <div class="space-y-8 animate-slide-up">
      <UploadZone
        {fileName}
        {dragActive}
        on:change={(e) => files = e.target.files}
        on:dragenter={(e) => {
          e.preventDefault();
          dragActive = true;
        }}
        on:dragleave={(e) => {
          e.preventDefault();
          dragActive = false;
        }}
        on:drop={(e) => {
          e.preventDefault();
          dragActive = false;
          files = e.dataTransfer.files;
        }}
      />

      {#if error}
        <div class="bg-red-50 border-l-4 border-red-500 p-4 rounded">
          <p class="text-red-700">{error}</p>
        </div>
      {/if}

      {#if processing}
        <div class="space-y-4">
          <ProgressBar {progress} />
        </div>
      {:else if fileName}
        <div class="text-center">
          <Button
            variant="primary"
            on:click={handleSubmit}
            disabled={processing}
          >
            Start Compression
          </Button>
        </div>
      {/if}
    </div>
  </div>
</div>