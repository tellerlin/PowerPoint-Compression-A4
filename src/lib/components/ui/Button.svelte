<script>
  export let variant = 'primary';
  export let type = 'button';
  export let disabled = false;
</script>

<button
  {type}
  {disabled}
  class="btn {variant === 'primary' ? 'btn-primary' : 'btn-secondary'}"
  class:opacity-50={disabled}
  on:click
>
  <slot />
</button>