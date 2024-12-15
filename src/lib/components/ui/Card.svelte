<script>
  export let href = '';
  export let class_ = '';
  
  const Element = href ? 'a' : 'div';
</script>

<svelte:element
  this={Element}
  {href}
  class="block rounded-lg border bg-surface
    border-gray-200 dark:border-gray-700
    shadow-sm hover:shadow-md
    transition duration-200 ease-out
    {class_}"
>
  <slot />
</svelte:element>

<style>
  :global(.card-body) {
    padding: var(--space-6);
  }

  :global(.card-header) {
    padding: var(--space-4) var(--space-6);
    border-bottom: 1px solid rgb(var(--border));
  }

  :global(.card-footer) {
    padding: var(--space-4) var(--space-6);
    border-top: 1px solid rgb(var(--border));
  }
</style>