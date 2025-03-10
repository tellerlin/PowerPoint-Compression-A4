import { writable } from 'svelte/store';

// 进度存储，包含百分比和状态消息
export const compressionProgress = writable({
  percentage: 0,
  status: '',
  error: null,
  stats: {
    processedFiles: 0,
    totalFiles: 0,
    savedSpace: 0
  }
});

// 进度管理器类
export class ProgressManager {
  constructor() {
    this.mediaFilesCount = null;
    this.processedFiles = 0;
    this.currentPhase = 'init';
    this.savedSpace = 0;
    
    // 阶段权重
    this.phases = {
      init: { weight: 15, start: 0 },
      media: { weight: 60, start: 15 },
      finalize: { weight: 25, start: 75 }
    };
  }

  // 使用总文件数初始化压缩
  initializeCompression(totalFiles) {
    this.mediaFilesCount = totalFiles;
    this.processedFiles = 0;
    this.currentPhase = 'media';
    this.updateProgress(this.phases.init.weight, '开始处理媒体文件...');
  }

  // 更新初始化阶段的进度
  updateInitProgress(percentage) {
    const phase = this.phases.init;
    const actualProgress = (percentage / 100) * phase.weight;
    this.updateProgress(actualProgress, '初始化压缩过程...');
  }

  // 更新媒体处理阶段的进度
  updateMediaProgress(processedFile, fileName) {
    if (this.mediaFilesCount === null) {
      return;
    }
    this.processedFiles++;
    const phase = this.phases.media;
    const mediaProgress = (this.processedFiles / this.mediaFilesCount) * phase.weight;
    const totalProgress = this.phases.init.weight + mediaProgress;
    
    // 更新每个文件的处理进度
    this.updateProgress(
      totalProgress,
      `处理媒体文件 ${this.processedFiles}/${this.mediaFilesCount}: ${fileName}`
    );

    // 如果所有文件都处理完，更新到最终进度
    if (this.processedFiles === this.mediaFilesCount) {
      this.updateFinalizationProgress('正在完成...');
    }
  }

  // 更新最终阶段的进度
  updateFinalizationProgress(status) {
    const phase = this.phases.finalize;
    const baseProgress = this.phases.init.weight + this.phases.media.weight;
    const finalizeProgress = baseProgress + (phase.weight / 2);
    this.updateProgress(finalizeProgress, status);
  }

  // 完成压缩过程
  completeCompression(stats = {}) {
    this.updateProgress(100, `压缩成功完成！${stats.savedSpace ? `节省了 ${(stats.savedSpace / (1024 * 1024)).toFixed(2)}MB` : ''}`);
  }

  // 处理错误情况
  handleError(error, currentProgress) {
    compressionProgress.update(state => ({
      ...state,
      error: error.message,
      percentage: currentProgress
    }));
  }

  // 核心更新函数
  updateProgress(percentage, status) {
    compressionProgress.update(state => ({
      ...state,
      percentage: Math.min(Math.round(percentage * 100) / 100, 100),
      status,
      error: null,
      stats: {
        ...state.stats,
        processedFiles: this.processedFiles,
        totalFiles: this.mediaFilesCount || 0
      }
    }));
  }
}