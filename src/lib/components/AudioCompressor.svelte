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
  let currentFFmpegProcess = null;
  let trimSettings = {
    startTime: 0,
    endTime: 0,
    isEnabled: false
  };
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
              const totalDuration = 4320;
              // Scale progress from 1% to 98% to avoid overlap with initial and final states
              const progress = 1 + (totalSeconds / totalDuration) * 97;
              
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
    
    // Reset trim settings
    trimSettings.startTime = 0;
    trimSettings.endTime = 0;
    audioDuration = 0;
    
    // Create URLs for each file
    selectedFiles.forEach(file => {
      const url = URL.createObjectURL(file);
      file.originalUrl = url;
    });
    
    files = [...files, ...selectedFiles];
    
    // Set initial time
    if (files.length > 0) {
      console.log('[AudioCompressor] Creating audio element to get duration');
      const audio = new Audio();
      audio.src = files[0].originalUrl;
      
      audio.addEventListener('loadedmetadata', () => {
        console.log('[AudioCompressor] Audio metadata loaded, duration:', audio.duration);
        audioDuration = audio.duration;
        
        // Set end time to audio duration
        trimSettings.endTime = audio.duration;
        console.log('[AudioCompressor] Set trimSettings.endTime =', trimSettings.endTime);
      });
      
      // Ensure loading starts
      audio.load();
    }
    
    await processFiles(selectedFiles);
  }

  // 格式化时间函数 - 修改为返回FFmpeg兼容的格式
  function formatTime(seconds) {
    if (isNaN(seconds)) return "00:00:00";
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  // 将秒数转换为FFmpeg兼容的时间字符串
  function formatFFmpegTime(seconds) {
    if (isNaN(seconds)) return "00:00:00";
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
  }

  async function processFiles(newFiles) {
    console.log('[AudioCompressor] Processing files:', newFiles.map(f => f.name));
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
    
    // Check if trim settings are valid
    if (trimSettings.isEnabled) {
      if (isNaN(trimSettings.startTime) || isNaN(trimSettings.endTime)) {
        console.error('[AudioCompressor] Invalid trim settings, disabling trimming');
        alert('Invalid trim settings. Please check the start and end times.');
        trimSettings.isEnabled = false;
      } else if (trimSettings.startTime >= trimSettings.endTime) {
        console.error('[AudioCompressor] Start time must be less than end time');
        alert('Start time must be less than end time.');
        return;
      }
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
        console.log('[AudioCompressor] Trim settings:', {
          isEnabled: trimSettings.isEnabled,
          startTime: trimSettings.startTime,
          endTime: trimSettings.endTime,
          audioDuration
        });
        
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
          compressionProgress.status = 'File loaded, starting compression...';
        } catch (writeError) {
          console.error('[AudioCompressor] Error writing file to FFmpeg:', writeError);
          throw new Error(`Failed to write file to FFmpeg: ${writeError.message}`);
        }
        
        try {
          if (shouldCancel) break;
          console.log('[AudioCompressor] Executing FFmpeg command');
          let args = ['-i', inFileName];
          
          // Add trim settings
          if (trimSettings.isEnabled && 
              !isNaN(trimSettings.startTime) && 
              !isNaN(trimSettings.endTime) && 
              trimSettings.endTime > trimSettings.startTime) {
            
            const startTimeStr = formatFFmpegTime(trimSettings.startTime);
            const endTimeStr = formatFFmpegTime(trimSettings.endTime);
            
            console.log('[AudioCompressor] Adding trim settings:', {
              startTime: trimSettings.startTime,
              endTime: trimSettings.endTime,
              startTimeStr,
              endTimeStr
            });
            
            args.push('-ss', startTimeStr);
            args.push('-to', endTimeStr);
          }
          
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

        <!-- Audio Trimming Controls -->
        <div class="mt-4 p-4 bg-gray-700 rounded-md">
          <div class="flex items-center justify-between mb-2">
            <label for="enable-trimming" class="text-gray-200 font-medium">Enable Audio Trimming</label>
            <input
              id="enable-trimming"
              type="checkbox"
              bind:checked={trimSettings.isEnabled}
              class="form-checkbox h-5 w-5 text-blue-500"
            />
          </div>
          
          {#if trimSettings.isEnabled}
            <!-- Audio player and waveform display container -->
            <div class="space-y-2">
              <!-- Hidden native audio player but keep functionality -->
              <audio
                bind:this={audioPlayer}
                src={files[0]?.originalUrl}
                on:timeupdate={() => {
                  currentTime = audioPlayer.currentTime;
                  if (audioPlayer.duration) {
                    audioDuration = audioPlayer.duration;
                  }
                  
                  // In trim mode, pause and reset to start time when reaching end time
                  if (trimSettings.isEnabled && audioPlayer.currentTime >= trimSettings.endTime) {
                    audioPlayer.pause();
                    audioPlayer.currentTime = trimSettings.startTime;
                  }
                }}
                on:loadedmetadata={() => {
                  if (audioPlayer.duration) {
                    audioDuration = audioPlayer.duration;
                    if (trimSettings.endTime === 0 || trimSettings.endTime > audioPlayer.duration) {
                      trimSettings.endTime = audioPlayer.duration;
                    }
                    console.log('[AudioCompressor] Audio loaded, duration:', audioPlayer.duration);
                  }
                }}
                class="hidden"
              ></audio>

              <!-- Waveform display -->
              <div class="relative h-20 bg-gray-800 rounded-md">
                <canvas
                  bind:this={waveformCanvas}
                  class="w-full h-full"
                ></canvas>
                
                <!-- Timeline -->
                <div class="absolute bottom-0 left-0 right-0 h-6 bg-gray-900 bg-opacity-50 flex items-center px-2">
                  <div class="flex-1 relative">
                    <div class="absolute top-0 left-0 right-0 h-0.5 bg-gray-600"></div>
                    <div class="absolute top-0 left-0 right-0 h-0.5 bg-blue-500" style="width: {(currentTime / audioDuration) * 100}%"></div>
                  </div>
                </div>
              </div>

              <!-- Custom progress bar - same width as waveform display -->
              <div 
                class="relative h-10 bg-gray-600 rounded-full cursor-pointer"
                role="slider"
                aria-label="Audio progress bar"
                aria-valuemin="0"
                aria-valuemax="100"
                aria-valuenow={audioDuration ? (currentTime / audioDuration) * 100 : 0}
                tabindex="0"
                on:click={(e) => {
                  if (audioPlayer && audioDuration) {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const clickPosition = e.clientX - rect.left;
                    const percentage = clickPosition / rect.width;
                    audioPlayer.currentTime = percentage * audioDuration;
                  }
                }}
                on:keydown={(e) => {
                  if (audioPlayer && audioDuration) {
                    if (e.key === 'ArrowRight') {
                      audioPlayer.currentTime = Math.min(audioPlayer.currentTime + 5, audioDuration);
                    } else if (e.key === 'ArrowLeft') {
                      audioPlayer.currentTime = Math.max(audioPlayer.currentTime - 5, 0);
                    }
                  }
                }}
              >
                <!-- Progress bar -->
                <div 
                  class="absolute top-0 left-0 h-full bg-blue-500 rounded-full"
                  style="width: {(currentTime / audioDuration) * 100}%"
                ></div>
                
                <!-- Start time marker -->
                <div 
                  class="absolute top-0 bottom-0 w-2 bg-green-500 rounded-full z-10"
                  role="slider"
                  aria-label="Start time marker"
                  aria-valuemin="0"
                  aria-valuemax={audioDuration}
                  aria-valuenow={trimSettings.startTime}
                  tabindex="0"
                  style="left: {(trimSettings.startTime / audioDuration) * 100}%"
                >
                  <div class="absolute bottom-full mb-1 text-xs text-green-400 whitespace-nowrap transform -translate-x-1/2">
                    {formatTime(trimSettings.startTime)}
                  </div>
                </div>
                
                <!-- End time marker -->
                <div 
                  class="absolute top-0 bottom-0 w-2 bg-red-500 rounded-full z-10"
                  role="slider"
                  aria-label="End time marker"
                  aria-valuemin="0"
                  aria-valuemax={audioDuration}
                  aria-valuenow={trimSettings.endTime}
                  tabindex="0"
                  style="left: {(trimSettings.endTime / audioDuration) * 100}%"
                >
                  <div class="absolute bottom-full mb-1 text-xs text-red-400 whitespace-nowrap transform -translate-x-1/2">
                    {formatTime(trimSettings.endTime)}
                  </div>
                </div>
              </div>
              
              <!-- 播放控制和音量 -->
              <div class="flex items-center space-x-4 mt-2">
                <!-- 播放/暂停按钮 -->
                <button
                  type="button"
                  on:click={() => {
                    if (audioPlayer) {
                      if (audioPlayer.paused) {
                        // 在裁剪模式下，从开始点开始播放
                        if (trimSettings.isEnabled) {
                          audioPlayer.currentTime = trimSettings.startTime;
                        }
                        audioPlayer.play();
                      } else {
                        audioPlayer.pause();
                      }
                    }
                  }}
                  class="w-10 h-10 flex items-center justify-center bg-blue-500 rounded-full text-white hover:bg-blue-600"
                  aria-label={audioPlayer?.paused ? "Play audio" : "Pause audio"}
                >
                  {#if audioPlayer?.paused}
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-6 h-6">
                      <path fill-rule="evenodd" d="M4.5 5.653c0-1.426 1.529-2.33 2.779-1.643l11.54 6.348c1.295.712 1.295 2.573 0 3.285L7.28 19.991c-1.25.687-2.779-.217-2.779-1.643V5.653z" clip-rule="evenodd" />
                    </svg>
                  {:else}
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-6 h-6">
                      <path fill-rule="evenodd" d="M6.75 5.25a.75.75 0 01.75-.75H9a.75.75 0 01.75.75v13.5a.75.75 0 01-.75.75H7.5a.75.75 0 01-.75-.75V5.25zm7.5 0A.75.75 0 0115 4.5h1.5a.75.75 0 01.75.75v13.5a.75.75 0 01-.75.75H15a.75.75 0 01-.75-.75V5.25z" clip-rule="evenodd" />
                    </svg>
                  {/if}
                </button>
                
                <!-- 时间显示 -->
                <div class="text-sm text-gray-300">
                  {formatTime(currentTime)} / {formatTime(audioDuration)}
                </div>
                
                <!-- 音量控制 -->
                <div class="flex items-center space-x-2">
                  <label for="volume-control" class="sr-only">Volume control</label>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5 text-gray-300">
                    <path d="M13.5 4.06c0-1.336-1.616-2.005-2.56-1.06l-4.5 4.5H4.508c-1.141 0-2.318.664-2.66 1.905A9.76 9.76 0 001.5 12c0 .898.121 1.768.35 2.595.341 1.24 1.518 1.905 2.659 1.905h1.93l4.5 4.5c.945.945 2.561.276 2.561-1.06V4.06zM18.584 5.106a.75.75 0 011.06 0c3.808 3.807 3.808 9.98 0 13.788a.75.75 0 11-1.06-1.06 8.25 8.25 0 000-11.668.75.75 0 010-1.06z" />
                    <path d="M15.932 7.757a.75.75 0 011.061 0 6 6 0 010 8.486.75.75 0 01-1.06-1.061 4.5 4.5 0 000-6.364.75.75 0 010-1.06z" />
                  </svg>
                  <input
                    id="volume-control"
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value="1"
                    on:input={(e) => {
                      if (audioPlayer) {
                        audioPlayer.volume = e.target.value;
                      }
                    }}
                    class="w-20"
                  />
                </div>
              </div>

              <!-- Time Controls -->
              <div class="grid grid-cols-2 gap-4 mt-4">
                <div>
                  <label for="start-time-input" class="block text-sm text-gray-400 mb-1">Start Time</label>
                  <div class="flex items-center space-x-2">
                    <input
                      id="start-time-input"
                      type="number"
                      bind:value={trimSettings.startTime}
                      min="0"
                      step="0.1"
                      class="w-full px-3 py-2 bg-gray-600 text-gray-200 rounded-md"
                    />
                    <button
                      type="button"
                      on:click={() => {
                        trimSettings.startTime = currentTime;
                      }}
                      class="px-2 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
                    >
                      Set
                    </button>
                  </div>
                </div>
                <div>
                  <label for="end-time-input" class="block text-sm text-gray-400 mb-1">End Time</label>
                  <div class="flex items-center space-x-2">
                    <input
                      id="end-time-input"
                      type="number"
                      bind:value={trimSettings.endTime}
                      min="0"
                      step="0.1"
                      class="w-full px-3 py-2 bg-gray-600 text-gray-200 rounded-md"
                    />
                    <button
                      type="button"
                      on:click={() => {
                        trimSettings.endTime = currentTime;
                      }}
                      class="px-2 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
                    >
                      Set
                    </button>
                  </div>
                </div>
              </div>

              <!-- Time Display -->
              <div class="mt-2 text-sm text-gray-400">
                <p>Start: {formatTime(trimSettings.startTime)}</p>
                <p>End: {formatTime(trimSettings.endTime)}</p>
                <p>Duration: {formatTime(trimSettings.endTime - trimSettings.startTime)}</p>
              </div>
            </div>
          {/if}
        </div>

        <div class="mt-5 flex justify-center">
          <Button on:click={() => {
            // 重新验证裁剪设置
            if (trimSettings.isEnabled) {
              console.log('[AudioCompressor] Validating trim settings before compression');
              if (isNaN(trimSettings.startTime) || isNaN(trimSettings.endTime)) {
                alert('Invalid trim settings. Please check start and end times.');
                return;
              }
              if (trimSettings.startTime >= trimSettings.endTime) {
                alert('Start time must be less than end time.');
                return;
              }
              if (trimSettings.endTime > audioDuration) {
                console.log('[AudioCompressor] Adjusting end time to match audio duration');
                trimSettings.endTime = audioDuration;
              }
              
              console.log('[AudioCompressor] Trim settings validated:', {
                startTime: trimSettings.startTime,
                endTime: trimSettings.endTime,
                duration: trimSettings.endTime - trimSettings.startTime
              });
            }
            
            processFiles(files);
          }} size="lg">Start Compression</Button>
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