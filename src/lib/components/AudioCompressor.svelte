<!-- 纯客户端音频压缩组件 -->
<script context="module">
  // 确保这个模块只在客户端执行
  export const prerender = false;
  console.log('[AudioCompressor] Module context initialized');
</script>

<script>
  import { onMount } from 'svelte';

  // 环境检查助手
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

  // 只在浏览器环境中加载 FFmpeg
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
        logger: ({ message }) => console.log('[FFmpeg]', message)
      });

      try {
        console.log('[AudioCompressor] Loading FFmpeg');
        await ffmpeg.load();
        
        // 测试 FFmpeg 的可用性
        try {
          const testFileName = 'test.txt';
          const testData = new Uint8Array([116, 101, 115, 116]); // "test" 的 ASCII 码
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
    for (const file of newFiles) {
      try {
        console.log('[AudioCompressor] Processing file:', file.name);
        
        // 使用简单的字母数字作为文件名
        const inFileName = `in_${Math.random().toString(36).substring(2, 15)}.mp3`;
        const outFileName = `out_${Math.random().toString(36).substring(2, 15)}.mp3`;
        
        console.log('[AudioCompressor] Writing file to FFmpeg with name:', inFileName);
        
        // 获取文件数据并上传到 FFmpeg 文件系统
        const fileArrayBuffer = await file.arrayBuffer();
        const fileData = new Uint8Array(fileArrayBuffer);
        
        // 尝试使用 try-catch 分别处理每个步骤
        try {
          ffmpeg.FS('writeFile', inFileName, fileData);
        } catch (writeError) {
          console.error('[AudioCompressor] Error writing file to FFmpeg:', writeError);
          throw new Error(`Failed to write file to FFmpeg: ${writeError.message}`);
        }
        
        // 执行 FFmpeg 命令
        try {
          console.log('[AudioCompressor] Executing FFmpeg command');
          const args = ['-i', inFileName, '-b:a', '40k', outFileName];
          console.log('[AudioCompressor] FFmpeg args:', args);
          await ffmpeg.run(...args);
        } catch (runError) {
          console.error('[AudioCompressor] Error running FFmpeg command:', runError);
          // 尝试清理输入文件
          try { ffmpeg.FS('unlink', inFileName); } catch (e) {}
          throw new Error(`Failed to process audio: ${runError.message}`);
        }
        
        // 读取输出文件
        let outputData;
        try {
          console.log('[AudioCompressor] Reading output file');
          outputData = ffmpeg.FS('readFile', outFileName);
        } catch (readError) {
          console.error('[AudioCompressor] Error reading output file:', readError);
          // 尝试清理文件
          try { ffmpeg.FS('unlink', inFileName); } catch (e) {}
          try { ffmpeg.FS('unlink', outFileName); } catch (e) {}
          throw new Error(`Failed to read processed file: ${readError.message}`);
        }
        
        // 创建 blob 和 URL
        const blob = new Blob([outputData.buffer], { type: 'audio/mp3' });
        const url = URL.createObjectURL(blob);
        
        // 清理临时文件
        try {
          ffmpeg.FS('unlink', inFileName);
          ffmpeg.FS('unlink', outFileName);
        } catch (cleanupError) {
          console.warn('[AudioCompressor] Error cleaning up temporary files:', cleanupError);
        }
        
        // 更新文件状态
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
      } catch (error) {
        console.error('[AudioCompressor] Error processing file:', {
          file: file.name,
          error,
          stack: error.stack,
          message: error.message
        });
        alert(`Error processing file ${file.name}: ${error.message}`);
      }
    }
    isProcessing = false;
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
</script>

{#if isBrowser}
  <div class="container mx-auto px-4 py-8">
    <h1 class="text-3xl font-bold mb-8">Audio Compression</h1>
    <div class="mb-8">
      <label class="block mb-4">
        <span class="text-gray-700">Select audio files</span>
        <input
          type="file"
          accept="audio/*,video/*"
          multiple
          on:change={handleFileSelect}
          class="mt-1 block w-full"
          disabled={isProcessing}
        />
      </label>
    </div>
    {#if files.length > 0}
      <div class="grid gap-4">
        {#each files as file, index}
          <div class="border rounded-lg p-4 flex items-center justify-between">
            <div class="flex-1">
              <h3 class="font-medium">{file.name}</h3>
              <p class="text-sm text-gray-600">
                Original size: {formatFileSize(file.size)}
                {#if file.compressed}
                  <span class="ml-2">Compressed: {formatFileSize(file.compressedSize)}</span>
                {/if}
              </p>
            </div>
            <div class="flex items-center space-x-4">
              {#if file.compressed}
                <a
                  href={file.compressedUrl}
                  download={file.compressedName}
                  class="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
                >
                  Download
                </a>
              {:else}
                <span class="text-gray-500">Processing...</span>
              {/if}
              <button
                on:click={() => removeFile(index)}
                class="text-red-500 hover:text-red-700"
              >
                Remove
              </button>
            </div>
          </div>
        {/each}
      </div>
    {:else}
      <div class="text-center text-gray-500">
        Please select audio files to compress
      </div>
    {/if}
  </div>
{:else}
  <!-- 服务器端渲染的占位符 -->
  <div class="container mx-auto px-4 py-8">
    <h1 class="text-3xl font-bold mb-8">Audio Compression</h1>
    <div class="text-center text-gray-500">
      Loading audio compression tool...
    </div>
  </div>
{/if} 