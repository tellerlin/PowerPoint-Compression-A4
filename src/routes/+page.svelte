<script>
  import { optimizePPTX } from '$lib/pptx/optimizer';
  import { createDownloadLink, cleanupDownload } from '$lib/utils/file';
  let files, processing = false, error = '';
  let progress = 0;

  async function handleSubmit() {
    const file = files?.[0];
    if (!file) return;
    processing = true;
    error = '';
    try {
      const optimizedBlob = await optimizePPTX(file, { compressImages: { quality: 0.7 }, removeHiddenSlides: true });
      const { url, a } = createDownloadLink(optimizedBlob, file.name);
      a.click();
      cleanupDownload(url);
    } catch (e) {
      error = e.message;
    } finally {
      processing = false;
    }
  }

  $: file = files?.[0];

  function handleFileUpload(event) {
    files = event.dataTransfer ? event.dataTransfer.files : event.target.files;
  }

  async function compressFiles() {
    if (!file) return;
    progress = 0; // 重置进度
    const interval = setInterval(() => {
      if (progress < 100) {
        progress += 10; // 模拟进度更新
      } else {
        clearInterval(interval);
        handleSubmit(); // 进度达到100%后触发文件下载
      }
    }, 1000);
  }
</script>

<nav>
  <h1>应用功能标题</h1>
</nav>

<main>
  <div class="upload-area" on:drop={handleFileUpload} on:dragover|preventDefault>
    <p>拖放文件到这里，或</p>
    <button on:click={() => document.getElementById('file-input').click()}>选择文件</button>
    <input type="file" id="file-input" style="display: none;" on:change={handleFileUpload} />
  </div>
  {#if error}
    <p class="text-red-500 text-sm">{error}</p>
  {/if}
  <button on:click={compressFiles} disabled={processing || !file} class="compress-button">压缩文件</button>
  <div class="progress-bar">
    <div class="progress" style="width: {progress}%;"></div>
  </div>
</main>

<style>
  nav {
    position: fixed;
    top: 0;
    width: 100%;
    background-color: #4A90E2;
    color: white;
    padding: 15px;
    text-align: center;
    font-size: 24px;
  }

  .upload-area {
    border: 2px dashed #4A90E2;
    border: 2px dashed #ccc;
    padding: 20px;
    text-align: center;
    margin-top: 60px; /* 留出导航栏的空间 */
  }

  .progress-bar {
    background-color: #f3f3f3;
    border-radius: 5px;
    overflow: hidden;
    margin-top: 20px;
  }

  .progress {
    height: 20px;
    background-color: #4caf50;
    transition: width 0.5s;
  }
</style>