<script>
  export let value = 0;
  export let color = "primary";
  export let height = "2.5";
</script>

<div class="w-full bg-surface-darker rounded-full" style="height: {height}px">
  <div
    class="h-full rounded-full transition-all ease-out duration-500"
    class:bg-primary={color === "primary"}
    class:bg-success={color === "success"}
    class:bg-warning={color === "warning"}
    class:bg-error={color === "error"}
    style="width: {value}%"
  />
</div>