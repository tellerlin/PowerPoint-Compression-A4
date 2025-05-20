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
  import { themeStore } from '$lib/stores/theme';

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
  let currentFFmpegProcess = null;
  let audioFile = null;
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
  let audioPlayer = null;
  let audioDuration = 0;
  let currentTime = 0;
  let waveformCanvas = null;
  let waveformData = null;
  let showLoadingMessage = true;

  // Theme tracking
  let currentTheme;
  $: currentTheme = $themeStore;
  $: console.log('[AudioCompressor] Theme changed to:', currentTheme);

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
          // Monitor progress information
          if (message.includes('time=')) {
            const timeMatch = message.match(/time=(\d+):(\d+):(\d+.\d+)/);
            if (timeMatch) {
              const hours = parseInt(timeMatch[1]);
              const minutes = parseInt(timeMatch[2]);
              const seconds = parseFloat(timeMatch[3]);
              const currentTime = hours * 3600 + minutes * 60 + seconds;
              
              // Calculate progress percentage
              if (audioDuration > 0) {
                const progress = Math.min(95, Math.max(5, (currentTime / audioDuration) * 90));
                compressionProgress.percentage = Math.round(progress * 10) / 10;
                compressionProgress.status = `Compressing... ${Math.round(progress)}%`;
              }
            }
          }
          // Log error messages
          if (message.includes('Error') || message.includes('error')) {
            console.error('[FFmpeg]', message);
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
            showLoadingMessage = false;
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
    console.log('[AudioCompressor] Files selected:', selectedFiles.map(f => ({
      name: f.name,
      size: f.size
    })));
    
    // Create new file objects with additional properties
    const processedFiles = selectedFiles.map(file => {
      const url = URL.createObjectURL(file);
      return {
        file, // Keep reference to original file
        name: file.name,
        size: file.size,
        originalSize: file.size,
        originalUrl: url,
        type: file.type,
        lastModified: file.lastModified
      };
    });
    
    files = [...files, ...processedFiles];
    audioFile = processedFiles[0];
    
    // Set initial time
    if (files.length > 0) {
      console.log('[AudioCompressor] Creating audio element to get duration');
      const audio = new Audio();
      audio.src = files[0].originalUrl;
      
      audio.addEventListener('loadedmetadata', () => {
        console.log('[AudioCompressor] Audio metadata loaded, duration:', audio.duration);
        audioDuration = audio.duration;
      });
      
      // Ensure loading starts
      audio.load();
    }
    
    await processFiles(processedFiles);
  }

  // 格式化时间函数 - 修改为返回FFmpeg兼容的格式
  function formatTime(seconds) {
    if (isNaN(seconds)) return "00:00:00";
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.round((seconds % 1) * 10) / 10; // 保留1位小数
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().split('.')[1] || '0'}`;
  }

  // 将秒数转换为FFmpeg兼容的时间字符串
  function formatFFmpegTime(seconds) {
    if (isNaN(seconds)) return "00:00:00";
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.round((seconds % 1) * 1000); // 转换为毫秒
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
  }

  async function processFiles(newFiles) {
    console.log('[AudioCompressor] Processing files:', newFiles.map(f => ({
      name: f.name,
      size: f.size,
      originalSize: f.originalSize
    })));
    if (!isFFmpegLoaded) {
      console.log('[AudioCompressor] FFmpeg not loaded, showing alert');
      alert('FFmpeg is not loaded. Please wait for it to load or refresh the page.');
      return;
    }
    
    // Check if files can be read
    if (newFiles.length === 0) {
      console.log('[AudioCompressor] No files to process');
      return;
    }
    
    isProcessing = true;
    shouldCancel = false;
    compressionProgress.percentage = 0;
    compressionProgress.status = 'Starting compression...';
    compressionProgress.error = null;

    for (const fileObj of newFiles) {
      if (shouldCancel) {
        console.log('[AudioCompressor] Compression cancelled by user');
        break;
      }

      try {
        console.log('[AudioCompressor] Processing file:', fileObj.name);
        console.log('[AudioCompressor] File size:', fileObj.size);
        
        compressionProgress.status = `Processing ${fileObj.name}...`;
        compressionProgress.stats.originalSize = fileObj.originalSize;
        
        const inFileName = `in_${Math.random().toString(36).substring(2, 15)}.mp3`;
        const outFileName = `out_${Math.random().toString(36).substring(2, 15)}.mp3`;
        
        console.log('[AudioCompressor] Writing file to FFmpeg with name:', inFileName);
        
        const fileArrayBuffer = await fileObj.file.arrayBuffer();
        const fileData = new Uint8Array(fileArrayBuffer);
        
        try {
          if (shouldCancel) break;
          ffmpeg.FS('writeFile', inFileName, fileData);
          compressionProgress.percentage = 5;
          compressionProgress.status = 'File loaded, starting compression...';
        } catch (writeError) {
          console.error('[AudioCompressor] Error writing file to FFmpeg:', writeError);
          throw new Error(`Failed to write file to FFmpeg: ${writeError.message}`);
        }
        
        try {
          if (shouldCancel) break;
          console.log('[AudioCompressor] Executing FFmpeg command');
          let args = ['-i', inFileName];
          
          // Add compression settings
          args.push('-b:a', '40k', outFileName);
          
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
          
          compressionProgress.percentage = 90;
          compressionProgress.status = 'Compression complete, preparing file...';
          
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
          compressionProgress.percentage = 95;
          compressionProgress.status = 'Reading compressed file...';
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

        const fileIndex = files.findIndex(f => f.name === fileObj.name);
        if (fileIndex !== -1) {
          console.log('[AudioCompressor] Updating file state:', {
            name: fileObj.name,
            originalSize: fileObj.originalSize,
            compressedSize: blob.size
          });
          files[fileIndex] = {
            ...files[fileIndex],
            compressed: true,
            compressedUrl: url,
            compressedName: `compressed-${fileObj.name}`,
            compressedSize: blob.size
          };
        }

        compressionProgress.stats.compressedSize = blob.size;
        compressionProgress.stats.originalSize = fileObj.originalSize;
        compressionProgress.stats.savedSize = fileObj.originalSize - blob.size;
        compressionProgress.stats.savedPercentage = ((fileObj.originalSize - blob.size) / fileObj.originalSize * 100).toFixed(1);
        compressionProgress.percentage = 100;
        compressionProgress.status = 'Compression complete!';
      } catch (error) {
        console.error('[AudioCompressor] Error processing file:', {
          file: fileObj.name,
          error,
          stack: error.stack,
          message: error.message
        });
        if (shouldCancel) {
          compressionProgress.error = 'Compression cancelled by user';
        } else {
          compressionProgress.error = `Error processing file ${fileObj.name}: ${error.message}`;
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
    if (!bytes || isNaN(bytes)) return '0 KB';
    
    if (bytes >= 1073741824) {
      return (bytes / 1073741824).toFixed(2) + ' GB';
    } else if (bytes >= 1048576) {
      return (bytes / 1048576).toFixed(2) + ' MB';
    } else {
      return (bytes / 1024).toFixed(2) + ' KB';
    }
  }

  function resetCompression() {
    console.log('[AudioCompressor] Resetting compression');
    shouldCancel = true;
    if (currentFFmpegProcess) {
      try {
        console.log('[AudioCompressor] Terminating FFmpeg process');
        ffmpeg.exit();
        currentFFmpegProcess = null;
      } catch (e) {
        console.warn('[AudioCompressor] Error terminating FFmpeg:', e);
      }
    }
    
    // Reset FFmpeg instance
    ffmpeg = null;
    isFFmpegLoaded = false;
    
    // Reset state
    files = [];
    audioFile = null;
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

    // Reload FFmpeg
    console.log('[AudioCompressor] Reloading FFmpeg');
    setTimeout(() => {
      checkFFmpegAvailability();
    }, 100);
  }
</script>

<Container size="lg" class_="py-8">
  <div class="rounded-lg shadow-md p-6 mb-6 bg-surface">
    {#if !audioFile}
      <!-- File Upload Area -->
      <div class="border-2 border-dashed border-border rounded-lg p-8 text-center hover:border-primary transition-colors">
        <input
          type="file"
          id="file-upload"
          accept="audio/*"
          on:change={handleFileSelect}
          class="hidden"
        />
        <label for="file-upload" class="cursor-pointer">
          <div class="flex flex-col items-center justify-center">
            <svg class="w-12 h-12 text-muted mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"></path>
            </svg>
            <p class="mt-2 text-base text-text font-semibold">Click or drag audio file here</p>
            <p class="text-xs text-muted mt-1">Supports MP3, WAV, OGG formats</p>
          </div>
        </label>
      </div>
    {:else}
      <!-- Audio Player and Controls -->
      <div class="space-y-6">
        <!-- Audio Player -->
        <div class="bg-surface/70 border border-border p-4 rounded-lg">
          <audio
            controls
            class="w-full"
            src={audioFile.originalUrl}
            bind:this={audioPlayer}
            on:timeupdate={() => {
              currentTime = audioPlayer.currentTime;
            }}
          ></audio>
        </div>

        <!-- Progress Bar -->
        {#if isProcessing || compressionProgress.percentage > 0}
          <div class="bg-surface/70 border border-border p-4 rounded-lg">
            <div class="mb-2">
              <div class="flex justify-between items-center mb-1">
                <p class="font-medium text-sm text-text">{compressionProgress.status || 'Processing...'}</p>
                {#if compressionProgress.percentage > 0 && compressionProgress.percentage < 100}
                  <p class="text-xs text-muted">{compressionProgress.percentage}%</p>
                {/if}
              </div>
              <div class="w-full bg-border/50 rounded-full h-2.5 overflow-hidden">
                <div
                  class="bg-gradient-to-r from-primary to-secondary h-2.5 rounded-full transition-all duration-300 ease-out"
                  style="width: {compressionProgress.percentage}%"
                ></div>
              </div>
            </div>

            {#if compressionProgress.error}
              <Alert variant="destructive" title="Error">
                {compressionProgress.error}
              </Alert>
            {/if}

            {#if compressionProgress.percentage === 100 && !compressionProgress.error}
              <div class="mt-4 p-4 bg-surface/70 border border-primary/50 rounded-md animate-fade-in">
                <h3 class="font-bold text-lg text-primary mb-3 text-center">Compression Complete!</h3>
                <div class="grid grid-cols-2 gap-x-4 gap-y-2 mb-4 text-sm">
                  <div>
                    <p class="text-muted">Original Size:</p>
                    <p class="font-medium text-text">{formatFileSize(compressionProgress.stats.originalSize)}</p>
                  </div>
                  <div>
                    <p class="text-muted">Compressed Size:</p>
                    <p class="font-medium text-text">{formatFileSize(compressionProgress.stats.compressedSize)}</p>
                  </div>
                  <div>
                    <p class="text-muted">Space Saved:</p>
                    <p class="font-medium text-primary">{formatFileSize(compressionProgress.stats.savedSize)}</p>
                  </div>
                  <div>
                    <p class="text-muted">Reduction:</p>
                    <p class="font-medium text-primary">{compressionProgress.stats.savedPercentage}%</p>
                  </div>
                </div>
                <div class="flex flex-col sm:flex-row gap-3 justify-center mt-4">
                  <Button 
                    on:click={() => {
                      const fileIndex = files.findIndex(f => f.compressed);
                      if (fileIndex !== -1 && files[fileIndex].compressedUrl) {
                        const link = document.createElement('a');
                        link.href = files[fileIndex].compressedUrl;
                        link.download = files[fileIndex].compressedName;
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                      } else {
                        console.error('[AudioCompressor] No compressed file available for download');
                        compressionProgress.error = 'No compressed file available for download';
                      }
                    }} 
                    variant="default" 
                    size="lg" 
                    classList="w-full sm:w-auto"
                  >
                    Download Compressed File
                  </Button>
                  <Button on:click={resetCompression} variant="outline" size="lg" classList="w-full sm:w-auto">Compress Another File</Button>
                </div>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
  </div>
</Container> 