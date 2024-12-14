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
      ? 'bg-primary-600 text-white hover:bg-primary-700 border-transparent ring-primary-500/50' 
      : 'bg-white text-gray-700 hover:bg-gray-50 border-gray-300 ring-gray-500/50'} 
    focus:outline-none focus:ring-4
    disabled:opacity-50 disabled:cursor-not-allowed"
  on:click
>
  <slot />
</button>