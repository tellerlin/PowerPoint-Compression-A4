import { writable } from 'svelte/store';

// Progress store with percentage and status message
export const compressionProgress = writable({
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

// Progress manager class
export class ProgressManager {
  constructor() {
    this.mediaFilesCount = null;
    this.processedFiles = 0;
    this.currentPhase = 'init';
    this.fileInfo = null;
    this.phaseStartTimes = {};
    this.phaseDurations = {};
    
    // Phase weights
    this.phases = {
      init: { weight: 15, start: 0 },
      media: { weight: 60, start: 15 },
      finalize: { weight: 25, start: 75 }
    };
    
    // 添加历史数据收集
    this.historicalData = {
      init: [],
      media: [],
      finalize: []
    };
  }
  
  // 记录阶段开始时间
  startPhase(phase) {
    this.currentPhase = phase;
    this.phaseStartTimes[phase] = Date.now();
  }
  
  // 记录阶段结束时间并调整权重
  endPhase(phase) {
    if (this.phaseStartTimes[phase]) {
      const duration = Date.now() - this.phaseStartTimes[phase];
      this.phaseDurations[phase] = duration;
      this.historicalData[phase].push(duration);
      
      // 保持历史数据在合理范围内
      if (this.historicalData[phase].length > 5) {
        this.historicalData[phase].shift();
      }
      
      // 根据历史数据调整权重
      this.adjustWeights();
    }
  }
  
  // 根据实际处理时间调整各阶段权重
  adjustWeights() {
    // 确保有足够的历史数据
    const hasEnoughData = Object.values(this.historicalData)
      .every(data => data.length > 0);
      
    if (!hasEnoughData) return;
    
    // 计算平均处理时间
    const avgDurations = {};
    let totalDuration = 0;
    
    for (const phase in this.historicalData) {
      const durations = this.historicalData[phase];
      avgDurations[phase] = durations.reduce((sum, d) => sum + d, 0) / durations.length;
      totalDuration += avgDurations[phase];
    }
    
    // 根据平均处理时间调整权重
    if (totalDuration > 0) {
      let startPercentage = 0;
      
      for (const phase in avgDurations) {
        const weight = Math.round((avgDurations[phase] / totalDuration) * 100);
        this.phases[phase] = {
          weight: weight,
          start: startPercentage
        };
        startPercentage += weight;
      }
      
      // 确保总权重为100
      const totalWeight = Object.values(this.phases).reduce((sum, p) => sum + p.weight, 0);
      if (totalWeight !== 100) {
        // 调整最后一个阶段的权重
        const lastPhase = Object.keys(this.phases).pop();
        this.phases[lastPhase].weight += (100 - totalWeight);
      }
    }
  }
  
  // 更新初始化阶段进度
  updateInitProgress(percentage) {
    if (this.currentPhase !== 'init') {
      this.startPhase('init');
    }
    
    const phase = this.phases.init;
    const actualProgress = (percentage / 100) * phase.weight;
    this.updateProgress(actualProgress, 'Initializing compression...');
    
    if (percentage >= 100) {
      this.endPhase('init');
    }
  }
  
  // 更新媒体处理阶段进度
  updateMediaProgress(processedFile, totalFiles) {
    if (this.mediaFilesCount === null) {
      return;
    }
    
    if (this.currentPhase !== 'media') {
      this.startPhase('media');
    }
    
    this.processedFiles++;
    const phase = this.phases.media;
    const mediaProgress = (this.processedFiles / this.mediaFilesCount) * phase.weight;
    const totalProgress = this.phases.init.weight + mediaProgress;
    
    this.updateProgress(
      totalProgress,
      `Processing media files (${this.processedFiles}/${this.mediaFilesCount})`
    );
    
    if (this.processedFiles === this.mediaFilesCount) {
      this.endPhase('media');
      this.updateFinalizationProgress('Finalizing...');
    }
  }
  
  // 更新最终阶段进度
  updateFinalizationProgress(status, stats) {
    if (this.currentPhase !== 'finalize') {
      this.startPhase('finalize');
    }
    
    const phase = this.phases.finalize;
    const baseProgress = this.phases.init.weight + this.phases.media.weight;
    const finalizeProgress = baseProgress + (phase.weight / 2);
    
    if (stats) {
      this.updateProgress(finalizeProgress, status, stats);
    } else {
      this.updateProgress(finalizeProgress, status);
    }
  }
  
  // 完成压缩过程
  completeCompression(stats) {
    this.endPhase('finalize');
    
    const formattedStats = {
      ...stats,
      formattedOriginalSize: this.formatFileSize(stats.originalSize),
      formattedCompressedSize: this.formatFileSize(stats.compressedSize),
      formattedSavedSize: this.formatFileSize(stats.savedSize)
    };
    
    this.updateProgress(
      100, 
      `Compression completed successfully!`, 
      formattedStats
    );
  }

  // Handle file info
  updateFileInfo(fileInfo) {
    this.fileInfo = fileInfo;
    compressionProgress.update(state => ({
      ...state,
      fileInfo: {
        name: fileInfo.name,
        size: fileInfo.size,
        formattedSize: this.formatFileSize(fileInfo.size)
      }
    }));
  }

  // Initialize compression with total file count
  initializeCompression(totalFiles) {
    this.mediaFilesCount = totalFiles;
    this.processedFiles = 0;
    this.currentPhase = 'media';
    this.updateProgress(this.phases.init.weight, 'Starting media processing...');
  }

  // Update initialization phase progress
  updateInitProgress(percentage) {
    const phase = this.phases.init;
    const actualProgress = (percentage / 100) * phase.weight;
    this.updateProgress(actualProgress, 'Initializing compression...');
  }

  // Update media processing phase progress
  updateMediaProgress(processedFile, totalFiles) {
    if (this.mediaFilesCount === null) {
      return;
    }
    this.processedFiles++;
    const phase = this.phases.media;
    const mediaProgress = (this.processedFiles / this.mediaFilesCount) * phase.weight;
    const totalProgress = this.phases.init.weight + mediaProgress;
    
    // Update progress for each file
    this.updateProgress(
      totalProgress,
      `Processing media files (${this.processedFiles}/${this.mediaFilesCount})`
    );

    // If all files are processed, update to finalization progress
    if (this.processedFiles === this.mediaFilesCount) {
      this.updateFinalizationProgress('Finalizing...');
    }
  }

  // Update finalization phase progress
  updateFinalizationProgress(status, stats) {
    const phase = this.phases.finalize;
    const baseProgress = this.phases.init.weight + this.phases.media.weight;
    const finalizeProgress = baseProgress + (phase.weight / 2);
    
    if (stats) {
      this.updateProgress(finalizeProgress, status, stats);
    } else {
      this.updateProgress(finalizeProgress, status);
    }
  }

  // Complete compression process
  completeCompression(stats) {
    const formattedStats = {
      ...stats,
      formattedOriginalSize: this.formatFileSize(stats.originalSize),
      formattedCompressedSize: this.formatFileSize(stats.compressedSize),
      formattedSavedSize: this.formatFileSize(stats.savedSize)
    };
    
    this.updateProgress(
      100, 
      `Compression completed successfully!`, 
      formattedStats
    );
  }

  // Format file size to human-readable format
  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
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
  updateProgress(percentage, status, stats = null) {
    compressionProgress.update(state => {
      const updatedState = {
        ...state,
        percentage: Math.min(Math.round(percentage * 100) / 100, 100),
        status,
        error: null,
        stats: {
          ...state.stats,
          processedFiles: this.processedFiles,
          totalFiles: this.mediaFilesCount || 0
        }
      };
      
      if (stats) {
        updatedState.stats = {
          ...updatedState.stats,
          ...stats
        };
      }
      
      return updatedState;
    });
  }
}