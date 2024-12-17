<script>
  import { Container } from '$lib/components/ui';
  
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
      title: 'The Future of File Compression',
      excerpt: 'Exploring upcoming technologies in file compression and optimization.',
      image: '/images/blog/future-compression.jpg',
      slug: 'future-compression',
      date: '2024-03-10',
      author: 'Michael Chen'
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