<script>
  export let variant = 'primary';
  export let type = 'button';
  export let disabled = false;
  export let className = '';
  export let size = 'md';
  export let class_ = '';
  export let classList = '';
  
  // 合并classList、class_和className
  $: combinedClass = classList || class_ || className;
  
  // 定义不同尺寸的样式
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
      ? 'bg-primary-600 text-white hover:bg-primary-700 focus:ring-primary-500 border-transparent' 
      : variant === 'secondary' 
        ? 'bg-gray-800 text-white hover:bg-gray-900 focus:ring-gray-500 border-gray-600' 
        : 'bg-surface text-white hover:bg-gray-700 focus:ring-gray-500 border-gray-600'} 
    focus:outline-none focus:ring-2 focus:ring-offset-2
    disabled:opacity-50 disabled:cursor-not-allowed {sizeClass} {combinedClass}"
  class:opacity-50={disabled}
  on:click
>
  <slot />
</button>