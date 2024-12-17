<script>
  import { Container, Button, Alert } from '$lib/components/ui';
  
  let formData = {
    name: '',
    email: '',
    subject: '',
    message: ''
  };
  
  let submitted = false;
  let error = '';
  
  async function handleSubmit() {
    submitted = true;
    // Form submission logic would go here
  }
</script>

<div class="py-24">
  <Container>
    <div class="max-w-3xl mx-auto">
      <h1 class="text-4xl font-display font-bold mb-8">Contact Us</h1>
      
      <div class="grid grid-cols-1 md:grid-cols-2 gap-12">
        <div>
          <h2 class="text-2xl font-display font-semibold mb-4">Get in Touch</h2>
          <p class="text-text/70 mb-6">Have questions? We're here to help.</p>
          
          <div class="space-y-4">
            <div class="flex items-center">
              <svg class="w-6 h-6 text-primary mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              <span>support@byteslim.com</span>
            </div>
            <div class="flex items-center">
              <svg class="w-6 h-6 text-primary mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
              <span>+1 (555) 123-4567</span>
            </div>
          </div>
        </div>
        
        <div>
          <form on:submit|preventDefault={handleSubmit} class="space-y-6">
            <div>
              <label for="name" class="block text-sm font-medium mb-1">Name</label>
              <input
                type="text"
                id="name"
                bind:value={formData.name}
                class="w-full px-4 py-2 rounded-lg border bg-surface border-border focus:ring-2 focus:ring-primary focus:border-primary"
                required
              />
            </div>
            
            <div>
              <label for="email" class="block text-sm font-medium mb-1">Email</label>
              <input
                type="email"
                id="email"
                bind:value={formData.email}
                class="w-full px-4 py-2 rounded-lg border bg-surface border-border focus:ring-2 focus:ring-primary focus:border-primary"
                required
              />
            </div>
            
            <div>
              <label for="subject" class="block text-sm font-medium mb-1">Subject</label>
              <input
                type="text"
                id="subject"
                bind:value={formData.subject}
                class="w-full px-4 py-2 rounded-lg border bg-surface border-border focus:ring-2 focus:ring-primary focus:border-primary"
                required
              />
            </div>
            
            <div>
              <label for="message" class="block text-sm font-medium mb-1">Message</label>
              <textarea
                id="message"
                bind:value={formData.message}
                class="w-full px-4 py-2 rounded-lg border bg-surface border-border focus:ring-2 focus:ring-primary focus:border-primary"
                rows="4"
                required
              ></textarea>
            </div>
            
            <Button type="submit" variant="primary" class="w-full">Send Message</Button>
          </form>
          
          {#if submitted}
            <Alert type="success" class="mt-6">
              Thank you for your message. We'll get back to you soon!
            </Alert>
          {/if}
          
          {#if error}
            <Alert type="error" class="mt-6">
              {error}
            </Alert>
          {/if}
        </div>
      </div>
    </div>
  </Container>
</div>