<script>
  import { Container } from '$lib/components/ui';
</script>

<style>
</style>

<div class="py-24">
  <Container>
    <div class="max-w-3xl mx-auto">
      <h1 class="text-4xl font-display font-bold mb-8 text-primary">Contact Us</h1>
      
      <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div class="space-y-6">
          <div class="bg-surface rounded-lg p-8 shadow-sm">
            <h2 class="text-2xl font-display font-semibold mb-4 text-text">Get in Touch</h2>
            <p class="text-text/70 mb-4">
              Have questions about our PPT compression, audio compression, or audio trimming features? We're here to help!
            </p>
            <div class="flex items-center justify-center space-x-3">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              <a 
                  href="mailto:info@byteslim.com" 
                  class="text-2xl text-white hover:text-blue-800 hover:underline"
              >
                  info@byteslim.com
              </a>
            </div>
          </div>

          <div class="bg-surface rounded-lg p-8 shadow-sm">
            <h2 class="text-2xl font-display font-semibold mb-4 text-text">Support Hours</h2>
            <p class="text-text/70">
              We typically respond to inquiries within 24 hours during business days.
            </p>
          </div>
        </div>

        <div class="space-y-6">
          <div class="bg-surface rounded-lg p-8 shadow-sm">
            <h2 class="text-2xl font-display font-semibold mb-4 text-text">Quick Links</h2>
            <ul class="space-y-4">
              <li>
                <a href="/help" class="text-text/70 hover:text-primary">Help Center</a>
              </li>
              <li>
                <a href="/faq" class="text-text/70 hover:text-primary">FAQ</a>
              </li>
              <li>
                <a href="/blog" class="text-text/70 hover:text-primary">Blog</a>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  </Container>
</div>