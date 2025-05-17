<script>
  export let variant = 'primary';
  export let type = 'button';
  export let disabled = false;
  export let className = '';
  export let size = 'md';
  export let class_ = '';
  export let classList = '';
  
  $: combinedClass = classList || class_ || className;
  
  $: sizeClass = {
    'sm': 'px-3 py-1.5 text-sm',
    'md': 'px-6 py-3 text-base',
    'lg': 'px-8 py-4 text-lg'
  }[size] || 'px-6 py-3 text-base';
</script>

<button
  {type}
  {disabled}
  class="inline-flex items-center justify-center border rounded-lg font-medium shadow-sm transition-all duration-200 
    {variant === 'primary' 
      ? 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500 border-transparent' 
      : variant === 'secondary' 
        ? 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500 border-transparent' 
        : variant === 'default'
          ? 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500 border-transparent'
          : 'bg-white text-blue-600 hover:bg-blue-50 focus:ring-blue-500 border-blue-600'} 
    focus:outline-none focus:ring-2 focus:ring-offset-2
    disabled:opacity-50 disabled:cursor-not-allowed {sizeClass} {combinedClass}"
  class:opacity-50={disabled}
  on:click
>
  <slot />
</button>