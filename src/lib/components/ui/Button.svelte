<script>
  export let className = '';
  export let variant = 'primary';
  export let type = 'button';
  export let disabled = false;
</script>

<button
  {type}
  {disabled}
  class="inline-flex items-center justify-center px-6 py-3 border rounded-lg text-base font-medium shadow-sm transition-all duration-200 
    {variant === 'primary' 
      ? 'bg-primary-600 text-white hover:bg-primary-700 focus:ring-primary-500 border-transparent' 
      : variant === 'secondary' 
        ? 'bg-gray-800 text-white hover:bg-gray-900 focus:ring-gray-500 border-gray-600' 
        : 'bg-surface text-white hover:bg-gray-700 focus:ring-gray-500 border-gray-600'} 
    focus:outline-none focus:ring-2 focus:ring-offset-2
    disabled:opacity-50 disabled:cursor-not-allowed {className}"
  class:opacity-50={disabled}
  on:click
>
  <slot />
</button>