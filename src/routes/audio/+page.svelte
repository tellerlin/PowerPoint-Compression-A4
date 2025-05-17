<script>
  import { browser } from '$app/environment';
  
  let ClientOnlyCompressor;
  console.log('[AudioPage] Initializing page component');

  // 仅在客户端导入组件
  import { onMount } from 'svelte';
  onMount(async () => {
    console.log('[AudioPage] Component mounted, browser environment:', browser);
    if (browser) {
      console.log('[AudioPage] Loading client component');
      try {
        ClientOnlyCompressor = (await import('$lib/components/AudioCompressor.svelte')).default;
        console.log('[AudioPage] Client component loaded successfully');
      } catch (error) {
        console.error('[AudioPage] Error loading client component:', {
          error,
          stack: error.stack,
          message: error.message
        });
      }
    } else {
      console.log('[AudioPage] Not in browser environment, skipping component load');
    }
  });
</script>

{#if browser && ClientOnlyCompressor}
  <svelte:component this={ClientOnlyCompressor} />
{:else}
  <div class="container mx-auto px-4 py-8">
    <h1 class="text-3xl font-bold mb-8">Audio Compression</h1>
    <div class="text-center text-gray-500">
      Loading audio compression tool...
    </div>
  </div>
{/if} 