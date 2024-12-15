<script>
  export let progress = 0;
</script>

<div class="w-full bg-surface rounded-full h-2.5">
  <div
    class="bg-primary-600 h-2.5 rounded-full transition-all duration-300 ease-out"
    style="width: {progress}%"
  ></div>
</div>

{#if progress > 0}
  <p class="text-center text-text/70 text-lg mt-2">
    Compressing... {progress}%
  </p>
{/if}