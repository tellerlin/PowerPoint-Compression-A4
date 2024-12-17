<script>
  import '../app.css';
  import { onMount } from 'svelte';
  import { themeStore } from '$lib/stores/theme';
  import { Header } from '$lib/components/layout/Header';
  import { Footer } from '$lib/components/layout/Footer';
  import { Container } from '$lib/components/ui';

  onMount(() => {
    themeStore.initialize();
  });
</script>

<div class="min-h-screen flex flex-col bg-background text-text">
  <Header />
  
  <main class="flex-1">
    <Container>
      <slot />
    </Container>
  </main>

  <Footer />
</div>