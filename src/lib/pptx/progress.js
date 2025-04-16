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

  savePhases() {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('progress_phases', JSON.stringify(this.phases));
    }
  }

  loadPhases() {
    if (typeof localStorage !== 'undefined') {
      const data = localStorage.getItem('progress_phases');
      if (data) return JSON.parse(data);
    }
    return null;
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
      this.startPhase(phase);
    }
    const phaseObj = this.phases[phase];
    const actualProgress = (percentage / 100) * phaseObj.weight;
    this.updateProgress(actualProgress, status);
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
  handleError(error, currentProgress = 0) {
    if (this.progressCallback) {
      this.progressCallback({
        error: error.message || String(error),
        percentage: currentProgress
      });
    } else {
      compressionProgress.update(state => ({
        ...state,
        error: error.message || String(error),
        percentage: currentProgress
      }));
    }
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

  endPhase(phase) {
    if (this.phaseStartTimes[phase]) {
      const duration = Date.now() - this.phaseStartTimes[phase];
      this.phaseDurations[phase] = duration;
      if (this.historicalData[phase]) {
        this.historicalData[phase].push(duration);
        // 只保留最近10次
        if (this.historicalData[phase].length > 10) {
          this.historicalData[phase].shift();
        }
      }
    }
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
}