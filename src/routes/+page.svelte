<script>
  import { optimizePPTX } from '$lib/pptx/optimizer.js';
  import { compressionProgress, updateProgress, resetProgress as resetProgressStore } from '$lib/pptx/progress.js';
  import { createDownloadLink, cleanupDownload } from '$lib/utils/file.js';
  import { Button } from '$lib/components/ui/Button';
  import { Alert } from '$lib/components/ui/Alert';
  import { Container } from '$lib/components/ui';
  import { browser } from '$app/environment';
  import { onDestroy, onMount } from 'svelte';

  let files;
  let processing = false;
  let downloadUrl = null;
  let downloadLink = null;
  let isFFmpegLoaded = false;
  let processedFileId = null;

  // Fixed options - simplify by only keeping image compression
  const compressionOptions = {
    compressImages: {
      enabled: true
    }
  };

  onMount(async () => {
    try {
      // Load FFmpeg
      const script = document.createElement('script');
      script.src = '/ffmpeg/ffmpeg.min.js';
      script.async = true;
      script.onload = () => {
        if (typeof window.FFmpeg === 'undefined') {
          console.error('[FFmpeg] FFmpeg object not found after loading');
          updateProgress('error', { message: 'FFmpeg initialization failed. Please refresh and try again.' });
          return;
        }
        isFFmpegLoaded = true;
        console.log('[FFmpeg] Loaded successfully');
      };
      script.onerror = (error) => {
        console.error('[FFmpeg] Failed to load:', error);
        updateProgress('error', { message: 'Failed to load FFmpeg. Please refresh and try again.' });
      };
      document.head.appendChild(script);
    } catch (error) {
      console.error('[FFmpeg] Error during initialization:', error);
      updateProgress('error', { message: 'FFmpeg initialization failed. Please refresh and try again.' });
    }
  });

  onDestroy(() => {
    if (downloadUrl) {
      cleanupDownload(downloadUrl);
    }
  });

  function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // Monitor files changes, if a file is selected and in browser environment, start compression automatically
  $: if (files && files.length > 0 && browser && !processing && files[0].name !== processedFileId) {
    handleSubmit();
  }
  
  $: fileName = files?.[0]?.name;
  $: fileInfo = $compressionProgress.fileInfo;
  $: compressionComplete = $compressionProgress.percentage === 100 && !$compressionProgress.error;
  $: compressionStats = {
    originalSize: $compressionProgress.stats.originalSize || 0,
    compressedSize: $compressionProgress.stats.compressedSize || 0,
    savedSize: $compressionProgress.stats.savedSize || 0,
    savedPercentage: $compressionProgress.stats.savedPercentage || 0,
    formattedOriginalSize: formatBytes($compressionProgress.stats.originalSize || 0),
    formattedCompressedSize: formatBytes($compressionProgress.stats.compressedSize || 0),
    formattedSavedSize: formatBytes($compressionProgress.stats.savedSize || 0)
  };

  async function handleSubmit() {
    const file = files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pptx')) {
      updateProgress('error', { message: "Only PowerPoint (.pptx) format is supported." });
      return;
    }
    if (file.size > 314572800) {
      updateProgress('error', { message: `File size (${formatBytes(file.size)}) exceeds the 300MB limit.` });
      return;
    }
    if (!isFFmpegLoaded) {
      updateProgress('error', { message: 'FFmpeg is not fully loaded yet. Please try again in a moment.' });
      return;
    }
    processing = true;
    resetProgressStore();
    try {
      // Mark current file as processed
      processedFileId = file.name;
      
      const optimizedBlob = await optimizePPTX(file, {
        compressImages: compressionOptions.compressImages.enabled,
        onProgress: updateProgress
      });
      if (!optimizedBlob) {
        if (!$compressionProgress.error) {
          updateProgress('error', { message: "Processing completed but no file was generated." });
        }
        return;
      }
      const { url, a } = createDownloadLink(optimizedBlob, file.name);
      downloadUrl = url;
      downloadLink = a;
    } catch (error) {
      console.error('Compression error:', error);
      updateProgress('error', { message: error.message || 'An error occurred during compression.' });
    } finally {
      processing = false;
      
      // Check if compression is complete, if so, don't trigger compression again
      if ($compressionProgress.percentage === 100 && !$compressionProgress.error) {
        // Keep files to maintain UI display of current file, but add a flag to prevent reprocessing
        files = [...files]; // Create new reference to prevent reactive triggering
      }
    }
  }

  function handleDownload() {
    if (!browser || !downloadLink || !downloadUrl) return;
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    if (isSafari) {
      try {
        const newWindow = window.open(downloadUrl, '_blank');
        if (!newWindow) {
          downloadLink.click();
        }
      } catch (error) {
        downloadLink.click();
      }
    } else {
      downloadLink.click();
    }
  }

  function resetCompression() {
    files = null;
    processing = false;
    processedFileId = null;
    if (downloadUrl) {
      cleanupDownload(downloadUrl);
      downloadUrl = null;
      downloadLink = null;
    }
    resetProgressStore();
    if (browser) {
      requestAnimationFrame(() => {
        const fileUpload = document.getElementById('file-upload');
        if (fileUpload) {
          fileUpload.value = '';
          fileUpload.click();
        }
      });
    }
  }

  function debounce(func, wait) {
    let timeout;
    return function(...args) {
      const context = this;
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(context, args), wait);
    };
  }

  const debouncedUpdateUI = debounce(() => {}, 100);

  $: if ($compressionProgress) {
    debouncedUpdateUI();
  }

  function cancelCompression() {
    if (processing) {
      processing = false;
      resetProgressStore();
      if (downloadUrl) {
        cleanupDownload(downloadUrl);
        downloadUrl = null;
        downloadLink = null;
      }
      updateProgress('info', { message: "Compression cancelled by user." });
    }
  }
</script>

<!-- Your <Container> template remains the same -->
<Container size="lg" class_="py-8">
  <div class="text-center mb-8">
    <h1 class="text-3xl font-bold mb-2 text-text">PowerPoint File Compression Tool</h1>
    <p class="text-muted">One-click optimization of PPT files without complex settings</p>
  </div>

  <div class="rounded-lg shadow-md p-6 mb-6 bg-surface min-h-[250px] flex flex-col justify-center">
    {#if !processing && !compressionComplete}
      <!-- File Upload Area -->
      <div class="border-2 border-dashed border-border rounded-lg p-8 text-center hover:border-primary transition-colors">
        <input
          type="file"
          id="file-upload"
          accept=".pptx"
          on:change={(e) => files = e.target.files}
          class="hidden"
        />
        <label for="file-upload" class="cursor-pointer">
          <div class="flex flex-col items-center justify-center">
            <svg class="w-12 h-12 text-muted mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path></svg>
            <p class="mt-2 text-base text-text font-semibold">Click or drag to select your file</p>
            <p class="text-xs text-muted mt-1">(Supported format: PPTX only)</p>
          </div>
        </label>
      </div>

      {#if files && files.length > 0}
        <div class="mt-4 p-3 bg-surface border border-border rounded-md text-text text-sm">
          <p class="font-medium truncate">Selected: {files[0].name} ({formatBytes(files[0].size)})</p>
          <p class="text-xs text-muted mt-1">File will be compressed automatically after upload</p>
        </div>
      {/if}
    {:else}
      <!-- Progress / Results Area -->
      <div class="space-y-4">
        {#if $compressionProgress.error}
          <!-- Error Display -->
           <Alert variant="destructive" title="Compression Error">
             {$compressionProgress.error}
             <div class="mt-4">
               <Button on:click={resetCompression} variant="outline" class="w-full sm:w-auto">Try Again</Button>
             </div>
           </Alert>
        {:else}
          <!-- Progress Bar -->
          <div class="mb-2">
            <div class="flex justify-between items-center mb-1">
                 <p class="font-medium text-sm text-text">{$compressionProgress.status || 'Processing...'}</p>
                 {#if $compressionProgress.percentage > 0 && $compressionProgress.percentage < 100 && $compressionProgress.estimatedTimeRemaining != null}
                     <p class="text-xs text-muted">Estimated time remaining: ~{$compressionProgress.estimatedTimeRemaining}s</p>
                 {/if}
            </div>
            <div class="w-full bg-border/50 rounded-full h-2.5 overflow-hidden">
              <div
                class="bg-gradient-to-r from-primary to-secondary h-2.5 rounded-full transition-all duration-300 ease-out"
                style="width: {$compressionProgress.percentage || 0}%"
              ></div>
            </div>
            
            {#if $compressionProgress.processedMediaCount > 0 && $compressionProgress.mediaCount > 0}
              <div class="mt-2 text-xs text-muted">
                Processing media files: {$compressionProgress.processedMediaCount}/{$compressionProgress.mediaCount}
                {#if $compressionProgress.stats.savedMediaSize > 0}
                  <span class="ml-2 text-green-400">
                    Saved {($compressionProgress.stats.savedMediaSize / (1024 * 1024)).toFixed(2)} MB of media space
                  </span>
                {/if}
              </div>
            {/if}
          </div>

          {#if fileInfo}
            <div class="p-3 bg-surface border border-border rounded-md text-text text-sm">
              <p class="font-medium truncate">Processing: {fileInfo.name}</p>
            </div>
          {/if}

          {#if compressionComplete}
             <!-- Completion Results -->
            <div class="p-4 bg-surface border border-primary/50 rounded-md animate-fade-in">
              <h3 class="font-bold text-lg text-primary mb-3 text-center">Compression Complete!</h3>
              <div class="grid grid-cols-2 gap-x-4 gap-y-2 mb-4 text-sm">
                <div>
                  <p class="text-muted">Original Size:</p>
                  <p class="font-medium text-text">{compressionStats.formattedOriginalSize}</p>
                </div>
                <div>
                  <p class="text-muted">Compressed Size:</p>
                  <p class="font-medium text-text">{compressionStats.formattedCompressedSize}</p>
                </div>
                <div>
                  <p class="text-muted">Space Saved:</p>
                  <p class="font-medium text-primary">{compressionStats.formattedSavedSize}</p>
                </div>
                <div>
                  <p class="text-muted">Reduction:</p>
                  <p class="font-medium text-primary">{compressionStats.savedPercentage}%</p>
                </div>
              </div>
              <div class="flex flex-col sm:flex-row gap-3 justify-center mt-4">
                <Button on:click={handleDownload} variant="default" size="lg" classList="w-full sm:w-auto">Download Compressed File</Button>
                <Button on:click={resetCompression} variant="outline" size="lg" classList="w-full sm:w-auto">Compress Another File</Button>
              </div>
            </div>
          {/if}
          {#if $compressionProgress.percentage > 0 && $compressionProgress.percentage < 100 && !compressionComplete}
            <div class="mt-4">
              <Button on:click={cancelCompression} variant="outline" size="sm">
                Cancel Compression
              </Button>
            </div>

            <p class="text-center text-muted">Preparing...</p>
          {/if}
        {/if}
      </div>
    {/if}
  </div>
</Container>

<style>
  @keyframes fade-in {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .animate-fade-in {
    animation: fade-in 0.5s ease-out forwards;
  }
</style>
