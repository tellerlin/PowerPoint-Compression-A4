<script>
  import { alertTypes } from './types';
  
  export let type = 'info';
  export let title = '';
  export let class_ = '';

  let visible = true;
</script>

{#if visible}
  <div
    role="alert"
    class="rounded-lg border p-4
      {alertTypes[type].bg}
      {alertTypes[type].border}
      {alertTypes[type].text}
      {class_}"
  >
    <div class="flex items-start">
      <div class="flex-shrink-0">
        {@html alertTypes[type].icon}
      </div>
      <div class="ml-3">
        {#if title}
          <h3 class="text-sm font-medium">{title}</h3>
        {/if}
        <div class="text-sm mt-1">
          <slot />
        </div>
      </div>
    </div>
  </div>
{/if}