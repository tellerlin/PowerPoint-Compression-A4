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
    
    // Phase weights
    this.phases = {
      init: { weight: 15, start: 0 },
      media: { weight: 60, start: 15 },
      finalize: { weight: 25, start: 75 }
    };
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