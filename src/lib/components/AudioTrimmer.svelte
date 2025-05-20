<!-- Audio Trimmer Component -->
<script>
  import { onMount } from 'svelte';
  import { Button } from '$lib/components/ui/Button';
  import { Alert } from '$lib/components/ui/Alert';
  import { Container } from '$lib/components/ui';
  import { createEventDispatcher } from 'svelte';

  const dispatch = createEventDispatcher();

  let ffmpeg = null;
  let audioFile = null;
  let audioElement = null;
  let audioDuration = 0;
  let isProcessing = false;
  let isFFmpegLoaded = false;
  let shouldCancel = false;
  let currentFFmpegProcess = null;
  let loadStarted = false;
  let downloadUrl = null;
  let downloadFileName = null;
  
  let trimSettings = {
    startTime: 0,
    endTime: 0,
    isEnabled: true
  };

  let processingProgress = {
    percentage: 0,
    status: '',
    error: null,
    stats: {
      originalSize: 0,
      trimmedSize: 0,
      savedSize: 0,
      savedPercentage: 0
    }
  };

  // Handle time input changes
  function handleTimeChange(type, value) {
    if (type === 'start') {
      trimSettings.startTime = Math.min(Math.max(0, value), trimSettings.endTime - 1);
    } else {
      trimSettings.endTime = Math.max(Math.min(audioDuration, value), trimSettings.startTime + 1);
    }
  }

  // Handle timeline drag
  let isDragging = false;
  let dragType = null;
  let dragStartX = 0;
  let timelineWidth = 0;
  let timelineElement = null;

  function handleTimelineMouseDown(e, type) {
    isDragging = true;
    dragType = type;
    dragStartX = e.clientX;
    timelineWidth = timelineElement.offsetWidth;
  }

  function handleTimelineMouseMove(e) {
    if (!isDragging) return;
    
    const deltaX = e.clientX - dragStartX;
    const timeDelta = (deltaX / timelineWidth) * audioDuration;
    
    if (dragType === 'start') {
      const newStartTime = Math.min(Math.max(0, trimSettings.startTime + timeDelta), trimSettings.endTime - 1);
      trimSettings.startTime = newStartTime;
    } else {
      const newEndTime = Math.max(Math.min(audioDuration, trimSettings.endTime + timeDelta), trimSettings.startTime + 1);
      trimSettings.endTime = newEndTime;
    }
    
    dragStartX = e.clientX;
  }

  function handleTimelineMouseUp() {
    isDragging = false;
    dragType = null;
  }

  // 注入FFmpeg脚本
  async function injectFFmpegScript() {
    if (!document.getElementById('ffmpeg-script')) {
      console.log('[AudioTrimmer] Injecting FFmpeg script');
      const script = document.createElement('script');
      script.id = 'ffmpeg-script';
      script.src = '/ffmpeg/ffmpeg.min.js';
      script.async = true;
      script.onload = () => {
        console.log('[AudioTrimmer] FFmpeg script loaded');
        checkFFmpegAvailability();
      };
      document.head.appendChild(script);
    } else {
      checkFFmpegAvailability();
    }
  }

  // 检查FFmpeg可用性
  async function checkFFmpegAvailability() {
    console.log('[AudioTrimmer] Checking FFmpeg availability');
    if (typeof window.createFFmpeg === 'function' || typeof window.FFmpeg?.createFFmpeg === 'function') {
      const createFFmpegFn = window.createFFmpeg || window.FFmpeg?.createFFmpeg;
      console.log('[AudioTrimmer] Creating FFmpeg instance');
      ffmpeg = createFFmpegFn({
        log: true,
        corePath: '/ffmpeg/ffmpeg-core.js',
        logger: ({ message }) => {
          // Only log errors and progress information
          if (message.includes('Error') || message.includes('error')) {
            console.error('[FFmpeg]', message);
          } else if (message.includes('time=') || message.includes('frame=')) {
            console.log('[FFmpeg]', message);
          }
        }
      });

      try {
        console.log('[AudioTrimmer] Loading FFmpeg');
        await ffmpeg.load();
        
        // 测试FFmpeg可用性
        try {
          const testFileName = 'test.txt';
          const testData = new Uint8Array([116, 101, 115, 116]); // ASCII for "test"
          ffmpeg.FS('writeFile', testFileName, testData);
          const readData = ffmpeg.FS('readFile', testFileName);
          ffmpeg.FS('unlink', testFileName);
          
          if (readData.length === testData.length) {
            console.log('[AudioTrimmer] FFmpeg filesystem test successful');
            isFFmpegLoaded = true;
          } else {
            console.error('[AudioTrimmer] FFmpeg filesystem test failed');
            isFFmpegLoaded = false;
          }
        } catch (fsError) {
          console.error('[AudioTrimmer] FFmpeg filesystem test error:', fsError);
          isFFmpegLoaded = false;
        }
        
      } catch (error) {
        console.error('[AudioTrimmer] Error loading FFmpeg:', error);
        isFFmpegLoaded = false;
      }
    } else {
      console.error('[AudioTrimmer] FFmpeg not available');
      isFFmpegLoaded = false;
    }
  }

  // Initialize audio player
  onMount(() => {
    console.log('[AudioTrimmer] Component mounted');
    audioElement = new Audio();
    audioElement.addEventListener('loadedmetadata', () => {
      console.log('[AudioTrimmer] Audio metadata loaded, duration:', audioElement.duration);
      audioDuration = audioElement.duration;
      trimSettings.endTime = audioDuration;
    });

    // Add global mouse event listeners
    window.addEventListener('mousemove', handleTimelineMouseMove);
    window.addEventListener('mouseup', handleTimelineMouseUp);
    console.log('[AudioTrimmer] Global event listeners added');

    // 加载FFmpeg
    if (!loadStarted) {
      loadStarted = true;
      console.log('[AudioTrimmer] Starting FFmpeg load');
      injectFFmpegScript();
    }
  });

  // Handle file selection
  async function handleFileSelect(event) {
    console.log('[AudioTrimmer] File selection handler called');
    const file = event.target.files[0];
    if (!file) {
      console.log('[AudioTrimmer] No file selected');
      return;
    }

    console.log('[AudioTrimmer] File selected:', {
      name: file.name,
      type: file.type,
      size: file.size
    });

    audioFile = file;
    const url = URL.createObjectURL(file);
    audioElement.src = url;
    audioElement.load();
    console.log('[AudioTrimmer] Audio element loaded with file');
  }

  // Format time display
  function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  // 格式化文件大小
  function formatFileSize(bytes) {
    if (bytes >= 1073741824) {
      return (bytes / 1073741824).toFixed(2) + ' GB';
    } else if (bytes >= 1048576) {
      return (bytes / 1048576).toFixed(2) + ' MB';
    } else {
      return (bytes / 1024).toFixed(2) + ' KB';
    }
  }

  // Reset all states
  function resetState() {
    audioFile = null;
    audioElement.src = '';
    audioDuration = 0;
    downloadUrl = null;
    downloadFileName = null;
    trimSettings = {
      startTime: 0,
      endTime: 0,
      isEnabled: true
    };
    processingProgress = {
      percentage: 0,
      status: '',
      error: null,
      stats: {
        originalSize: 0,
        trimmedSize: 0,
        savedSize: 0,
        savedPercentage: 0
      }
    };
  }

  // Process audio trimming
  async function processAudio() {
    console.log('[AudioTrimmer] Starting audio trimming process');
    console.log('[AudioTrimmer] Current state:', {
      audioFile: audioFile?.name,
      isFFmpegLoaded,
      trimSettings,
      audioDuration
    });

    if (!audioFile) {
      console.error('[AudioTrimmer] No audio file selected');
      processingProgress.error = 'Please select an audio file first';
      return;
    }

    if (!isFFmpegLoaded) {
      console.error('[AudioTrimmer] FFmpeg not loaded');
      processingProgress.error = 'FFmpeg not loaded, please try again later';
      return;
    }

    isProcessing = true;
    processingProgress.percentage = 0;
    processingProgress.status = 'Starting audio processing...';
    processingProgress.error = null;
    processingProgress.stats.originalSize = audioFile.size;
    downloadUrl = null;
    downloadFileName = null;

    try {
      const inFileName = `in_${Math.random().toString(36).substring(2, 15)}.mp3`;
      const outFileName = `out_${Math.random().toString(36).substring(2, 15)}.mp3`;

      console.log('[AudioTrimmer] Writing input file:', inFileName);
      // Write input file
      const fileArrayBuffer = await audioFile.arrayBuffer();
      const fileData = new Uint8Array(fileArrayBuffer);
      ffmpeg.FS('writeFile', inFileName, fileData);
      console.log('[AudioTrimmer] Input file written successfully');
      processingProgress.percentage = 10;
      processingProgress.status = 'Processing audio...';

      // Prepare FFmpeg command
      const args = [
        '-i', inFileName,
        '-ss', trimSettings.startTime.toString(),
        '-to', trimSettings.endTime.toString(),
        '-c:a', 'libmp3lame',
        '-q:a', '2',
        outFileName
      ];

      console.log('[AudioTrimmer] Executing FFmpeg command with args:', args);
      
      // Add progress tracking
      let lastProgress = 10;
      const progressInterval = setInterval(() => {
        if (lastProgress < 90) {
          lastProgress += 1;
          processingProgress.percentage = lastProgress;
        }
      }, 100);

      // Execute FFmpeg command
      currentFFmpegProcess = ffmpeg.run(...args);
      await currentFFmpegProcess;
      clearInterval(progressInterval);
      
      console.log('[AudioTrimmer] FFmpeg command executed successfully');
      processingProgress.percentage = 90;
      processingProgress.status = 'Generating output file...';

      console.log('[AudioTrimmer] Reading output file:', outFileName);
      // Read output file
      const outputData = ffmpeg.FS('readFile', outFileName);
      const blob = new Blob([outputData.buffer], { type: 'audio/mp3' });
      downloadUrl = URL.createObjectURL(blob);
      downloadFileName = `trimmed_${audioFile.name}`;
      console.log('[AudioTrimmer] Output file read successfully, size:', blob.size);

      // Clean up
      console.log('[AudioTrimmer] Cleaning up temporary files');
      ffmpeg.FS('unlink', inFileName);
      ffmpeg.FS('unlink', outFileName);

      // Update statistics
      processingProgress.stats.trimmedSize = blob.size;
      processingProgress.stats.savedSize = audioFile.size - blob.size;
      processingProgress.stats.savedPercentage = ((audioFile.size - blob.size) / audioFile.size * 100).toFixed(1);

      processingProgress.status = 'Audio processing complete!';
      processingProgress.percentage = 100;
      console.log('[AudioTrimmer] Process completed successfully');

      // Trigger download complete event
      dispatch('trimComplete', {
        url: downloadUrl,
        fileName: downloadFileName,
        stats: processingProgress.stats
      });

    } catch (error) {
      console.error('[AudioTrimmer] Error processing audio:', error);
      processingProgress.error = `Processing error: ${error.message}`;
    } finally {
      isProcessing = false;
      currentFFmpegProcess = null;
      console.log('[AudioTrimmer] Process finished, isProcessing:', isProcessing);
    }
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
            src={audioElement.src}
            on:timeupdate={() => {
              if (audioElement.currentTime >= trimSettings.endTime) {
                audioElement.pause();
                audioElement.currentTime = trimSettings.startTime;
              }
            }}
          ></audio>
        </div>

        <!-- Trim Controls -->
        <div class="bg-surface/70 border border-border p-4 rounded-lg">
          <h3 class="text-lg font-semibold text-text mb-4">Trim Settings</h3>
          
          <!-- Visual Timeline -->
          <div class="mb-6">
            <div class="flex justify-between text-sm text-muted mb-2">
              <span>Start: {formatTime(trimSettings.startTime)}</span>
              <span>End: {formatTime(trimSettings.endTime)}</span>
              <span>Duration: {formatTime(trimSettings.endTime - trimSettings.startTime)}</span>
            </div>
            
            <div 
              class="relative h-8 bg-border/30 rounded-lg cursor-pointer"
              bind:this={timelineElement}
            >
              <!-- Background waveform visualization (placeholder) -->
              <div class="absolute inset-0 flex items-center justify-center text-muted">
                Audio Waveform
              </div>
              
              <!-- Selected range -->
              <div
                class="absolute h-full bg-primary/30 rounded-lg"
                style="left: {(trimSettings.startTime / audioDuration) * 100}%; right: {100 - (trimSettings.endTime / audioDuration) * 100}%"
              ></div>
              
              <!-- Start handle -->
              <div
                role="slider"
                tabindex="0"
                aria-label="Start time slider"
                aria-valuemin="0"
                aria-valuemax={audioDuration}
                aria-valuenow={trimSettings.startTime}
                class="absolute top-0 bottom-0 w-2 bg-primary rounded-l cursor-ew-resize hover:w-3 transition-all"
                style="left: {(trimSettings.startTime / audioDuration) * 100}%"
                on:mousedown={(e) => handleTimelineMouseDown(e, 'start')}
                on:keydown={(e) => {
                  if (e.key === 'ArrowLeft') {
                    handleTimeChange('start', trimSettings.startTime - 0.1);
                  } else if (e.key === 'ArrowRight') {
                    handleTimeChange('start', trimSettings.startTime + 0.1);
                  }
                }}
              >
                <div class="absolute -top-6 left-1/2 transform -translate-x-1/2 bg-surface px-2 py-1 rounded text-sm whitespace-nowrap border border-border">
                  {formatTime(trimSettings.startTime)}
                </div>
              </div>
              
              <!-- End handle -->
              <div
                role="slider"
                tabindex="0"
                aria-label="End time slider"
                aria-valuemin="0"
                aria-valuemax={audioDuration}
                aria-valuenow={trimSettings.endTime}
                class="absolute top-0 bottom-0 w-2 bg-primary rounded-r cursor-ew-resize hover:w-3 transition-all"
                style="left: {(trimSettings.endTime / audioDuration) * 100}%"
                on:mousedown={(e) => handleTimelineMouseDown(e, 'end')}
                on:keydown={(e) => {
                  if (e.key === 'ArrowLeft') {
                    handleTimeChange('end', trimSettings.endTime - 0.1);
                  } else if (e.key === 'ArrowRight') {
                    handleTimeChange('end', trimSettings.endTime + 0.1);
                  }
                }}
              >
                <div class="absolute -top-6 left-1/2 transform -translate-x-1/2 bg-surface px-2 py-1 rounded text-sm whitespace-nowrap border border-border">
                  {formatTime(trimSettings.endTime)}
                </div>
              </div>
            </div>
          </div>

          <!-- Action Buttons -->
          <div class="flex justify-center space-x-4">
            <Button
              on:click={processAudio}
              disabled={isProcessing}
              size="lg"
              class="bg-blue-500 hover:bg-blue-600"
            >
              {isProcessing ? 'Processing...' : 'Trim Audio'}
            </Button>
            <Button
              on:click={resetState}
              variant="outline"
              size="lg"
            >
              Reset
            </Button>
          </div>

          <!-- Progress/Error Display -->
          {#if isProcessing || processingProgress.error || processingProgress.percentage === 100}
            <div class="mt-4">
              {#if processingProgress.error}
                <Alert variant="destructive" title="Error">
                  {processingProgress.error}
                </Alert>
              {:else if processingProgress.percentage === 100}
                <!-- Completion interface -->
                <div class="bg-surface/70 p-4 border border-primary/50 rounded-md animate-fade-in">
                  <h3 class="font-bold text-lg text-primary mb-3 text-center">Audio Processing Complete!</h3>
                  <div class="grid grid-cols-2 gap-x-4 gap-y-2 mb-4 text-sm">
                    <div>
                      <p class="text-muted">Original Size:</p>
                      <p class="font-medium text-text">{formatFileSize(processingProgress.stats.originalSize)}</p>
                    </div>
                    <div>
                      <p class="text-muted">Processed Size:</p>
                      <p class="font-medium text-text">{formatFileSize(processingProgress.stats.trimmedSize)}</p>
                    </div>
                    <div>
                      <p class="text-muted">Space Saved:</p>
                      <p class="font-medium text-primary">{formatFileSize(processingProgress.stats.savedSize)}</p>
                    </div>
                    <div>
                      <p class="text-muted">Reduction:</p>
                      <p class="font-medium text-primary">{processingProgress.stats.savedPercentage}%</p>
                    </div>
                  </div>
                  <div class="flex flex-col sm:flex-row gap-3 justify-center mt-4">
                    <a
                      href={downloadUrl}
                      download={downloadFileName}
                      class="bg-primary text-white px-4 py-2 rounded hover:bg-primary/90 text-center flex items-center justify-center"
                    >
                      Download Processed File
                    </a>
                    <Button on:click={resetState} variant="outline" size="lg" classList="w-full sm:w-auto">
                      Process Another File
                    </Button>
                  </div>
                </div>
              {:else}
                <!-- 进度条 -->
                <div class="bg-surface/70 p-4 rounded-lg">
                  <div class="flex justify-between items-center mb-2">
                    <span class="text-text">{processingProgress.status}</span>
                    <span class="text-muted">{processingProgress.percentage}%</span>
                  </div>
                  <div class="w-full bg-border/50 rounded-full h-2">
                    <div
                      class="bg-primary h-2 rounded-full transition-all duration-300"
                      style="width: {processingProgress.percentage}%"
                    ></div>
                  </div>
                </div>
              {/if}
            </div>
          {/if}
        </div>
      </div>
    {/if}
  </div>
</Container> 