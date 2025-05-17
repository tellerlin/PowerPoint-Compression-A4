<script>
  export let as = 'div';
  export let size = 'default';
  export let class_ = '';

  const sizes = {
    sm: 'max-w-3xl',
    default: 'max-w-5xl',
    lg: 'max-w-7xl'
  };
</script>

<svelte:element 
  this={as}
  class="w-full mx-auto px-4 sm:px-6 lg:px-8 bg-surface rounded-lg shadow-sm border border-border {sizes[size]} {class_}"
>
  <slot />
</svelte:element>