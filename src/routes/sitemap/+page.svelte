<script>
  import { Container } from '$lib/components/ui';
  
  const sections = [
    {
      title: 'Main',
      links: [
        { title: 'Home', url: '/' },
        { title: 'About', url: '/about' },
        { title: 'Contact', url: '/contact' }
      ]
    },
    {
      title: 'Support',
      links: [
        { title: 'Help Center', url: '/help' },
        { title: 'FAQ', url: '/faq' },
        { title: 'Blog', url: '/blog' }
      ]
    },
    {
      title: 'Legal',
      links: [
        { title: 'Privacy Policy', url: '/privacy' },
        { title: 'Terms of Service', url: '/terms' }
      ]
    }
  ];
</script>

<div class="py-24">
  <Container>
    <div class="max-w-4xl mx-auto">
      <h1 class="text-4xl font-display font-bold mb-8">Sitemap</h1>
      
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-12">
        {#each sections as section}
          <div>
            <h2 class="text-xl font-display font-semibold mb-4">{section.title}</h2>
            <ul class="space-y-2">
              {#each section.links as link}
                <li>
                  <a href={link.url} class="text-text/70 hover:text-primary">
                    {link.title}
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