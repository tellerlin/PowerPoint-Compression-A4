<script>
  import { optimizePPTX } from '$lib/pptx/optimizer';
  import { createDownloadLink, cleanupDownload } from '$lib/utils/file';
  import { Button } from '$lib/components/ui/Button';
  import { UploadZone } from '$lib/components/ui/UploadZone';
  import { ProgressBar } from '$lib/components/ui/ProgressBar';
  import { Alert } from '$lib/components/ui/Alert';
  
  let files;
  let processing = false;
  let error = '';
  let progress = 0;
  let dragActive = false;
  let currentStep = '';

  async function handleSubmit() {
    const file = files?.[0];
    if (!file) return;
    
    processing = true;
    error = '';
    progress = 0;
    
    try {
      // Start compression process
      currentStep = 'Initializing...';
      progress = 5;

      const optimizedBlob = await optimizePPTX(file, {
        compressImages: { quality: 0.7 },
        removeHiddenSlides: true
      });

      // Update progress based on completion
      currentStep = 'Finalizing...';
      progress = 95;

      // Create and trigger download
      currentStep = 'Preparing download...';
      const { url, a } = createDownloadLink(optimizedBlob, file.name);
      a.click();
      
      // Cleanup
      cleanupDownload(url);
      progress = 100;
      currentStep = 'Complete!';
      
    } catch (e) {
      error = e.message;
    } finally {
      setTimeout(() => {
        processing = false;
        currentStep = '';
        progress = 0;
      }, 2000);
    }
  }

  $: fileName = files?.[0]?.name;
</script>

<div class="pt-24 pb-16 px-4 sm:px-6 lg:px-8 bg-background">
  <div class="max-w-3xl mx-auto">
    <div class="text-center mb-12 animate-fade-in">
      <h1 class="text-4xl font-display font-bold text-text mb-4">
        PowerPoint Compressor
      </h1>
      <p class="text-xl text-text/70">
        Optimize your presentations while maintaining quality
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
        <Alert type="error" title="Compression Error">
          {error}
        </Alert>
      {/if}

      {#if processing}
        <div class="space-y-4">
          <ProgressBar {progress} />
          {#if currentStep}
            <p class="text-center text-text/70">{currentStep}</p>
          {/if}
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