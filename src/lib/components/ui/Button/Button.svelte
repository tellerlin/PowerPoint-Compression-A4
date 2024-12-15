<script>
  export let variant = 'primary';
  export let type = 'button';
  export let disabled = false;
</script>

<button
  {type}
  {disabled}
  class="inline-flex items-center justify-center px-6 py-3 border rounded-lg text-base font-medium shadow-sm transition-all duration-200 
    {variant === 'primary' 
      ? 'bg-primary-600 text-text border-transparent hover:bg-primary-700 ring-primary-500/50' 
      : 'bg-surface text-text/90 hover:bg-surface/80 border-gray-600 ring-gray-500/50'} 
    focus:outline-none focus:ring-4
    disabled:opacity-50 disabled:cursor-not-allowed"
  on:click
>
  <slot />
</button>