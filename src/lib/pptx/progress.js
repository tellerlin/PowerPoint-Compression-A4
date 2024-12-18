import { writable, derived } from 'svelte/store';

// Progress store with both percentage and status message
export const compressionProgress = writable({
  percentage: 0,
  status: '',
  error: null
});

// 可选：添加进度条基于阶段的衔接更流畅
export const detailedCompressionProgress = derived(compressionProgress, ($compressionProgress) => {
  // 自定义计算或转换
  return {
    ...$compressionProgress,
    // 例如，添加预计剩余时间等
  };
});

// Progress manager class
export class ProgressManager {
  constructor() {
    this.mediaFilesCount = null;
    this.processedFiles = 0;
    this.currentPhase = 'init';
    
    // Phase weightings
    this.phases = {
      init: { weight: 15, start: 0 },
      media: { weight: 60, start: 15 },
      finalize: { weight: 25, start: 75 }
    };
  }

  // Initialize compression with totalFiles
  initializeCompression(totalFiles) {
    this.mediaFilesCount = totalFiles;
    this.processedFiles = 0;
    this.currentPhase = 'media';
    this.updateProgress(this.phases.init.weight, '开始处理媒体文件...');
  }

  // Update progress for initialization phase
  updateInitProgress(percentage) {
    const phase = this.phases.init;
    const actualProgress = (percentage / 100) * phase.weight;
    this.updateProgress(actualProgress, '初始化压缩过程...');
  }

  // Update progress for media processing phase
  updateMediaProgress(processedFile, fileName) {
    if (this.mediaFilesCount === null) {
      console.warn('Media files count 未初始化');
      return;
    }
    this.processedFiles++;
    const phase = this.phases.media;
    const mediaProgress = (this.processedFiles / this.mediaFilesCount) * phase.weight;
    const totalProgress = this.phases.init.weight + mediaProgress;
    
    // 在处理每个文件时更新进度
    this.updateProgress(
      totalProgress,
      `处理媒体文件 ${this.processedFiles}/${this.mediaFilesCount}: ${fileName}`
    );

    // 如果所有文件都处理完，更新到最终进度
    if (this.processedFiles === this.mediaFilesCount) {
      this.updateFinalizationProgress('正在完成...');
    }
  }

  // Update progress for finalization phase
  updateFinalizationProgress(status) {
    const phase = this.phases.finalize;
    const baseProgress = this.phases.init.weight + this.phases.media.weight;
    const finalizeProgress = baseProgress + (phase.weight / 2);
    this.updateProgress(finalizeProgress, status);
  }

  // Complete the compression process
  completeCompression() {
    this.updateProgress(100, '压缩成功完成！');
  }

  // Handle error cases
  handleError(error, currentProgress) {
    compressionProgress.update(state => ({
      ...state,
      error: error.message,
      percentage: currentProgress
    }));
  }

  // Core update function
  updateProgress(percentage, status) {
    compressionProgress.update(state => ({
      ...state,
      percentage: Math.min(Math.round(percentage * 100) / 100, 100),
      status,
      error: null
    }));
  }
}