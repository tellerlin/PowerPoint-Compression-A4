<script>
  export let progress = 0;
</script>

<div class="progress-bar">
  <div
    class="progress-bar-fill"
    style="width: {progress}%"
  ></div>
</div>

{#if progress > 0}
  <p class="text-center text-gray-700 text-lg mt-2">
    Compressing... {progress}%
  </p>
{/if}