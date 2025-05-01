<script>
  import { createEventDispatcher } from 'svelte';
  import Slider from './ui/Slider.svelte';
  
  const dispatch = createEventDispatcher();
  
  export let options = {
    compressImages: {
      enabled: true,
      quality: 0.7
    },
    removeHiddenSlides: false
  };
  
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
  <div class="option">
    <label>
      <input 
        type="checkbox" 
        bind:checked={options.compressImages.enabled} 
        on:change={handleOptionChange}
      />
      Compress images
    </label>
    
    {#if options.compressImages.enabled}
      <div class="quality-slider">
        <Slider 
          min={0.1} 
          max={1} 
          step={0.05} 
          value={options.compressImages.quality} 
          on:change={handleQualityChange}
        />
        <div class="quality-labels">
          <span>Better compression</span>
          <span class="percentage-value">{compressionPercentage}% compression</span>
          <span>Better quality</span>
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
      Remove hidden slides
    </label>
    <div class="option-description">
      Remove hidden slides to reduce file size
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
    margin-left: 1.5rem;
    width: calc(100% - 1.5rem);
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
</style>