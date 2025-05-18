import { writable } from 'svelte/store';

// 创建进度状态存储
function createProgressStore() {
  const { subscribe, set, update } = writable({
    percentage: 0,
    status: '',
    error: null,
    fileInfo: null,
    mediaCount: 0,
    processedMediaCount: 0,
    estimatedTimeRemaining: null,
    stats: {
      originalSize: 0,
      compressedSize: null,
      savedSize: 0,
      savedPercentage: 0,
      originalMediaSize: 0,
      compressedMediaSize: 0,
      savedMediaSize: 0,
      savedMediaPercentage: 0,
      processingTime: 0,
      error: null
    }
  });

  return {
    subscribe,
    set,
    update
  };
}

export const compressionProgress = createProgressStore();

// 更新进度状态
function updateProgressState(store, type, payload) {
  switch (type) {
    case 'reset':
      store.set({
        percentage: 0,
        status: '',
        error: null,
        fileInfo: null,
        mediaCount: 0,
        processedMediaCount: 0,
        estimatedTimeRemaining: null,
        stats: {
          originalSize: 0,
          compressedSize: null,
          savedSize: 0,
          savedPercentage: 0,
          originalMediaSize: 0,
          compressedMediaSize: 0,
          savedMediaSize: 0,
          savedMediaPercentage: 0,
          processingTime: 0,
          error: null
        }
      });
      break;

    case 'fileInfo':
      store.update(state => ({
        ...state,
        fileInfo: payload,
        stats: {
          ...state.stats,
          originalSize: payload.size
        }
      }));
      break;

    case 'mediaCount':
      store.update(state => ({
        ...state,
        mediaCount: payload.count
      }));
      break;

    case 'media':
      store.update(state => {
        const percentage = Math.round((payload.fileIndex / payload.totalFiles) * 100);
        return {
          ...state,
          percentage,
          status: `Processing media files (${payload.fileIndex}/${payload.totalFiles})`,
          processedMediaCount: payload.fileIndex,
          estimatedTimeRemaining: payload.estimatedTimeRemaining
        };
      });
      break;

    case 'finalize':
      store.update(state => ({
        ...state,
        percentage: 95,
        status: payload.status,
        stats: payload.stats
      }));
      break;

    case 'complete':
      store.update(state => ({
        ...state,
        percentage: 100,
        status: 'Compression complete',
        stats: payload.stats
      }));
      break;

    case 'error':
      store.update(state => ({
        ...state,
        status: 'Error occurred',
        error: payload.message,
        stats: payload.stats
      }));
      break;
  }
}

export function updateProgress(type, payload) {
  updateProgressState(compressionProgress, type, payload);
}

export function resetProgress() {
  updateProgress('reset');
}