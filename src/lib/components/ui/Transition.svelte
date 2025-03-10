<script>
  import { fade, fly, slide } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  
  export let type = "fade";
  export let duration = 300;
  export let delay = 0;
  
  const transitionMap = {
    fade: (node) => fade(node, { duration, delay }),
    fly: (node) => fly(node, { y: 20, duration, delay, easing: quintOut }),
    slide: (node) => slide(node, { duration, delay }),
    scale: (node) => {
      return {
        duration,
        delay,
        css: t => `
          transform: scale(${t});
          opacity: ${t};
        `
      };
    }
  };
</script>

<div transition:fade={{ duration: 0 }}>
  <div transition:{transitionMap[type]}>
    <slot />
  </div>
</div>