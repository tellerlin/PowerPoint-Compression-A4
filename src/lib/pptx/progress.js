import { writable } from 'svelte/store';

// 创建一个动态加载动画数组
const loadingAnimations = ['.', '..', '...', '....', '.....'];

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
    // 创建一个计时器，每500毫秒更新一次动画
    const timer = setInterval(() => {
        compressionProgress.update(state => {
            animIndex = (animIndex + 1) % loadingAnimations.length;
            return {
                ...state,
                animationIndex: animIndex,
                status: baseStatus + loadingAnimations[animIndex]
            };
        });
    }, 500);
    
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
                // 媒体计数阶段占总进度的25%
                newState.percentage = Math.max(currentPercentage, 25);
                
                if (payload.count > 0) {
                    newState.status = 'Compressing media...';
                } else {
                    newState.status = 'No media to compress.';
                }
                break;
            case 'media':
                newState.processedMediaCount = payload.fileIndex;
                
                // 只有当估计时间大于1秒时才更新显示，否则设为null（不显示）
                if (payload.estimatedTimeRemaining && payload.estimatedTimeRemaining > 1) {
                    newState.estimatedTimeRemaining = payload.estimatedTimeRemaining;
                } else {
                    newState.estimatedTimeRemaining = null;
                }
                
                // 媒体处理阶段从25%到85%，占总进度的60%
                const mediaPhaseStart = 25;
                const mediaPhaseWeight = 60;
                
                // 如果没有媒体文件，直接设为该阶段结束
                let mediaProgress;
                if (newState.mediaCount <= 0) {
                    mediaProgress = 1;
                } else {
                    // 确保不会除以0，并且进度不会超过1
                    mediaProgress = Math.min(1, payload.fileIndex / Math.max(1, payload.totalFiles));
                }
                
                // 计算当前阶段的百分比
                const calculatedPercentage = mediaPhaseStart + (mediaProgress * mediaPhaseWeight);
                
                // 确保百分比不会回撤，但也不会超过该阶段的最大值
                newState.percentage = Math.max(currentPercentage, Math.min(calculatedPercentage, mediaPhaseStart + mediaPhaseWeight));
                
                newState.status = `Compressing media (${payload.fileIndex}/${payload.totalFiles})...`;
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