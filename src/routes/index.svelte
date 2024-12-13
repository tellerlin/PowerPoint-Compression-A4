<script>
  let progress = 0;
  let isCompressing = false;

  function compressFiles() {
    isCompressing = true;
    progress = 0;

    const interval = setInterval(() => {
      if (progress < 100) {
        progress += 10;
      } else {
        clearInterval(interval);
        isCompressing = false;
      }
    }, 1000);
  }
</script>

<style>
  .container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    background-color: #f9f9f9;
  }
  .upload-area {
    border: 2px dashed #ccc;
    padding: 20px;
    width: 300px;
    text-align: center;
    margin-bottom: 20px;
  }
  .button {
    padding: 10px 20px;
    background-color: #4CAF50;
    color: white;
    border: none;
    border-radius: 5px;
    cursor: pointer;
    font-size: 16px;
  }
  .progress-bar {
    width: 100%;
    background-color: #ccc;
    border-radius: 5px;
    overflow: hidden;
    margin-top: 20px;
  }
  .progress {
    height: 20px;
    background-color: #4CAF50;
    width: {progress}%;
    transition: width 0.5s;
  }
</style>

<div class="container">
  <h1>文件压缩工具</h1>
  <div class="upload-area">
    <p>拖放文件到这里或点击选择文件</p>
    <button class="button">选择文件</button>
  </div>
  <button class="button" on:click={compressFiles} disabled={isCompressing}>开始压缩</button>
  {#if isCompressing}
    <div class="progress-bar">
      <div class="progress"></div>
    </div>
    <p>压缩进度: {progress}%</p>
  {/if}
</div>
