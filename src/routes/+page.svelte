<script>
  import { optimizePPTX } from '$lib/pptx/optimizer';
  import { ProgressManager, compressionProgress } from '$lib/pptx/progress';
  import { createDownloadLink, cleanupDownload } from '$lib/utils/file';
  import { Button } from '$lib/components/ui/Button';
  import { UploadZone } from '$lib/components/ui/UploadZone';
  import { ProgressBar } from '$lib/components/ui/ProgressBar';
  import { Alert } from '$lib/components/ui/Alert';
  
  let files;
  let processing = false;
  let dragActive = false;
  let progressManager;

  $: fileName = files?.[0]?.name;

  async function handleSubmit() {
    const file = files?.[0];
    if (!file) return;
    
    processing = true;
    progressManager = new ProgressManager();
    
    try {
      // 使用更高的压缩质量，但保持与原始代码相同的结构
      const optimizedBlob = await optimizePPTX(file, {
        compressImages: { quality: 0.9 }, // 提高质量到0.9
        removeHiddenSlides: true,
        onProgress: (phase, detail) => {
          switch (phase) {
            case 'init':
              progressManager.updateInitProgress(detail.percentage);
              break;
            case 'mediaCount':
              progressManager.initializeCompression(detail.count);
              break;
            case 'media':
              progressManager.updateMediaProgress(detail.fileIndex, detail.fileName);
              break;
            case 'finalize':
              progressManager.updateFinalizationProgress(detail.status);
              break;
          }
        }
      });

      // Handle successful completion
      progressManager.completeCompression();
      
      // Create and trigger download
      const { url, a } = createDownloadLink(optimizedBlob, file.name);
      a.click();
      cleanupDownload(url);
      
    } catch (e) {
      progressManager.handleError(e, $compressionProgress.percentage);
    } finally {
      setTimeout(() => {
        processing = false;
      }, 2000);
    }
  }

  // 新增的点击处理函数，用于发送 GA4 事件
  function handleButtonClick() {
    gtag('event', 'start_compression');
    handleSubmit();
  }
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

          {#if $compressionProgress.error}
            <Alert type="error" title="Compression Error">
              {$compressionProgress.error}
            </Alert>
          {/if}

          {#if processing}
            <div class="space-y-4">
              <ProgressBar 
                progress={$compressionProgress.percentage}
                status={$compressionProgress.status}
                error={$compressionProgress.error}
              />
            </div>
          {:else if fileName}
            <div class="text-center">
              <Button
                variant="primary"
                on:click={handleButtonClick}
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