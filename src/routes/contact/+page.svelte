<script>
  import { Container } from '$lib/components/ui';
</script>

<style>
  .email-text {
    font-size: 28px; /* Increased font size */
  }
  .email-icon {
    width: 32px; /* Adjust icon size as needed */
    height: 32px; /* Adjust icon size as needed */
    color: white; /* Set icon color to white */
  }
</style>

<div class="py-24">
  <Container>
    <div class="max-w-3xl mx-auto">
      <h1 class="text-4xl font-display font-bold mb-8 text-primary">Contact Us</h1>
      
      <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div class="space-y-6">
          <div class="bg-surface rounded-lg p-8 shadow-sm">
           
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
        </div>
      </div>
    </div>
  </Container>
</div>