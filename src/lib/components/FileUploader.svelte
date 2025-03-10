<script>
  // 现有代码...
  
  let dragActive = false;
  
  function handleDragEnter(e) {
    e.preventDefault();
    e.stopPropagation();
    dragActive = true;
  }
  
  function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    dragActive = false;
  }
  
  function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
  }
  
  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    dragActive = false;
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  }
</script>

<div 
  class="upload-area {dragActive ? 'drag-active' : ''}"
  on:dragenter={handleDragEnter}
  on:dragleave={handleDragLeave}
  on:dragover={handleDragOver}
  on:drop={handleDrop}
>
  <!-- 现有上传区域内容 -->
  {#if dragActive}
    <div class="drag-overlay">
      <span>释放文件以上传</span>
    </div>
  {/if}
</div>

<style>
  .upload-area {
    position: relative;
    /* 现有样式 */
  }
  
  .drag-active {
    border-color: rgb(var(--primary));
    background-color: rgba(var(--primary), 0.05);
  }
  
  .drag-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: rgba(var(--background), 0.8);
    border: 2px dashed rgb(var(--primary));
    border-radius: 0.5rem;
    z-index: 10;
  }
</style>