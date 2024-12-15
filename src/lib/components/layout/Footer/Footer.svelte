<script>
  import { Container } from '$lib/components/ui';
  
  const footerSections = [
    {
      title: 'Product',
      links: [
        { href: '/', label: 'Home' },
        { href: '/about', label: 'About' },
        { href: '/faq', label: 'FAQ' }
      ]
    },
    {
      title: 'Company',
      links: [
        { href: '/privacy', label: 'Privacy' },
        { href: '/terms', label: 'Terms' },
        { href: '/contact', label: 'Contact' }
      ]
    },
    {
      title: 'Resources',
      links: [
        { href: '/blog', label: 'Blog' },
        { href: '/help', label: 'Help Center' },
        { href: '/sitemap', label: 'Sitemap' }
      ]
    }
  ];
</script>

<footer class="bg-surface border-t border-border">
  <Container>
    <div class="py-12">
      <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
        {#each footerSections as section}
          <div>
            <h3 class="text-sm font-semibold text-text tracking-wider uppercase">
              {section.title}
            </h3>
            <ul class="mt-4 space-y-4">
              {#each section.links as link}
                <li>
                  <a
                    href={link.href}
                    class="text-base text-text/70 hover:text-text transition-colors duration-150"
                  >
                    {link.label}
                  </a>
                </li>
              {/each}
            </ul>
          </div>
        {/each}
      </div>
      <div class="mt-8 pt-8 border-t border-border">
        <p class="text-base text-text/50 text-center">
          © {new Date().getFullYear()} PPTX Compressor. All rights reserved.
        </p>
      </div>
    </div>
  </Container>
</footer>