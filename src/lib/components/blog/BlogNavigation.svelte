<script>
  import { Container } from '$lib/components/ui';
  
  export let currentPost = '';
  
  const navigationItems = [
    {
      title: 'Tools',
      links: [
        { href: '/', label: 'PPT Compression' },
        { href: '/audio/compress', label: 'Audio Compression' },
        { href: '/audio/trim', label: 'Audio Trimming' }
      ]
    },
    {
      title: 'Blog Posts',
      links: [
        { href: '/blog/posts/optimizing-powerpoint', label: 'PowerPoint Optimization Guide' },
        { href: '/blog/posts/audio-compression', label: 'Audio Compression Tips' },
        { href: '/blog/posts/audio-trimming', label: 'Audio Trimming Guide' },
        { href: '/blog/posts/file-size-matters', label: 'Why File Size Matters' },
        { href: '/blog/posts/future-compression', label: 'The Future of File Compression' }
      ]
    },
    {
      title: 'Support',
      links: [
        { href: '/help', label: 'Help Center' },
        { href: '/faq', label: 'FAQ' },
        { href: '/contact', label: 'Contact Us' }
      ]
    }
  ];
</script>

<div class="bg-surface/50 border-t border-border mt-12">
  <Container>
    <div class="py-8">
      <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
        {#each navigationItems as section}
          <div>
            <h3 class="text-lg font-display font-semibold mb-4 text-text">
              {section.title}
            </h3>
            <ul class="space-y-3">
              {#each section.links as link}
                <li>
                  <a
                    href={link.href}
                    class="text-text/70 hover:text-primary transition-colors duration-150 {currentPost === link.href ? 'text-primary font-medium' : ''}"
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
        <div class="flex flex-wrap gap-4 justify-center">
          <a href="/" class="text-text/70 hover:text-primary transition-colors">Home</a>
          <a href="/blog" class="text-text/70 hover:text-primary transition-colors">Blog</a>
          <a href="/about" class="text-text/70 hover:text-primary transition-colors">About Us</a>
          <a href="/privacy" class="text-text/70 hover:text-primary transition-colors">Privacy Policy</a>
          <a href="/terms" class="text-text/70 hover:text-primary transition-colors">Terms of Service</a>
        </div>
      </div>
    </div>
  </Container>
</div> 