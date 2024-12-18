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
      currentStep = 'Initializing...';
      progress = 5;

      const optimizedBlob = await optimizePPTX(file, {
        compressImages: { quality: 0.7 },
        removeHiddenSlides: true
      });

      currentStep = 'Finalizing...';
      progress = 95;

      currentStep = 'Preparing download...';
      const { url, a } = createDownloadLink(optimizedBlob, file.name);
      a.click();
      
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

<div class="min-h-screen">
  <div class="relative bg-surface overflow-hidden">
    <img
      src="/images/hero-banner.jpg"
      alt="PowerPoint Presentation Optimization"
      class="absolute inset-0 w-full h-full object-cover opacity-10"
    />
    <div class="relative pt-24 pb-16 px-4 sm:px-6 lg:px-8">
      <div class="max-w-3xl mx-auto text-center">
        <h1 class="text-5xl font-display font-bold text-text mb-6 animate-fade-in">
          PowerPoint Compressor
        </h1>
        <p class="text-xl text-text/70 mb-12 animate-slide-up">
          Optimize your presentations while maintaining quality
        </p>

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
  </div>
</div>