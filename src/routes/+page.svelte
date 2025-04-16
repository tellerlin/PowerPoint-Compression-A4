<script>
  import { optimizePPTX } from '$lib/pptx/optimizer';
  import { ProgressManager, compressionProgress } from '$lib/pptx/progress';
  import { createDownloadLink, cleanupDownload } from '$lib/utils/file';
  import { Button } from '$lib/components/ui/Button';
  import { Alert } from '$lib/components/ui/Alert';
  import { Container } from '$lib/components/ui';
  import { browser } from '$app/environment';
  
  let files;
  let processing = false;
  let dragActive = false;
  let progressManager;
  let downloadUrl = null;
  let downloadLink = null;

  // Unified bytes formatting function
  function formatBytes(bytes, decimals = 2) {
    if (bytes === 0 || bytes === undefined) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    
    // Add safety check for negative or NaN values
    if (bytes < 0 || isNaN(bytes)) return '0 Bytes';
    
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  // Add a file change listener with error handling
  $: if (files) {
    try {
      console.log('Files changed:', files);
    } catch (error) {
      console.error('Error processing files:', error);
    }
  }

  $: fileName = files?.[0]?.name;
  $: fileInfo = $compressionProgress.fileInfo;
  $: compressionComplete = $compressionProgress.percentage === 100;
  
  // Keep only this declaration with the enhanced formatting logic
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
    
    processing = true;
    progressManager = new ProgressManager();
    
    try {
      let optimizedBlob;  // declare variable first
      
        optimizedBlob = await optimizePPTX(file, {
        compressImages: { quality: 0.9 },  // 将质量从0.8提高到0.9
        removeHiddenSlides: true,
        removeUnusedLayouts: true,  // Enable cleaning of unused layouts and masters
        cleanUnusedResources: true, // Enable cleaning of unused resources
        preprocessImages: {         // Add preprocessing options
          removeDuplicateImages: true,
          mergeSimilarImages: false // Temporarily disable similar image merging
        },
        debug: true, // 启用调试模式以获取详细日志
        logLevel: 'verbose', // 添加详细日志级别

        onProgress: (phase, detail) => {
          console.log(`Progress: ${phase}`, detail); // 保留调试日志
          switch (phase) {
            case 'fileInfo':
              progressManager.updateFileInfo(detail);
              break;
            case 'init':
              progressManager.updateInitProgress(detail.percentage);
              break;
            case 'mediaCount':
              progressManager.initializeCompression(detail.count);
              break;
            case 'media':
              // 计算处理进度百分比
              const percentage = detail.totalFiles > 0 
                ? Math.round((detail.fileIndex / detail.totalFiles) * 100) 
                : 0;
              
              // 更新已处理文件数
              progressManager.processedFiles = detail.fileIndex;
              
              // 调用更新进度方法
              progressManager.updateMediaProgress(percentage);
              break;
            case 'finalize':
              progressManager.updateFinalizationProgress(detail.status, detail.stats);
              break;
            case 'complete':
              // 确保 detail.stats 包含所有必要字段
              const completeStats = {
                ...detail.stats,
                originalSize: file.size, // 使用原始文件大小
                compressedSize: detail.stats.compressedSize || (file.size * (1 - detail.stats.savedPercentage / 100)),
                savedSize: detail.stats.savedSize || (file.size * detail.stats.savedPercentage / 100)
              };
              progressManager.completeCompression(completeStats);
              break;
            case 'error':
              // 添加错误处理
              console.error('Compression error:', detail.message);
              console.error('Error details:', detail.error);
              progressManager.handleError(detail.message || "处理失败", detail.percentage || 0);
              break;
          }
        }
      });
      
      if (!optimizedBlob) {
        throw new Error("Failed to generate compressed file");
      }
      
      // Create download link after successful compression
      const { url, a } = createDownloadLink(optimizedBlob, file.name);
      downloadUrl = url;
      downloadLink = a;
      
    } catch (error) {
      console.error("Compression error:", error);
      // 增强错误日志，记录更多详细信息
      console.error("Error details:", {
        name: error.name,
        message: error.message,
        stack: error.stack,
        phase: $compressionProgress.status,
        percentage: $compressionProgress.percentage
      });
      progressManager.handleError(error.message || "文件处理失败", $compressionProgress.percentage);
    }
  }

  // Add browser environment check
  function handleDownload() {
    if (typeof window === 'undefined' || !downloadLink || !downloadUrl) return;
    
    // Detect Safari browser
    const isSafari = typeof navigator !== 'undefined' && 
                    /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    
    if (isSafari) {
      // Special handling for Safari
      try {
        window.open(downloadUrl, '_blank');
      } catch (error) {
        console.error('Safari download failed:', error);
        // Fallback: direct link click
        downloadLink.click();
      }
    } else {
      // Normal handling for other browsers
      downloadLink.click();
    }
  }

  function resetCompression() {
    files = null;
    processing = false;
    if (downloadUrl) {
      cleanupDownload(downloadUrl);
      downloadUrl = null;
      downloadLink = null;
    }
    compressionProgress.set({
      percentage: 0,
      status: '',
      error: null,
      fileInfo: null,
      stats: {
        processedFiles: 0,
        totalFiles: 0,
        originalSize: 0,
        compressedSize: 0,
        savedSize: 0,
        savedPercentage: 0
      }
    });
    
    // 修改为仅在浏览器环境执行
    if (browser) {
      setTimeout(() => {
        const fileUpload = document.getElementById('file-upload');
        if (fileUpload) fileUpload.click();
      }, 100);
    }
  }
</script>

<!-- In the template section, update formatFileSize to formatBytes -->
<Container size="lg" class_="py-8">
  <div class="text-center mb-8">
    <h1 class="text-3xl font-bold mb-2 text-gray-100">PowerPoint Compression Tool</h1>
    <p class="text-gray-400">Reduce your PPTX file size without losing quality</p>
  </div>

  <div class="rounded-lg shadow-md p-6 mb-6 bg-gray-800">
    {#if !processing && !compressionComplete}
      <div class="border-2 border-dashed border-gray-600 rounded-lg p-8 text-center">
        <input 
          type="file" 
          id="file-upload" 
          accept=".pptx" 
          on:change={(e) => files = e.target.files} 
          class="hidden"
        />
        <label for="file-upload" class="cursor-pointer">
          <div class="flex flex-col items-center justify-center">
            <svg class="w-12 h-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path>
            </svg>
            <p class="mt-2 text-base text-gray-300">Click to Select PowerPoint File</p>
          </div>
        </label>
      </div>
      
      {#if files && files.length > 0}
        <div class="mt-4 p-4 bg-gray-700 rounded-md text-gray-200">
          <p class="font-medium">Selected file:</p>
          <p>{files[0].name} ({formatBytes(files[0].size)})</p>
        </div>
        
        <div class="mt-4 flex justify-center">
          <Button on:click={handleSubmit}>Start Compression</Button>
        </div>
      {/if}
    {:else}
      <div class="space-y-4">
        {#if $compressionProgress.error}
          <Alert type="error" title="Compression Error">
            {$compressionProgress.error}
            <div class="mt-4">
              <Button on:click={resetCompression}>Try Again</Button>
            </div>
          </Alert>
        {:else}
          <div class="mb-2">
            <p class="font-medium mb-1 text-gray-200">{$compressionProgress.status || 'Processing...'}</p>
            <div class="w-full bg-gray-700 rounded-full h-2.5">
              <div
                class="bg-blue-500 h-2.5 rounded-full transition-all duration-300"
                style="width: {$compressionProgress.percentage}%"
              ></div>
            </div>
          </div>
          
          {#if fileInfo}
            <div class="p-4 bg-gray-700 rounded-md text-gray-200">
              <p class="font-medium">File: {fileInfo.name}</p>
            </div>
          {/if}
          
          {#if compressionComplete}
            <div class="p-4 bg-gray-700 border border-green-600 rounded-md">
              <h3 class="font-bold text-green-400 mb-2">Compression Complete!</h3>
              <div class="grid grid-cols-2 gap-2 mb-3">
                <div>
                  <p class="text-sm text-gray-400">Original Size:</p>
                  <p class="font-medium text-gray-200">{compressionStats.formattedOriginalSize}</p>
                </div>
                <div>
                  <p class="text-sm text-gray-400">Compressed Size:</p>
                  <p class="font-medium text-gray-200">{compressionStats.formattedCompressedSize}</p>
                </div>
                <div>
                  <p class="text-sm text-gray-400">Space Saved:</p>
                  <p class="font-medium text-gray-200">{compressionStats.formattedSavedSize}</p>
                </div>
                <div>
                  <p class="text-sm text-gray-400">Reduction:</p>
                  <p class="font-medium text-gray-200">{compressionStats.savedPercentage}%</p>
                </div>
              </div>
              <div class="flex space-x-3">
                <Button on:click={handleDownload} variant="primary">Download Compressed File</Button>
                <Button on:click={resetCompression} variant="outline">Compress Another File</Button>
              </div>
            </div>
          {:else}
            <p class="text-sm text-gray-400 mt-2">
              {#if $compressionProgress.stats.totalFiles > 0}
                Processing {$compressionProgress.stats.processedFiles} of {$compressionProgress.stats.totalFiles} files
              {:else}
                Preparing files...
              {/if}
            </p>
          {/if}
        {/if}
      </div>
    {/if}
  </div>
</Container>