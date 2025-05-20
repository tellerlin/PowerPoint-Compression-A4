<!-- Audio Tools Navigation Component -->
<script>
  import { page } from '$app/stores';
  import { Button } from '$lib/components/ui/Button';
  import { Container } from '$lib/components/ui';

  const tools = [
    {
      name: 'PPT Compression',
      path: '/',
      description: 'Compress PowerPoint files while maintaining quality. Supports PPTX format.',
      icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z'
    },
    {
      name: 'Audio Compression',
      path: '/audio/compress',
      description: 'Reduce audio file size while maintaining quality. Supports MP3, WAV, OGG, and M4A formats.',
      icon: 'M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3'
    },
    {
      name: 'Audio Trimmer',
      path: '/audio/trim',
      description: 'Trim audio files with precision. Supports MP3, WAV, OGG, and M4A formats.',
      icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z'
    }
  ];
</script>

<Container size="lg" class_="py-8">
  <div class="text-center mb-8">
    <h1 class="text-3xl font-bold mb-2 text-text">Byte Slim</h1>
    <p class="text-muted">Choose a tool to get started</p>
  </div>

  <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
    {#each tools as tool}
      <a
        href={tool.path}
        class="block p-6 bg-surface rounded-lg hover:bg-surface-hover transition-colors"
      >
        <div class="flex items-start space-x-4">
          <div class="flex-shrink-0">
            <svg
              class="w-8 h-8 text-primary"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d={tool.icon}
              />
            </svg>
          </div>
          <div>
            <h3 class="text-xl font-semibold text-text mb-2">{tool.name}</h3>
            <p class="text-muted">{tool.description}</p>
          </div>
        </div>
      </a>
    {/each}
  </div>
</Container> 