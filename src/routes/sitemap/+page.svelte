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
      <h1 class="text-4xl font-display font-bold mb-8 text-primary">Sitemap</h1>
      
      <div class="sitemap-container">
        {#each sections as section}
          <div class="sitemap-item">
            <h2 class="text-lg font-display font-semibold mb-2">{section.title}</h2>
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

<style>
  .sitemap-container {
    display: flex;
    flex-wrap: wrap;
    gap: 20px;
    padding: 20px;
  }
  .sitemap-item {
    background: #333; /* Deep gray color */
    border: 1px solid #ddd;
    border-radius: 8px;
    padding: 15px;
    text-align: center;
    transition: transform 0.2s;
  }
  .sitemap-item:hover {
    transform: scale(1.05);
  }
</style>