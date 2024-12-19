<script>
    import { Container } from '$lib/components/ui';

    const features = [
        {
            title: "Smart Compression",
            description: "Our advanced algorithms intelligently optimize images and remove unused media to significantly reduce file size while preserving the visual quality of your presentations.",
            icon: "🚀"
        },
        {
            title: "Privacy First",
            description: "Security is our priority. All file processing happens directly in your browser - your presentations never leave your device, ensuring complete confidentiality.",
            icon: "🔒"
        },
        {
            title: "Quality Preserved",
            description: "Experience up to 90% file size reduction while maintaining the professional look of your presentations. Perfect for sharing via email or uploading to platforms.",
            icon: "✨"
        }
    ];

    const jsonLd = {
        "@context": "https://schema.org",
        "@type": "WebPage",
        "name": "About ByteSlim - PowerPoint Compression Tool",
        "description": "Learn how ByteSlim's advanced compression technology helps reduce PowerPoint file sizes while maintaining quality. Discover our commitment to privacy and security.",
        "mainEntity": {
            "@type": "WebApplication",
            "name": "ByteSlim",
            "applicationCategory": "Productivity",
            "operatingSystem": "All",
            "offers": {
                "@type": "Offer",
                "price": "0",
                "priceCurrency": "USD"
            }
        }
    };
</script>

<svelte:head>
    <title>About ByteSlim Compression</title>
    <meta name="description" content="Discover how ByteSlim's innovative compression technology reduces PowerPoint file sizes while maintaining quality. Learn about our privacy-first approach and commitment to security.">
    <script type="application/ld+json">
        {JSON.stringify(jsonLd)}
    </script>
</svelte:head>

<div class="py-24">
  <Container>
    <div class="max-w-3xl mx-auto">
      <h1 class="text-4xl font-display font-bold mb-8 text-primary">
        About ByteSlim Compression
      </h1>
        
      <div class="max-w-3xl mx-auto">

        <div class="grid gap-8 mb-16">
          {#each features as feature}
              <div class="bg-surface rounded-lg p-8 shadow-sm">
                <div class="text-4xl mb-4">{feature.icon}</div>
                <h2 class="text-2xl font-bold mb-4 text-text">
                  {feature.title}
                </h2>
                <p class="text-text/70 text-lg">
                  {feature.description}
                </p>
              </div>
          {/each}
        </div>

        <div class="bg-surface rounded-lg p-8 shadow-sm mt-16">
          <h2 class="text-2xl font-bold mb-3 text-text">
            Support Us
          </h2>

          <p class="text-base text-text/70 mb-4 max-w-4xl mx-auto text-center whitespace-normal md:whitespace-nowrap">
            Keeping this tool free takes work. If it's been a lifesaver, buy me a coffee?
          </p>

          <div style="text-align: center;">
            <a href="https://buymeacoffee.com/byteslim" target="_blank" style="color: lightblue; text-decoration: underline;">https://buymeacoffee.com/byteslim</a>
          </div>

          <div class="flex justify-center space-x-24 items-start">
            <div id="buy-me-a-coffee-qr" class="w-32 h-40">
              <img 
                src="/images/bmc_qr.png" 
                alt="Buy Me a Coffee Donation QR Code" 
                class="w-full h-full object-contain rounded-lg"
                loading="lazy"
                width="128"
                height="128"
              />
            </div>
            <div id="alipay-qr" class="w-32 h-40">
              <img 
                src="/images/alipay_qr.png" 
                alt="Alipay Donation QR Code" 
                class="w-full h-full object-contain rounded-lg"
                loading="lazy"
                width="128"
                height="128"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </Container>
</div>