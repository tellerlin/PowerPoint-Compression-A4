<script>
  import { page } from '$app/stores';
  import Button from '$lib/components/ui/Button.svelte';
</script>

<div class="min-h-[70vh] flex items-center justify-center px-4 sm:px-6 lg:px-8">
  <div class="max-w-md w-full text-center">
    <div class="animate-fade-in">
      <h1 class="text-9xl font-display font-bold text-primary-600 mb-4">
        {$page.status}
      </h1>
      <p class="text-xl text-gray-600 mb-8">
        {#if $page.status === 404}
          Oops! The page you're looking for doesn't exist.
        {:else}
          Something went wrong. Please try again later.
        {/if}
      </p>
      <div class="space-y-4">
        <Button variant="primary" on:click={() => window.location.href = '/'}>
          Return Home
        </Button>
      </div>
    </div>
  </div>
</div>