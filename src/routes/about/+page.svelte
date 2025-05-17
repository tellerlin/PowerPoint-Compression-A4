<script defer>
    import { Container } from '$lib/components/ui';

    const features = [
        {
            title: "Smart Compression",
            description: "Optimize PowerPoint and audio files while maintaining quality.",
            icon: "🚀"
        },
        {
            title: "Privacy First",
            description: "All processing happens in your browser.",
            icon: "🔒"
        },
        {
            title: "Multiple Tools",
            description: "PPT compression, audio compression, and audio trimming in one place.",
            icon: "✨"
        }
    ];

    const jsonLd = {
        "@context": "https://schema.org",
        "@type": "WebPage",
        "name": "About ByteSlim - File Compression Tools",
        "description": "Learn how ByteSlim's advanced compression technology helps reduce PowerPoint and audio file sizes while maintaining quality. Discover our commitment to privacy and security.",
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
    <title>About ByteSlim - File Compression Tools</title>
    <meta name="description" content="Discover how ByteSlim's innovative compression technology helps reduce PowerPoint and audio file sizes while maintaining quality. Features include PPT compression, audio compression, and audio trimming. Learn about our privacy-first approach and commitment to security.">
    <script type="application/ld+json">
        {JSON.stringify(jsonLd)}
    </script>
</svelte:head>

<style>
  .box-container {
    display: flex;
    justify-content: space-between;
    flex-wrap: nowrap;
    max-width: 1200px;
    margin: 0 auto;
  }
  .box {
    flex: 0 1 35%; /* Increase the basis to 35% for wider boxes */
    margin: 10px;
    min-width: 250px;
  }
  @media (max-width: 768px) {
    .box-container {
      flex-direction: column;
    }
    a {
      word-wrap: break-word;
      overflow-wrap: break-word;
      white-space: normal;
    }
  }
</style>

<div class="py-24">
  <Container>
    <div class="max-w-3xl mx-auto">
      <h1 class="text-4xl font-display font-bold mb-8 text-primary">
        About ByteSlim Compression
      </h1>
        
      <div class="max-w-3xl mx-auto">

        <h2 class="text-2xl font-bold mb-4 text-text">
          Features
        </h2>

        <h2 class="text-xl font-bold mb-4 text-text">
          Our Key Features
        </h2>

        <div class="box-container">
          {#each features as feature}
              <div class="box bg-surface rounded-lg p-8 shadow-sm">
                <div class="text-4xl mb-4">{feature.icon}</div>
                <h3 class="text-2xl font-bold mb-4 text-text">
                  {feature.title}
                </h3>
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