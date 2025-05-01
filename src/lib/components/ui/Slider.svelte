<script>
  export let min = 0;
  export let max = 1;
  export let step = 0.01;
  export let value = 0.5;
  function handleInput(event) {
    const val = parseFloat(event.target.value);
    dispatch('change', val);
  }
  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();
</script>

<input
  type="range"
  min={min}
  max={max}
  step={step}
  value={value}
  on:input={handleInput}
  class="slider-input"
/>

<style>
  .slider-input {
    width: 100%;
    height: 6px;
    -webkit-appearance: none;
    appearance: none;
    background: rgba(var(--surface-rgb, 100, 100, 100), 0.3);
    border-radius: 3px;
    outline: none;
    margin: 10px 0;
  }
  
  .slider-input::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: rgb(var(--primary-rgb, 59, 130, 246));
    cursor: pointer;
    border: none;
    box-shadow: 0 0 2px rgba(0, 0, 0, 0.3);
  }
  
  .slider-input::-moz-range-thumb {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: rgb(var(--primary-rgb, 59, 130, 246));
    cursor: pointer;
    border: none;
    box-shadow: 0 0 2px rgba(0, 0, 0, 0.3);
  }
  
  .slider-input::-moz-range-track {
    background: rgba(var(--surface-rgb, 100, 100, 100), 0.3);
    height: 6px;
    border-radius: 3px;
  }
  
  .slider-input::-ms-track {
    width: 100%;
    height: 6px;
    background: transparent;
    border-color: transparent;
    color: transparent;
  }
  
  .slider-input::-ms-fill-lower,
  .slider-input::-ms-fill-upper {
    background: rgba(var(--surface-rgb, 100, 100, 100), 0.3);
    border-radius: 3px;
  }
  
  .slider-input::-ms-thumb {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: rgb(var(--primary-rgb, 59, 130, 246));
    cursor: pointer;
    border: none;
    box-shadow: 0 0 2px rgba(0, 0, 0, 0.3);
  }
</style>