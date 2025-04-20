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
    this.phases = this.loadPhases() || {
      init: { weight: 15, start: 0 },
      media: { weight: 60, start: 15 },
      finalize: { weight: 25, start: 75 }
    };
    this.historicalData = {
      init: [],
      media: [],
      finalize: []
    };
    this.progressCallback = null; // decouple from store
  }

  setProgressCallback(cb) {
    this.progressCallback = cb;
  }

  // 修改 savePhases 方法中的注释
  savePhases() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        localStorage.setItem('progress_phases', JSON.stringify(this.phases));
      }
    } catch (error) {
      // Handle privacy mode or storage full scenarios
      console.warn('Failed to save progress phases:', error);
    }
  }
  
  // 修改 loadPhases 方法中的注释
  loadPhases() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const data = localStorage.getItem('progress_phases');
        if (data) return JSON.parse(data);
      }
    } catch (error) {
      // Handle corrupted data or other exceptions
      console.warn('Failed to load progress phases:', error);
    }
    return null;
  }
  
  // 修改 endPhase 方法中的注释
  endPhase(phase) {
    if (this.phaseStartTimes[phase]) {
      const duration = Date.now() - this.phaseStartTimes[phase];
      this.phaseDurations[phase] = duration;
      if (this.historicalData[phase]) {
        this.historicalData[phase].push(duration);
        // Keep only the most recent 10
        if (this.historicalData[phase].length > 10) {
          this.historicalData[phase].shift();
        }
      }
    }
  }

  adjustWeights() {
    const hasEnoughData = Object.values(this.historicalData).every(data => data.length > 0);
    if (!hasEnoughData) return;
    const avgDurations = {};
    let totalDuration = 0;
    for (const phase in this.historicalData) {
      const durations = this.historicalData[phase];
      avgDurations[phase] = durations.reduce((sum, d) => sum + d, 0) / durations.length;
      totalDuration += avgDurations[phase];
    }
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
      const totalWeight = Object.values(this.phases).reduce((sum, p) => sum + p.weight, 0);
      if (totalWeight !== 100) {
        const lastPhase = Object.keys(this.phases).pop();
        this.phases[lastPhase].weight += (100 - totalWeight);
      }
      this.savePhases();
    }
  }

  updatePhaseProgress(phase, percentage, status) {
    if (this.currentPhase !== phase) {
      // 在切换阶段时，确保进度不会回退
      this.startPhase(phase);
    }
    const phaseObj = this.phases[phase];
    // 计算实际进度时，确保不会低于当前进度
    const phaseProgress = (percentage / 100) * phaseObj.weight;
    const actualProgress = phaseObj.start + phaseProgress;
    
    // 获取当前进度
    let currentProgress = 0;
    if (this.progressCallback) {
      // 如果使用回调，我们需要维护一个内部状态
      currentProgress = this._lastReportedProgress || 0;
    } else {
      // 从store获取当前进度
      let state;
      compressionProgress.subscribe(s => { state = s; })();
      currentProgress = state.percentage || 0;
    }
    
    // 只有当新进度大于当前进度时才更新
    if (actualProgress > currentProgress) {
      this._lastReportedProgress = actualProgress;
      this.updateProgress(actualProgress, status);
    }
    
    if (percentage >= 100) {
      this.endPhase(phase);
    }
  }

  updateProgress(percentage, status, stats = null) {
    const updateObj = {
      percentage: Math.min(Math.round(percentage * 100) / 100, 100),
      status,
      error: null,
      stats: {
        processedFiles: this.processedFiles,
        totalFiles: this.mediaFilesCount || 0,
        ...(stats || {})
      }
    };
    if (this.progressCallback) {
      this.progressCallback(updateObj);
    } else {
      compressionProgress.update(state => ({
        ...state,
        ...updateObj
      }));
    }
  }

  // Add this method to update file info in the progress store
  updateFileInfo(fileInfo) {
    if (this.progressCallback) {
      this.progressCallback({ fileInfo });
    } else {
      compressionProgress.update(state => ({
        ...state,
        fileInfo
      }));
    }
  }

  // Add this method to handle errors in the progress store
  // 改进错误处理
  handleError(error, currentProgress = 0) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    if (this.progressCallback) {
      this.progressCallback({
        error: errorMessage,
        percentage: currentProgress
      });
    } else {
      compressionProgress.update(state => ({
        ...state,
        error: errorMessage,
        percentage: currentProgress
      }));
    }
    
    console.error('Compression error:', errorMessage);
  }

  updateInitProgress(percentage) {
    this.updatePhaseProgress('init', percentage, 'Initializing compression...');
  }

  updateMediaProgress(percentage) {
    this.updatePhaseProgress('media', percentage, 'Processing media files...');
  }

  updateFinalizationProgress(percentage) {
    this.updatePhaseProgress('finalize', percentage, 'Finalizing...');
  }

  initializeCompression(mediaFilesCount) {
    this.mediaFilesCount = mediaFilesCount;
    this.processedFiles = 0;
    if (this.progressCallback) {
      this.progressCallback({
        stats: {
          processedFiles: this.processedFiles,
          totalFiles: this.mediaFilesCount
        }
      });
    } else {
      compressionProgress.update(state => ({
        ...state,
        stats: {
          ...state.stats,
          processedFiles: this.processedFiles,
          totalFiles: this.mediaFilesCount
        }
      }));
    }
  }

  startPhase(phase) {
    this.currentPhase = phase;
    this.phaseStartTimes[phase] = Date.now();
  }

  completeCompression(stats) {
    if (this.progressCallback) {
      this.progressCallback({
        percentage: 100,
        status: 'Compression complete!',
        error: null,
        stats: {
          ...stats
        }
      });
    } else {
      compressionProgress.update(state => ({
        ...state,
        percentage: 100,
        status: 'Compression complete!',
        error: null,
        stats: {
          ...state.stats,
          ...stats
        }
      }));
    }
  }

  // Fix method syntax - replace semicolon with opening brace
  smoothTransition(fromPhase, toPhase, duration = 500) {
    const fromProgress = this._getPhaseProgress(fromPhase, 100);
    const toProgress = this._getPhaseProgress(toPhase, 0);
    
    // 如果目标进度小于当前进度，直接跳到目标阶段而不降低进度
    if (toProgress <= fromProgress) {
      this.currentPhase = toPhase;
      this.phaseStartTimes[toPhase] = Date.now();
      return;
    }
    
    // 否则，创建一个平滑过渡
    const startTime = Date.now();
    const startProgress = fromProgress;
    const progressDiff = toProgress - fromProgress;
    
    const animate = () => {
      const elapsed = Date.now() - startTime;
      if (elapsed >= duration) {
        this.currentPhase = toPhase;
        this.phaseStartTimes[toPhase] = Date.now();
        return;
      }
      
      const progress = startProgress + (progressDiff * (elapsed / duration));
      this.updateProgress(progress, `Transitioning to ${toPhase}...`);
      requestAnimationFrame(animate);
    };
    
    animate();
  }
  
  // Fix method syntax - replace semicolon with opening brace
  _getPhaseProgress(phase, percentage) {
    const phaseObj = this.phases[phase];
    return phaseObj.start + ((percentage / 100) * phaseObj.weight);
  }
}
  