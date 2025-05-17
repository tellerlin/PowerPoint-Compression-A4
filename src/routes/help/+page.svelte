<script>
  import { Container } from '$lib/components/ui';
</script>

<div class="py-24">
  <Container>
    <div class="max-w-3xl mx-auto">
      <h1 class="text-4xl font-display font-bold mb-8 text-primary">Help Center</h1>
      <div class="space-y-6">
        <div class="bg-surface rounded-lg p-8 shadow-sm">
          <h2 class="text-2xl font-display font-semibold mb-4 text-text">Core Features</h2>
          <ul>
            <li class="flex items-start">
              <span class="text-primary mr-2">•</span>
              <span><strong class="text-text">PPT Compression:</strong> Select PowerPoint files with a simple click and compress them while maintaining quality.</span>
            </li>
            <li class="flex items-start">
              <span class="text-primary mr-2">•</span>
              <span><strong class="text-text">Audio Compression:</strong> Reduce audio file size while maintaining sound quality.</span>
            </li>
            <li class="flex items-start">
              <span class="text-primary mr-2">•</span>
              <span><strong class="text-text">Audio Trimmer:</strong> Trim audio files with precision to get exactly the segments you need.</span>
            </li>
            <li class="flex items-start">
              <span class="text-primary mr-2">•</span>
              <span><strong class="text-text">File Size Limits:</strong> Supports files up to 300MB.</span>
            </li>
          </ul>
        </div>

        <div class="bg-surface rounded-lg p-8 shadow-sm">
          <h2 class="text-2xl font-display font-semibold mb-4 text-text">How to Use</h2>
          <div class="space-y-6">
            <div>
              <h3 class="text-xl font-semibold mb-2 text-text">PPT Compression</h3>
              <ul>
                <li class="flex items-start">
                  <span class="text-primary mr-2">•</span>
                  <span><strong class="text-text">Click the "Select File" button to choose your PowerPoint file.</strong></span>
                </li>
                <li class="flex items-start">
                  <span class="text-primary mr-2">•</span>
                  <span><strong class="text-text">Click the "Start Compression" button to begin the process.</strong></span>
                </li>
                <li class="flex items-start">
                  <span class="text-primary mr-2">•</span>
                  <span><strong class="text-text">Monitor the progress bar to see the status of your compression.</strong></span>
                </li>
                <li class="flex items-start">
                  <span class="text-primary mr-2">•</span>
                  <span><strong class="text-text">Once completed, download your compressed file.</strong></span>
                </li>
              </ul>
            </div>

            <div>
              <h3 class="text-xl font-semibold mb-2 text-text">Audio Compression</h3>
              <ul>
                <li class="flex items-start">
                  <span class="text-primary mr-2">•</span>
                  <span><strong class="text-text">Select your audio file using the file picker.</strong></span>
                </li>
                <li class="flex items-start">
                  <span class="text-primary mr-2">•</span>
                  <span><strong class="text-text">Choose your desired compression settings.</strong></span>
                </li>
                <li class="flex items-start">
                  <span class="text-primary mr-2">•</span>
                  <span><strong class="text-text">Click "Compress" to start the process.</strong></span>
                </li>
                <li class="flex items-start">
                  <span class="text-primary mr-2">•</span>
                  <span><strong class="text-text">Download your compressed audio file when ready.</strong></span>
                </li>
              </ul>
            </div>

            <div>
              <h3 class="text-xl font-semibold mb-2 text-text">Audio Trimmer</h3>
              <ul>
                <li class="flex items-start">
                  <span class="text-primary mr-2">•</span>
                  <span><strong class="text-text">Upload your audio file to the trimmer.</strong></span>
                </li>
                <li class="flex items-start">
                  <span class="text-primary mr-2">•</span>
                  <span><strong class="text-text">Use the waveform visualization to select start and end points.</strong></span>
                </li>
                <li class="flex items-start">
                  <span class="text-primary mr-2">•</span>
                  <span><strong class="text-text">Preview the trimmed section if needed.</strong></span>
                </li>
                <li class="flex items-start">
                  <span class="text-primary mr-2">•</span>
                  <span><strong class="text-text">Click "Trim" to process and download your trimmed audio.</strong></span>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div class="bg-surface rounded-lg p-8 shadow-sm">
          <h2 class="text-2xl font-display font-semibold mb-4 text-text">Troubleshooting</h2>
          <p class="text-text/70 leading-relaxed">
            If you encounter any issues, consider the following:
          </p>
          <ul>
            <li class="flex items-start">
              <span class="text-primary mr-2">•</span>
              <span><strong class="text-text">Ensure your files are in supported formats (PPTX, MP3, WAV, etc.).</strong></span>
            </li>
            <li class="flex items-start">
              <span class="text-primary mr-2">•</span>
              <span><strong class="text-text">Check that the file size does not exceed 300MB.</strong></span>
            </li>
            <li class="flex items-start">
              <span class="text-primary mr-2">•</span>
              <span><strong class="text-text">Refresh the page if the upload or processing fails.</strong></span>
            </li>
            <li class="flex items-start">
              <span class="text-primary mr-2">•</span>
              <span><strong class="text-text">Make sure you have a stable internet connection.</strong></span>
            </li>
          </ul>
        </div>

      </div>
    </div>
  </Container>
</div>