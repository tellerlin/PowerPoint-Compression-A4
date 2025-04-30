import { writable } from 'svelte/store';

const loadingAnimations = ['.', '..', '...', '....', '.....', '......', '.......', '........', '.........', '..........'];

export const compressionProgress = writable({
	percentage: 0,
	status: '',
	error: null,
	fileInfo: null,
    mediaCount: 0,
    processedMediaCount: 0,
    estimatedTimeRemaining: null,
    animationIndex: 0, // 添加动画索引
    animationTimer: null, // 添加动画计时器
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

// 启动动画效果
function startAnimation(baseStatus) {
    let animIndex = 0;
    // 减少动画更新间隔，使动画更加流畅
    const timer = setInterval(() => {
        compressionProgress.update(state => {
            animIndex = (animIndex + 1) % loadingAnimations.length;
            return {
                ...state,
                animationIndex: animIndex,
                status: baseStatus + loadingAnimations[animIndex]
            };
        });
    }, 300); // 从500ms减少到300ms，使动画更加流畅
    
    return { baseStatus, timer };
}

// 停止动画效果
function stopAnimation(timer) {
    if (timer) {
        clearInterval(timer);
    }
}

function updateProgress(type, payload) {
    compressionProgress.update(state => {
        let newState = { ...state };
        let currentPercentage = newState.percentage || 0;
        
        // 防止频繁更新导致的性能问题
        const now = Date.now();
        if (newState._lastUpdateTime && (now - newState._lastUpdateTime < 50) && type !== 'complete' && type !== 'error') {
            // 如果更新太频繁且不是关键状态，则跳过此次更新
            return state;
        }
        newState._lastUpdateTime = now;
        
        // 如果有正在运行的动画计时器，先停止它
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
                // 初始化阶段占总进度的20%
                const initPercentage = Math.min(20, payload.percentage || 10);
                newState.percentage = Math.max(currentPercentage, initPercentage);
                
                // 为初始化阶段添加动画
                const baseStatus = payload.status || 'Initializing';
                const animation = startAnimation(baseStatus);
                newState.status = baseStatus + loadingAnimations[newState.animationIndex];
                newState.animationTimer = animation.timer;
                break;
            case 'mediaCount':
                newState.mediaCount = payload.count;
                newState.processedMediaCount = 0;
                newState.percentage = Math.max(currentPercentage, 25);
                
                if (payload.count > 0) {
                    const baseStatus = 'Compressing media';
                    const animation = startAnimation(baseStatus);
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
                
                // 为媒体压缩添加动画效果
                const baseMediaStatus = `Compressing media (${payload.fileIndex}/${payload.totalFiles})`;
                
                // 如果已经有动画计时器，只更新基础状态文本
                if (newState.animationTimer) {
                    stopAnimation(newState.animationTimer);
                }
                
                const mediaAnimation = startAnimation(baseMediaStatus);
                newState.status = baseMediaStatus + loadingAnimations[newState.animationIndex];
                newState.animationTimer = mediaAnimation.timer;
                break;
            case 'finalize':
                // 最终处理阶段从85%到99%，占总进度的14%
                // 保留1%给complete阶段
                newState.percentage = Math.max(currentPercentage, Math.min(99, payload.percentage || 90));
                
                // 为最终处理阶段添加动画，特别是rebuilding presentation阶段
                const finalizeStatus = payload.status || 'Finalizing';
                const finalizeAnimation = startAnimation(finalizeStatus);
                newState.status = finalizeStatus + loadingAnimations[newState.animationIndex];
                newState.animationTimer = finalizeAnimation.timer;
                
                // 在最终处理阶段，不显示剩余时间
                newState.estimatedTimeRemaining = null;
                if (payload.stats) {
                    newState.stats = { ...newState.stats, ...payload.stats };
                }
                break;
            case 'complete':
                // 完成阶段固定为100%
                newState.percentage = 100;
                newState.status = 'Optimization complete!';
                newState.estimatedTimeRemaining = null; // 完成时不显示剩余时间
                newState.stats = { ...state.stats, ...payload.stats };
                break;
            case 'error':
                newState.error = payload.message || 'An unknown error occurred.';
                newState.status = `Error: ${newState.error}`;
                newState.estimatedTimeRemaining = null; // 错误时不显示剩余时间
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

export { updateProgress };

export function resetProgress() {
    // 获取当前状态以便停止任何正在运行的动画
    compressionProgress.update(state => {
        if (state.animationTimer) {
            stopAnimation(state.animationTimer);
        }
        return state;
    });
    
    // 重置状态
    compressionProgress.set({
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
    });
}