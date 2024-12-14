<script>
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

<footer class="bg-gray-50 border-t border-gray-200">
  <div class="max-w-7xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
    <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
      {#each footerSections as section}
        <div>
          <h3 class="text-sm font-semibold text-gray-900 tracking-wider uppercase">
            {section.title}
          </h3>
          <ul class="mt-4 space-y-4">
            {#each section.links as link}
              <li>
                <a
                  href={link.href}
                  class="text-base text-gray-600 hover:text-gray-900 transition-colors duration-150"
                >
                  {link.label}
                </a>
              </li>
            {/each}
          </ul>
        </div>
      {/each}
    </div>
    <div class="mt-8 pt-8 border-t border-gray-200">
      <p class="text-base text-gray-400 text-center">
        © {new Date().getFullYear()} PPTX Compressor. All rights reserved.
      </p>
    </div>
  </div>
</footer>