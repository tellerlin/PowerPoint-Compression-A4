<script>
  import { createEventDispatcher } from 'svelte';
  import Slider from './ui/Slider.svelte';
  import { COMPRESSION_PRESETS } from '$lib/pptx/constants';
  
  const dispatch = createEventDispatcher();
  
  export let options = {
    preset: 'balanced',
    compressImages: {
      enabled: true,
      quality: 0.7,
      allowFormatConversion: true,
      allowDownsampling: true,
      maxImageSize: 1920
    },
    removeHiddenSlides: false,
    removeUnusedLayouts: true,
    cleanMediaInUnusedLayouts: true
  };

  function handlePresetChange(event) {
    const preset = event.target.value;
    const presetOptions = COMPRESSION_PRESETS[preset];
    
    options = {
      ...options,
      preset,
      compressImages: {
        ...options.compressImages,
        quality: presetOptions.quality,
        allowFormatConversion: presetOptions.allowFormatConversion,
        allowDownsampling: presetOptions.allowDownsampling,
        maxImageSize: presetOptions.maxImageSize
      }
    };
    
    dispatch('change', options);
  }
  
  function handleQualityChange(event) {
    options.compressImages.quality = event.detail;
    dispatch('change', options);
  }
  
  function handleOptionChange() {
    dispatch('change', options);
  }
  
  $: compressionPercentage = Math.round((1 - options.compressImages.quality) * 100);
</script>

<div class="compression-options">
  <div class="preset-selector mb-4">
    <label for="preset-select" class="block text-sm font-medium mb-2">Compression Preset</label>
    <select 
      id="preset-select"
      value={options.preset}
      on:change={handlePresetChange}
      class="w-full p-2 rounded-lg border border-border bg-surface text-text"
    >
      <option value="balanced">Balanced</option>
      <option value="aggressive">Aggressive</option>
      <option value="conservative">Conservative</option>
    </select>
  </div>

  <div class="option">
    <label>
      <input 
        type="checkbox" 
        bind:checked={options.compressImages.enabled} 
        on:change={handleOptionChange}
      />
      Compress Images
    </label>
    
    {#if options.compressImages.enabled}
      <div class="advanced-options ml-6 mt-2 space-y-4">
        <div class="quality-slider">
          <label for="quality-slider" class="block text-sm font-medium mb-2">Image Quality</label>
          <Slider 
            id="quality-slider"
            min={0.1} 
            max={1} 
            step={0.05} 
            value={options.compressImages.quality} 
            on:change={handleQualityChange}
          />
          <div class="quality-labels">
            <span>Higher Compression</span>
            <span class="percentage-value">{compressionPercentage}% Compression</span>
            <span>Better Quality</span>
          </div>
        </div>

        <div class="max-size-setting">
          <label for="max-size-select" class="block text-sm font-medium mb-2">Max Image Size</label>
          <select 
            id="max-size-select"
            bind:value={options.compressImages.maxImageSize}
            on:change={handleOptionChange}
            class="w-full p-2 rounded-lg border border-border bg-surface text-text"
          >
            <option value={1280}>1280px (Aggressive)</option>
            <option value={1920}>1920px (Balanced)</option>
            <option value={2560}>2560px (Conservative)</option>
          </select>
        </div>

        <div class="format-options space-y-2">
          <label class="flex items-center">
            <input 
              type="checkbox" 
              bind:checked={options.compressImages.allowFormatConversion} 
              on:change={handleOptionChange}
              class="mr-2"
            />
            Allow Format Conversion
          </label>
          <label class="flex items-center">
            <input 
              type="checkbox" 
              bind:checked={options.compressImages.allowDownsampling} 
              on:change={handleOptionChange}
              class="mr-2"
            />
            Allow Downsampling
          </label>
        </div>
      </div>
    {/if}
  </div>
  
  <div class="option">
    <label>
      <input 
        type="checkbox" 
        bind:checked={options.removeHiddenSlides} 
        on:change={handleOptionChange}
      />
      Remove Hidden Slides
    </label>
    <div class="option-description">
      Remove hidden slides to reduce file size
    </div>
  </div>

  <div class="option">
    <label>
      <input 
        type="checkbox" 
        bind:checked={options.removeUnusedLayouts} 
        on:change={handleOptionChange}
      />
      Remove Unused Layouts
    </label>
    <div class="option-description">
      Remove unused slide layouts to reduce file size
    </div>
  </div>

  <div class="option">
    <label>
      <input 
        type="checkbox" 
        bind:checked={options.cleanMediaInUnusedLayouts} 
        on:change={handleOptionChange}
      />
      Clean Media in Unused Layouts
    </label>
    <div class="option-description">
      Remove media files that are only referenced by unused layouts
    </div>
  </div>
</div>

<style>
  .compression-options {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }
  
  .option {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    width: 100%;
  }
  
  .quality-slider {
    margin-top: 0.5rem;
    width: 100%;
  }
  
  .quality-labels {
    display: flex;
    justify-content: space-between;
    font-size: 0.75rem;
    color: var(--text-secondary);
    margin-top: 0.25rem;
    position: relative;
    width: 100%;
  }
  
  .percentage-value {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    font-weight: 500;
    color: var(--text-primary);
  }
  
  .option-description {
    font-size: 0.85rem;
    color: var(--text-secondary);
    margin-left: 1.5rem;
    margin-top: 0.25rem;
  }
  
  label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-weight: 500;
    cursor: pointer;
  }
  
  input[type="checkbox"] {
    width: 1rem;
    height: 1rem;
  }

  .advanced-options {
    border-left: 2px solid var(--border);
    padding-left: 1rem;
  }
</style>