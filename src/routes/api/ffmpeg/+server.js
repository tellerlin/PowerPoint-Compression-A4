import { json } from '@sveltejs/kit';

export async function GET({ url }) {
  const path = url.searchParams.get('path');
  if (!path) {
    return new Response('Missing path parameter', { status: 400 });
  }

  try {
    const response = await fetch(`https://freecompress.com/node_modules/@ffmpeg/${path}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.statusText}`);
    }

    const data = await response.arrayBuffer();
    const headers = new Headers();
    headers.set('Content-Type', path.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Cross-Origin-Resource-Policy', 'cross-origin');

    return new Response(data, { headers });
  } catch (error) {
    console.error('Error fetching FFmpeg file:', error);
    return new Response(error.message, { status: 500 });
  }
} 