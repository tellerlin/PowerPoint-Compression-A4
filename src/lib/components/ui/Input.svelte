<script>
  export const type = 'text'; // Updated export for external reference
  export let value = '';
  export let label = '';
  export let error = '';
  export let placeholder = '';
  export let required = false;
  export let disabled = false;
  export let class_ = '';

  let id = `input-${Math.random().toString(36).slice(2)}`;
</script>

<div class="form-control {class_}">
  {#if label}
    <label
      for={id}
      class="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1"
    >
      {label}
      {#if required}
        <span class="text-red-500">*</span>
      {/if}
    </label>
  {/if}

  <input
    {id}
    type="text"
    bind:value
    {placeholder}
    {required}
    {disabled}
    class="w-full px-4 py-2 rounded-lg border
      bg-white dark:bg-gray-800
      text-gray-900 dark:text-gray-100
      border-gray-300 dark:border-gray-600
      focus:ring-2 focus:ring-primary-500 focus:border-primary-500
      disabled:opacity-50 disabled:cursor-not-allowed
      transition duration-200 ease-out
      {error ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : ''}"
    aria-invalid={!!error}
    aria-describedby={error ? `${id}-error` : undefined}
  />

  {#if error}
    <p
      id="{id}-error"
      class="mt-1 text-sm text-red-500"
      role="alert"
    >
      {error}
    </p>
  {/if}
</div>