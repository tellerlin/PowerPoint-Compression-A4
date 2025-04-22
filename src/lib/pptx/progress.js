import { writable } from 'svelte/store';

export const compressionProgress = writable({
	percentage: 0,
	status: '',
	error: null,
	fileInfo: null,
    mediaCount: 0,
    processedMediaCount: 0,
    estimatedTimeRemaining: null,
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
});

export function updateProgress(type, payload) {
    compressionProgress.update(state => {
        let newState = { ...state };
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
                newState.percentage = payload.percentage;
                newState.status = payload.status || 'Initializing...';
                break;
            case 'mediaCount':
                newState.mediaCount = payload.count;
                newState.processedMediaCount = 0;
                newState.status = payload.count > 0 ? 'Compressing media...' : 'No media to compress.';
                newState.percentage = Math.max(newState.percentage, 35);
                break;
            case 'media':
                newState.processedMediaCount = payload.fileIndex;
                newState.estimatedTimeRemaining = payload.estimatedTimeRemaining;
                const mediaPhaseStart = 35;
                const mediaPhaseWeight = 55;
                const mediaProgress = newState.mediaCount > 0 ? (payload.fileIndex / payload.totalFiles) : 1;
                newState.percentage = mediaPhaseStart + (mediaProgress * mediaPhaseWeight);
                newState.status = `Compressing media (${payload.fileIndex}/${payload.totalFiles})...`;
                break;
            case 'finalize':
                newState.percentage = Math.max(newState.percentage, 90);
                newState.status = payload.status || 'Finalizing...';
                if (payload.stats) {
                    newState.stats = { ...newState.stats, ...payload.stats };
                }
                break;
            case 'complete':
                newState.percentage = 100;
                newState.status = 'Optimization complete!';
                newState.estimatedTimeRemaining = 0;
                newState.stats = { ...state.stats, ...payload.stats };
                break;
            case 'error':
                newState.error = payload.message || 'An unknown error occurred.';
                newState.status = `Error: ${newState.error}`;
                if (payload.stats) {
                    newState.stats = { ...newState.stats, ...payload.stats };
                }
                break;
            case 'warning':
                console.warn('Optimization Warning:', payload.message);
                break;
            default:
                console.warn('Unknown progress update type:', type);
        }
        // Always recalculate savedSize and savedPercentage
        const o = newState.stats.originalSize || 0;
        const c = newState.stats.compressedSize || 0;
        newState.stats.savedSize = o && c ? o - c : 0;
        newState.stats.savedPercentage = o && c ? Math.round(((o - c) / o) * 100) : 0;
        // Clamp percentage
        newState.percentage = Math.max(0, Math.min(100, Math.round(newState.percentage)));
        return newState;
    });
}

export function resetProgress() {
     compressionProgress.set({
        percentage: 0,
        status: '',
        error: null,
        fileInfo: null,
        mediaCount: 0,
        processedMediaCount: 0,
        estimatedTimeRemaining: null,
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
    });
}