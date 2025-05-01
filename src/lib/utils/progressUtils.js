import { writable } from 'svelte/store';

const loadingAnimations = ['.', '..', '...', '....', '.....', '......', '.......', '........', '.........', '..........'];

export function createProgressStore(initialState = {}) {
  return writable({
    percentage: 0,
    status: '',
    error: null,
    fileInfo: null,
    mediaCount: 0,
    processedMediaCount: 0,
    estimatedTimeRemaining: null,
    animationIndex: 0,
    animationTimer: null,
    stats: {
      originalSize: 0,
      compressedSize: 0,
      savedSize: 0,
      savedPercentage: 0,
      originalMediaSize: 0,
      compressedMediaSize: 0,
      savedMediaSize: 0,
      savedMediaPercentage: 0,
      processingTime: 0
    },
    ...initialState
  });
}

export function startAnimation(store, baseStatus) {
  let animIndex = 0;
  const timer = setInterval(() => {
    store.update(state => {
      animIndex = (animIndex + 1) % loadingAnimations.length;
      return {
        ...state,
        animationIndex: animIndex,
        status: baseStatus + loadingAnimations[animIndex]
      };
    });
  }, 250);
  
  return { baseStatus, timer };
}

export function stopAnimation(timer) {
  if (timer) {
    clearInterval(timer);
  }
}

export function calculateProgress(current, total, startPhase, phaseWeight) {
  if (total <= 0) return 1;
  const progress = Math.min(1, current / Math.max(1, total));
  return startPhase + (progress * phaseWeight);
}

export function calculateEstimatedTime(elapsed, processed, total) {
  if (total <= 0 || processed <= 0) return null;
  const estimatedTotalTime = (elapsed / processed) * total;
  return Math.max(0, estimatedTotalTime - elapsed);
}

export function calculateSavedStats(originalSize, compressedSize) {
  const savedSize = Math.max(0, originalSize - compressedSize);
  const savedPercentage = originalSize > 0 ? (savedSize / originalSize * 100).toFixed(1) : 0;
  return { savedSize, savedPercentage };
}

export function updateProgressState(store, type, payload) {
  store.update(state => {
    let newState = { ...state };
    let currentPercentage = newState.percentage || 0;
    
    const now = Date.now();
    if (newState._lastUpdateTime && (now - newState._lastUpdateTime < 40) && type !== 'complete' && type !== 'error') {
      return state;
    }
    newState._lastUpdateTime = now;
    
    if (newState.animationTimer) {
      stopAnimation(newState.animationTimer);
      newState.animationTimer = null;
    }
    
    switch (type) {
      case 'fileInfo':
        newState.fileInfo = payload;
        newState.stats.originalSize = payload.size;
        newState.percentage = 0;
        newState.status = 'Starting...';
        newState.error = null;
        newState.mediaCount = 0;
        newState.processedMediaCount = 0;
        newState.estimatedTimeRemaining = null;
        newState.animationIndex = 0;
        newState.stats = {
          ...newState.stats,
          compressedSize: null,
          savedSize: 0,
          savedPercentage: 0,
          originalMediaSize: 0,
          compressedMediaSize: 0,
          savedMediaSize: 0,
          savedMediaPercentage: 0,
          processingTime: 0
        };
        break;
      case 'init':
        const initPercentage = Math.min(20, payload.percentage || 10);
        newState.percentage = Math.max(currentPercentage, initPercentage);
        
        const baseStatus = payload.status || 'Initializing';
        const animation = startAnimation(store, baseStatus);
        newState.status = baseStatus + loadingAnimations[newState.animationIndex];
        newState.animationTimer = animation.timer;
        break;
      case 'mediaCount':
        newState.mediaCount = payload.count;
        newState.processedMediaCount = 0;
        newState.percentage = Math.max(currentPercentage, 25);
        
        if (payload.count > 0) {
          const baseStatus = 'Compressing media';
          const animation = startAnimation(store, baseStatus);
          newState.status = baseStatus + loadingAnimations[newState.animationIndex];
          newState.animationTimer = animation.timer;
        } else {
          newState.status = 'No media to compress.';
        }
        break;
        
      case 'media':
        newState.processedMediaCount = payload.fileIndex;
        
        if (payload.estimatedTimeRemaining && payload.estimatedTimeRemaining > 1) {
          newState.estimatedTimeRemaining = payload.estimatedTimeRemaining;
        } else {
          newState.estimatedTimeRemaining = null;
        }
        
        const mediaPhaseStart = 25;
        const mediaPhaseWeight = 60;
        
        let mediaProgress;
        if (newState.mediaCount <= 0) {
          mediaProgress = 1;
        } else {
          mediaProgress = Math.min(1, payload.fileIndex / Math.max(1, payload.totalFiles));
        }
        
        const calculatedPercentage = mediaPhaseStart + (mediaProgress * mediaPhaseWeight);
        newState.percentage = Math.max(currentPercentage, Math.min(calculatedPercentage, mediaPhaseStart + mediaPhaseWeight));
        
        const baseMediaStatus = `Compressing media (${payload.fileIndex}/${payload.totalFiles})`;
        
        if (newState.animationTimer) {
          stopAnimation(newState.animationTimer);
        }
        
        const mediaAnimation = startAnimation(store, baseMediaStatus);
        newState.status = baseMediaStatus + loadingAnimations[newState.animationIndex];
        newState.animationTimer = mediaAnimation.timer;
        break;
      case 'finalize':
        newState.percentage = Math.max(currentPercentage, Math.min(99, payload.percentage || 90));
        
        if (payload.status) {
          newState.status = payload.status;
        } else {
          newState.status = 'Finalizing...';
        }
        
        if (payload.stats) {
          newState.stats = { ...newState.stats, ...payload.stats };
        }
        break;
      case 'complete':
        newState.percentage = 100;
        newState.status = 'Complete';
        
        if (payload.stats) {
          newState.stats = { ...newState.stats, ...payload.stats };
        }
        
        if (newState.animationTimer) {
          stopAnimation(newState.animationTimer);
          newState.animationTimer = null;
        }
        break;
      case 'error':
        newState.error = payload.message || 'An error occurred';
        newState.status = 'Error';
        
        if (payload.stats) {
          newState.stats = { ...newState.stats, ...payload.stats };
        }
        
        if (newState.animationTimer) {
          stopAnimation(newState.animationTimer);
          newState.animationTimer = null;
        }
        break;
      case 'warning':
        console.warn(`[Progress Warning] ${payload.message}`);
        break;
      case 'reset':
        return {
          percentage: 0,
          status: '',
          error: null,
          fileInfo: null,
          mediaCount: 0,
          processedMediaCount: 0,
          estimatedTimeRemaining: null,
          animationIndex: 0,
          animationTimer: null,
          stats: {
            originalSize: 0,
            compressedSize: 0,
            savedSize: 0,
            savedPercentage: 0,
            originalMediaSize: 0,
            compressedMediaSize: 0,
            savedMediaSize: 0,
            savedMediaPercentage: 0,
            processingTime: 0
          }
        };
    }
    
    return newState;
  });
}

// 添加时间格式化函数
function formatRemainingTime(seconds) {
  if (seconds < 60) return `${Math.ceil(seconds)}秒`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}分钟`;
  return `${Math.floor(seconds / 3600)}小时${Math.ceil((seconds % 3600) / 60)}分钟`;
}