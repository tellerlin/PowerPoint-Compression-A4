<script>
  import AudioTrimmer from '$lib/components/AudioTrimmer.svelte';
  import ToolNavigation from '$lib/components/ToolNavigation.svelte';
</script>

<div class="container mx-auto px-4 py-8">
  <h1 class="text-3xl font-bold text-center mb-8">Audio Trimmer</h1>
  
  <ToolNavigation />
  
  <div class="mt-8">
    <AudioTrimmer />
  </div>
</div> 