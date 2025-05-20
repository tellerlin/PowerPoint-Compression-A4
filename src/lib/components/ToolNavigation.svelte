<script>
  import { page } from '$app/stores';
</script>

<div class="flex justify-center space-x-4 mb-8">
  <a 
    href="/" 
    class="px-4 py-2 rounded-lg transition-colors duration-200 {($page.url.pathname === '/') ? 'bg-primary text-white' : 'bg-surface hover:bg-surface-hover text-text'}"
  >
    PPTX Compression
  </a>
  <a 
    href="/audio/compress" 
    class="px-4 py-2 rounded-lg transition-colors duration-200 {($page.url.pathname.startsWith('/audio/compress')) ? 'bg-primary text-white' : 'bg-surface hover:bg-surface-hover text-text'}"
  >
    Audio Compression
  </a>
  <a 
    href="/audio/trim" 
    class="px-4 py-2 rounded-lg transition-colors duration-200 {($page.url.pathname.includes('/audio/trim')) ? 'bg-primary text-white' : 'bg-surface hover:bg-surface-hover text-text'}"
  >
    Audio Trimmer
  </a>
</div> 