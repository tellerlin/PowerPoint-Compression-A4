<script>
  export let progress = 0;
  export let status = '';
  export let error = null;

  $: progressStyle = `width: ${progress}%`;
</script>

<div class="space-y-4">
  <div class="w-full bg-surface rounded-full h-2.5 overflow-hidden">
    <div
      class="h-full transition-all duration-300 ease-out rounded-full {error ? 'bg-red-600' : 'bg-primary-600'}"
      style={progressStyle}
    ></div>
  </div>

  <div class="text-center">
    {#if error}
      <p class="text-red-500 font-medium">{error}</p>
    {:else}
      <p class="text-text/70">
        {status}
        {#if progress > 0 && progress < 100}
          ({progress.toFixed(1)}%)
        {/if}
      </p>
    {/if}
  </div>
</div>