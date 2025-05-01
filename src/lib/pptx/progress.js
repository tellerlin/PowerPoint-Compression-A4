import { createProgressStore, updateProgressState } from '../utils/progressUtils';

export const compressionProgress = createProgressStore();

export function updateProgress(type, payload) {
  updateProgressState(compressionProgress, type, payload);
}

export function resetProgress() {
  updateProgress('reset');
}