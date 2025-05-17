<script>
  import { Container } from '$lib/components/ui';
  
  const faqs = [
    {
      category: 'General',
      questions: [
        {
          q: 'What is ByteSlim?',
          a: 'ByteSlim is a free online tool that helps you compress PowerPoint presentations and audio files while maintaining their quality. It also provides audio trimming functionality.'
        },
        {
          q: 'Is ByteSlim free to use?',
          a: 'Yes, ByteSlim is completely free for personal use.'
        }
      ]
    },
    {
      category: 'Technical',
      questions: [
        {
          q: 'What file types are supported?',
          a: 'We support PPTX files (PowerPoint 2007 and newer) for compression, and common audio formats (MP3, WAV, etc.) for both compression and trimming.'
        },
        {
          q: 'Is there a file size limit?',
          a: 'Yes, the maximum file size is 300MB for all supported file types.'
        }
      ]
    },
    {
      category: 'Features',
      questions: [
        {
          q: 'What features does ByteSlim offer?',
          a: 'ByteSlim offers three main features: PPT Compression, Audio Compression, and Audio Trimming. All processing is done locally in your browser.'
        },
        {
          q: 'How does audio trimming work?',
          a: 'Our audio trimmer allows you to select specific segments of your audio files using a waveform visualization, preview the selection, and download the trimmed portion.'
        }
      ]
    },
    {
      category: 'Privacy & Security',
      questions: [
        {
          q: 'Are my files stored on your servers?',
          a: 'No, all processing is done in your browser. Files are never uploaded to our servers.'
        },
        {
          q: 'Is my data secure?',
          a: 'Yes, since all processing happens locally in your browser, your files never leave your device.'
        }
      ]
    }
  ];
</script>

<div class="py-24">
  <Container>
    <div class="max-w-3xl mx-auto">
      <h1 class="text-4xl font-display font-bold mb-8 text-primary">Frequently Asked Questions</h1>
      
      <div class="space-y-12">
        {#each faqs as category}
          <div>
            <h2 class="text-2xl font-display font-semibold mb-6">{category.category}</h2>
            <div class="space-y-6">
              {#each category.questions as {q, a}}
                <div class="bg-surface p-6 rounded-lg">
                  <h3 class="text-lg font-semibold mb-2">{q}</h3>
                  <p class="text-text/70">{a}</p>
                </div>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    </div>
  </Container>
</div>