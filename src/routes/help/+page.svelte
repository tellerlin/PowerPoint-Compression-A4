<script>
  import { Container } from '$lib/components/ui';
  
  const categories = [
    {
      title: 'Getting Started',
      icon: 'M12 6v6m0 0v6m0-6h6m-6 0H6',
      articles: [
        { title: 'How to Use ByteSlim', link: '/help/how-to-use' },
        { title: 'Supported File Types', link: '/help/supported-files' },
        { title: 'File Size Limits', link: '/help/size-limits' }
      ]
    },
    {
      title: 'Troubleshooting',
      icon: 'M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
      articles: [
        { title: 'Common Issues', link: '/help/common-issues' },
        { title: 'Error Messages', link: '/help/error-messages' },
        { title: 'Browser Compatibility', link: '/help/compatibility' }
      ]
    },
    {
      title: 'Advanced Features',
      icon: 'M13 10V3L4 14h7v7l9-11h-7z',
      articles: [
        { title: 'Batch Processing', link: '/help/batch-processing' },
        { title: 'Custom Settings', link: '/help/custom-settings' },
        { title: 'API Integration', link: '/help/api' }
      ]
    }
  ];
</script>

<div class="py-24">
  <Container>
    <div class="max-w-4xl mx-auto">
      <h1 class="text-4xl font-display font-bold mb-8">Help Center</h1>
      
      <div class="mb-12">
        <div class="relative">
          <input
            type="search"
            placeholder="Search help articles..."
            class="w-full px-4 py-3 pl-12 rounded-lg border bg-surface border-border focus:ring-2 focus:ring-primary focus:border-primary"
          />
          <svg class="w-6 h-6 text-text/40 absolute left-4 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
      </div>
      
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {#each categories as category}
          <div class="bg-surface p-6 rounded-lg">
            <div class="flex items-center mb-4">
              <svg class="w-6 h-6 text-primary mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d={category.icon} />
              </svg>
              <h2 class="text-xl font-display font-semibold">{category.title}</h2>
            </div>
            <ul class="space-y-2">
              {#each category.articles as article}
                <li>
                  <a href={article.link} class="text-text/70 hover:text-primary">
                    {article.title}
                  </a>
                </li>
              {/each}
            </ul>
          </div>
        {/each}
      </div>
    </div>
  </Container>
</div>