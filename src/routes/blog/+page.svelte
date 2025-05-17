<script>
  import { Container } from '$lib/components/ui';
  import { siteMetadata } from '$lib/config/metadata';
  
  const posts = [
    {
      title: 'Optimizing PowerPoint Presentations: A Complete Guide',
      excerpt: 'Learn the best practices for creating efficient and effective presentations.',
      image: '/images/blog/optimization-guide.jpg',
      slug: 'optimizing-powerpoint',
      date: '2024-03-15',
      author: 'Sarah Johnson'
    },
    {
      title: 'Audio Compression: Balancing Quality and File Size',
      excerpt: 'Discover how to effectively compress audio files while maintaining sound quality.',
      image: '/images/blog/audio-compression.jpg',
      slug: 'audio-compression',
      date: '2024-03-12',
      author: 'Michael Chen'
    },
    {
      title: 'The Future of File Compression',
      excerpt: 'Exploring upcoming technologies in file compression and optimization.',
      image: '/images/blog/future-compression.jpg',
      slug: 'future-compression',
      date: '2024-03-10',
      author: 'Michael Chen'
    },
    {
      title: 'Audio Trimming: A Guide to Perfect Sound Segments',
      excerpt: 'Learn how to precisely trim audio files for professional results.',
      image: '/images/blog/audio-trimming.jpg',
      slug: 'audio-trimming',
      date: '2024-03-08',
      author: 'David Smith'
    },
    {
      title: 'Why File Size Matters in the Digital Age',
      excerpt: 'Understanding the impact of large files on productivity and sharing.',
      image: '/images/blog/file-size-matters.jpg',
      slug: 'file-size-matters',
      date: '2024-03-05',
      author: 'David Smith'
    }
  ];
</script>

<svelte:head>
  <title>Blog - ByteSlim File Compression Tools</title>
  <meta name="description" content="Read our latest articles about file compression, audio optimization, and PowerPoint presentation tips. Learn how to effectively manage your digital files.">
  <meta property="og:title" content="Blog - ByteSlim File Compression Tools">
  <meta property="og:description" content="Read our latest articles about file compression, audio optimization, and PowerPoint presentation tips. Learn how to effectively manage your digital files.">
  <meta property="og:type" content="website">
  <meta property="og:url" content={`${siteMetadata.url}/blog`}>
  <meta name="twitter:title" content="Blog - ByteSlim File Compression Tools">
  <meta name="twitter:description" content="Read our latest articles about file compression, audio optimization, and PowerPoint presentation tips. Learn how to effectively manage your digital files.">
</svelte:head>

<div class="py-24">
  <Container>
    <div class="max-w-5xl mx-auto">
      <h1 class="text-4xl font-display font-bold mb-8 text-primary">Blog</h1>
      
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {#each posts as post}
          <article class="bg-surface rounded-lg overflow-hidden shadow-md hover:shadow-lg transition-shadow">
            <a href="/blog/posts/{post.slug}" class="block">
              <div class="aspect-video bg-gray-100 relative overflow-hidden">
                <img
                  src={post.image}
                  alt={post.title}
                  class="absolute inset-0 w-full h-full object-cover"
                  loading="lazy"
                />
              </div>
              <div class="p-6">
                <div class="text-sm text-text/60 mb-2">
                  {new Date(post.date).toLocaleDateString()} • {post.author}
                </div>
                <h2 class="text-xl font-display font-semibold mb-2 text-text hover:text-primary transition-colors">
                  {post.title}
                </h2>
                <p class="text-text/70">{post.excerpt}</p>
              </div>
            </a>
          </article>
        {/each}
      </div>
    </div>
  </Container>
</div>