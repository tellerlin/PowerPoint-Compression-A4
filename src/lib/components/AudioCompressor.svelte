<!-- Client-side audio compression component -->
<script context="module">
  // Ensure this module only executes on client
  export const prerender = false;
  console.log('[AudioCompressor] Module context initialized');
</script>

<script>
  import { onMount } from 'svelte';
  import { Button } from '$lib/components/ui/Button';
  import { Alert } from '$lib/components/ui/Alert';
  import { Container } from '$lib/components/ui';
  import { createEventDispatcher } from 'svelte';

  const dispatch = createEventDispatcher();

  // Environment check helper
  const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';
  console.log('[AudioCompressor] Environment check:', {
    isBrowser,
    window: typeof window,
    document: typeof document,
    navigator: typeof navigator
  });
  
  let ffmpeg = null;
  let files = [];
  let isProcessing = false;
  let isFFmpegLoaded = false;
  let loadStarted = false;
  let shouldCancel = false;
  let currentFFmpegProcess = null;  // Add reference to current FFmpeg process
  let compressionProgress = {
    percentage: 0,
    status: '',
    error: null,
    stats: {
      originalSize: 0,
      compressedSize: 0,
      savedSize: 0,
      savedPercentage: 0
    }
  };

  // Only load FFmpeg in browser environment
  async function injectFFmpegScript() {
    if (!document.getElementById('ffmpeg-script')) {
      console.log('[AudioCompressor] Injecting FFmpeg script');
      const script = document.createElement('script');
      script.id = 'ffmpeg-script';
      script.src = '/ffmpeg/ffmpeg.min.js';
      script.async = true;
      script.onload = () => {
        console.log('[AudioCompressor] FFmpeg script loaded, checking window object:', {
          createFFmpeg: typeof window.createFFmpeg,
          FFmpeg: typeof window.FFmpeg,
          FFmpegCreateFFmpeg: typeof window.FFmpeg?.createFFmpeg,
          keys: Object.keys(window)
        });
        checkFFmpegAvailability();
      };
      document.head.appendChild(script);
    } else {
      checkFFmpegAvailability();
    }
  }

  async function checkFFmpegAvailability() {
    console.log('[AudioCompressor] Checking FFmpeg availability:', {
      createFFmpeg: typeof window.createFFmpeg,
      FFmpeg: typeof window.FFmpeg,
      FFmpegCreateFFmpeg: typeof window.FFmpeg?.createFFmpeg,
      keys: Object.keys(window)
    });

    if (typeof window.createFFmpeg === 'function' || typeof window.FFmpeg?.createFFmpeg === 'function') {
      const createFFmpegFn = window.createFFmpeg || window.FFmpeg?.createFFmpeg;
      console.log('[AudioCompressor] Creating FFmpeg instance');
      ffmpeg = createFFmpegFn({
        log: true,
        corePath: '/ffmpeg/ffmpeg-core.js',
        logger: ({ message }) => {
          console.log('[FFmpeg]', message);
          // Update progress based on FFmpeg output
          if (message.includes('time=')) {
            const timeMatch = message.match(/time=(\d+):(\d+):(\d+\.\d+)/);
            if (timeMatch) {
              const hours = parseInt(timeMatch[1]);
              const minutes = parseInt(timeMatch[2]);
              const seconds = parseFloat(timeMatch[3]);
              const totalSeconds = hours * 3600 + minutes * 60 + seconds;
              
              // Assuming 1 hour 12 minutes (4320 seconds) as total duration
              // This should be updated based on actual file duration
              const totalDuration = 4320;
              const progress = Math.min(95, (totalSeconds / totalDuration) * 100);
              
              compressionProgress.percentage = progress;
              compressionProgress.status = `Processing: ${Math.round(progress)}%`;
            }
          }
        }
      });

      try {
        console.log('[AudioCompressor] Loading FFmpeg');
        await ffmpeg.load();
        
        // Test FFmpeg availability
        try {
          const testFileName = 'test.txt';
          const testData = new Uint8Array([116, 101, 115, 116]); // ASCII for "test"
          ffmpeg.FS('writeFile', testFileName, testData);
          const readData = ffmpeg.FS('readFile', testFileName);
          ffmpeg.FS('unlink', testFileName);
          
          if (readData.length === testData.length) {
            console.log('[AudioCompressor] FFmpeg filesystem test successful');
            isFFmpegLoaded = true;
          } else {
            console.error('[AudioCompressor] FFmpeg filesystem test failed');
            isFFmpegLoaded = false;
          }
        } catch (fsError) {
          console.error('[AudioCompressor] FFmpeg filesystem test error:', fsError);
          isFFmpegLoaded = false;
        }
        
      } catch (error) {
        console.error('[AudioCompressor] Error loading FFmpeg:', error);
        isFFmpegLoaded = false;
      }
    } else {
      console.error('[AudioCompressor] FFmpeg not available');
      isFFmpegLoaded = false;
    }
  }

  onMount(() => {
    console.log('[AudioCompressor] Component mounted');
    if (isBrowser) {
      console.log('[AudioCompressor] Browser environment detected, scheduling FFmpeg load');
      setTimeout(() => {
        console.log('[AudioCompressor] Executing delayed FFmpeg load');
        injectFFmpegScript();
      }, 100);
    } else {
      console.log('[AudioCompressor] Not in browser environment, skipping FFmpeg load');
    }
  });

  async function handleFileSelect(event) {
    console.log('[AudioCompressor] File selection handler called');
    if (!isFFmpegLoaded) {
      console.log('[AudioCompressor] FFmpeg not loaded, showing alert');
      alert('FFmpeg is not loaded yet. Please wait and try again.');
      return;
    }
    const selectedFiles = Array.from(event.target.files);
    console.log('[AudioCompressor] Files selected:', selectedFiles.map(f => f.name));
    files = [...files, ...selectedFiles];
    await processFiles(selectedFiles);
  }

  async function processFiles(newFiles) {
    console.log('[AudioCompressor] Processing files:', newFiles.map(f => f.name));
    if (!isFFmpegLoaded) {
      console.log('[AudioCompressor] FFmpeg not loaded, showing alert');
      alert('FFmpeg is not loaded. Please wait for it to load or refresh the page.');
      return;
    }
    isProcessing = true;
    shouldCancel = false;
    compressionProgress.percentage = 0;
    compressionProgress.status = 'Starting compression...';
    compressionProgress.error = null;

    for (const file of newFiles) {
      if (shouldCancel) {
        console.log('[AudioCompressor] Compression cancelled by user');
        break;
      }

      try {
        console.log('[AudioCompressor] Processing file:', file.name);
        compressionProgress.status = `Processing ${file.name}...`;
        compressionProgress.stats.originalSize = file.size;
        
        const inFileName = `in_${Math.random().toString(36).substring(2, 15)}.mp3`;
        const outFileName = `out_${Math.random().toString(36).substring(2, 15)}.mp3`;
        
        console.log('[AudioCompressor] Writing file to FFmpeg with name:', inFileName);
        
        const fileArrayBuffer = await file.arrayBuffer();
        const fileData = new Uint8Array(fileArrayBuffer);
        
        try {
          if (shouldCancel) break;
          ffmpeg.FS('writeFile', inFileName, fileData);
          compressionProgress.percentage = 5;
        } catch (writeError) {
          console.error('[AudioCompressor] Error writing file to FFmpeg:', writeError);
          throw new Error(`Failed to write file to FFmpeg: ${writeError.message}`);
        }
        
        try {
          if (shouldCancel) break;
          console.log('[AudioCompressor] Executing FFmpeg command');
          const args = ['-i', inFileName, '-b:a', '40k', outFileName];
          console.log('[AudioCompressor] FFmpeg args:', args);
          
          // Store the FFmpeg process
          currentFFmpegProcess = ffmpeg.run(...args);
          
          // Add cancellation check
          const checkCancellation = setInterval(() => {
            if (shouldCancel) {
              console.log('[AudioCompressor] Cancelling FFmpeg process');
              clearInterval(checkCancellation);
              
              // Force terminate FFmpeg process
              try {
                if (currentFFmpegProcess) {
                  // Attempt to terminate the process
                  ffmpeg.exit();
                  currentFFmpegProcess = null;
                }
                
                // Clean up files
                ffmpeg.FS('unlink', inFileName);
                ffmpeg.FS('unlink', outFileName);
              } catch (e) {
                console.warn('[AudioCompressor] Error during cleanup:', e);
              }
              
              // Reset FFmpeg instance
              ffmpeg = null;
              isFFmpegLoaded = false;
              
              // Reload FFmpeg
              setTimeout(() => {
                checkFFmpegAvailability();
              }, 100);
              
              throw new Error('Compression cancelled by user');
            }
          }, 100);

          await currentFFmpegProcess;
          clearInterval(checkCancellation);
          currentFFmpegProcess = null;
          
        } catch (runError) {
          console.error('[AudioCompressor] Error running FFmpeg command:', runError);
          try { ffmpeg.FS('unlink', inFileName); } catch (e) {}
          if (shouldCancel) {
            throw new Error('Compression cancelled by user');
          }
          throw new Error(`Failed to process audio: ${runError.message}`);
        }
        
        if (shouldCancel) break;

        let outputData;
        try {
          console.log('[AudioCompressor] Reading output file');
          outputData = ffmpeg.FS('readFile', outFileName);
          compressionProgress.percentage = 98;
        } catch (readError) {
          console.error('[AudioCompressor] Error reading output file:', readError);
          try { ffmpeg.FS('unlink', inFileName); } catch (e) {}
          try { ffmpeg.FS('unlink', outFileName); } catch (e) {}
          throw new Error(`Failed to read processed file: ${readError.message}`);
        }
        
        if (shouldCancel) break;

        const blob = new Blob([outputData.buffer], { type: 'audio/mp3' });
        const url = URL.createObjectURL(blob);
        
        try {
          ffmpeg.FS('unlink', inFileName);
          ffmpeg.FS('unlink', outFileName);
        } catch (cleanupError) {
          console.warn('[AudioCompressor] Error cleaning up temporary files:', cleanupError);
        }
        
        if (shouldCancel) break;

        const fileIndex = files.findIndex(f => f.name === file.name);
        if (fileIndex !== -1) {
          console.log('[AudioCompressor] Updating file state:', file.name);
          files[fileIndex] = {
            ...files[fileIndex],
            compressed: true,
            compressedUrl: url,
            compressedName: `compressed-${file.name}`,
            compressedSize: blob.size
          };
        }

        compressionProgress.stats.compressedSize = blob.size;
        compressionProgress.stats.savedSize = file.size - blob.size;
        compressionProgress.stats.savedPercentage = ((file.size - blob.size) / file.size * 100).toFixed(1);
        compressionProgress.percentage = 100;
        compressionProgress.status = 'Compression complete!';
      } catch (error) {
        console.error('[AudioCompressor] Error processing file:', {
          file: file.name,
          error,
          stack: error.stack,
          message: error.message
        });
        if (shouldCancel) {
          compressionProgress.error = 'Compression cancelled by user';
        } else {
          compressionProgress.error = `Error processing file ${file.name}: ${error.message}`;
        }
      }
    }
    isProcessing = false;
    currentFFmpegProcess = null;
    console.log('[AudioCompressor] File processing completed');
  }

  function removeFile(index) {
    console.log('[AudioCompressor] Removing file at index:', index);
    files = files.filter((_, i) => i !== index);
  }

  function formatFileSize(bytes) {
    if (bytes >= 1073741824) {
      return (bytes / 1073741824).toFixed(2) + ' GB';
    } else if (bytes >= 1048576) {
      return (bytes / 1048576).toFixed(2) + ' MB';
    } else {
      return (bytes / 1024).toFixed(2) + ' KB';
    }
  }

  function resetCompression() {
    shouldCancel = true;
    if (currentFFmpegProcess) {
      try {
        ffmpeg.exit();
        currentFFmpegProcess = null;
      } catch (e) {
        console.warn('[AudioCompressor] Error terminating FFmpeg:', e);
      }
    }
    files = [];
    isProcessing = false;
    compressionProgress = {
      percentage: 0,
      status: 'Compression cancelled',
      error: null,
      stats: {
        originalSize: 0,
        compressedSize: 0,
        savedSize: 0,
        savedPercentage: 0
      }
    };
  }
</script>

<Container size="lg" class_="py-8">
  <div class="text-center mb-8">
    <h1 class="text-3xl font-bold mb-2 text-gray-100">Audio Compression Tool</h1>
    <p class="text-gray-400">Reduce audio file size while maintaining quality</p>
  </div>

  <div class="rounded-lg shadow-md p-6 mb-6 bg-gray-800 min-h-[250px] flex flex-col justify-center">
    {#if !isProcessing && !compressionProgress.percentage}
      <!-- File Upload Area -->
      <div class="border-2 border-dashed border-gray-600 rounded-lg p-8 text-center hover:border-gray-500 transition-colors">
        <input
          type="file"
          id="file-upload"
          accept="audio/*"
          on:change={handleFileSelect}
          class="hidden"
        />
        <label for="file-upload" class="cursor-pointer">
          <div class="flex flex-col items-center justify-center">
            <svg class="w-12 h-12 text-gray-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"></path>
            </svg>
            <p class="mt-2 text-base text-gray-300 font-semibold">Click or drag audio files here</p>
            <p class="text-xs text-gray-500 mt-1">Supports MP3, WAV, OGG formats</p>
          </div>
        </label>
      </div>

      {#if files && files.length > 0}
        <div class="mt-4 p-3 bg-gray-700 rounded-md text-gray-200 text-sm">
          <p class="font-medium truncate">Selected: {files[0].name} ({formatFileSize(files[0].size)})</p>
        </div>

        <div class="mt-5 flex justify-center">
          <Button on:click={() => processFiles(files)} size="lg">Start Compression</Button>
        </div>
      {/if}
    {:else}
      <!-- Progress/Results Area -->
      <div class="space-y-4">
        {#if compressionProgress.error}
          <!-- Error Display -->
          <Alert variant="destructive" title="Compression Error">
            {compressionProgress.error}
            <div class="mt-4">
              <Button on:click={resetCompression} variant="outline" class="w-full sm:w-auto">Try Again</Button>
            </div>
          </Alert>
        {:else}
          <!-- Progress Bar -->
          <div class="mb-2">
            <div class="flex justify-between items-center mb-1">
              <p class="font-medium text-sm text-gray-200">{compressionProgress.status || 'Processing...'}</p>
              {#if compressionProgress.percentage > 0 && compressionProgress.percentage < 100}
                <Button on:click={resetCompression} variant="outline" size="sm" class="text-red-400 hover:text-red-300">
                  Cancel
                </Button>
              {/if}
            </div>
            <div class="w-full bg-gray-700 rounded-full h-2.5 overflow-hidden">
              <div
                class="bg-gradient-to-r from-blue-500 to-purple-500 h-2.5 rounded-full transition-all duration-300 ease-out"
                style="width: {compressionProgress.percentage || 0}%"
              ></div>
            </div>
          </div>

          {#if compressionProgress.percentage === 100}
            <!-- Completion Results -->
            <div class="p-4 bg-gray-700 border border-green-600 rounded-md animate-fade-in">
              <h3 class="font-bold text-lg text-green-400 mb-3 text-center">Compression Complete!</h3>
              <div class="grid grid-cols-2 gap-x-4 gap-y-2 mb-4 text-sm">
                <div>
                  <p class="text-gray-400">Original Size:</p>
                  <p class="font-medium text-gray-100">{formatFileSize(compressionProgress.stats.originalSize)}</p>
                </div>
                <div>
                  <p class="text-gray-400">Compressed Size:</p>
                  <p class="font-medium text-gray-100">{formatFileSize(compressionProgress.stats.compressedSize)}</p>
                </div>
                <div>
                  <p class="text-gray-400">Space Saved:</p>
                  <p class="font-medium text-green-400">{formatFileSize(compressionProgress.stats.savedSize)}</p>
                </div>
                <div>
                  <p class="text-gray-400">Reduction:</p>
                  <p class="font-medium text-green-400">{compressionProgress.stats.savedPercentage}%</p>
                </div>
              </div>
              <div class="flex flex-col sm:flex-row gap-3 justify-center mt-4">
                {#each files as file}
                  {#if file.compressed}
                    <a
                      href={file.compressedUrl}
                      download={file.compressedName}
                      class="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 text-center flex items-center justify-center"
                    >
                      Download Compressed File
                    </a>
                  {/if}
                {/each}
                <Button on:click={resetCompression} variant="outline" size="lg" classList="w-full sm:w-auto">Compress Another File</Button>
              </div>
            </div>
          {/if}
        {/if}
      </div>
    {/if}
  </div>
</Container> 