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
    // console.log('Progress Update:', type, payload); // Debug log
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
                // Reset other stats
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
                newState.percentage = payload.percentage; // Assume percentage covers init phase (e.g., 0-35%)
                newState.status = payload.status || 'Initializing...';
                break;
            case 'mediaCount':
                newState.mediaCount = payload.count;
                newState.processedMediaCount = 0;
                newState.status = payload.count > 0 ? 'Compressing media...' : 'No media to compress.';
                 newState.percentage = Math.max(newState.percentage, 35); // Ensure we are past init phase
                break;
            case 'media':
                newState.processedMediaCount = payload.fileIndex;
                newState.estimatedTimeRemaining = payload.estimatedTimeRemaining;
                // Calculate media phase progress (e.g., 35% to 90%)
                const mediaPhaseStart = 35;
                const mediaPhaseWeight = 55;
                const mediaProgress = newState.mediaCount > 0 ? (payload.fileIndex / payload.totalFiles) : 1;
                newState.percentage = mediaPhaseStart + (mediaProgress * mediaPhaseWeight);
                newState.status = `Compressing media (${payload.fileIndex}/${payload.totalFiles})...`;
                break;
             case 'finalize':
                newState.percentage = Math.max(newState.percentage, 90); // Move to finalize phase (e.g., 90-100%)
                newState.status = payload.status || 'Finalizing...';
                if (payload.stats) { // Update stats if provided
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
                // Keep percentage where it failed, or set to 100 if error occurs late?
                // newState.percentage = 100; // Or keep current percentage
                if (payload.stats) { // Update stats collected so far
                     newState.stats = { ...newState.stats, ...payload.stats };
                }
                break;
             case 'warning':
                 // Warnings don't stop progress but should be noted
                 // Maybe add a warnings array to the store? For now, just log.
                 console.warn('Optimization Warning:', payload.message);
                 break;
             default:
                 console.warn('Unknown progress update type:', type);
        }
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
