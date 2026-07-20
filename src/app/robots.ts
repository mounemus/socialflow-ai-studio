import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://socialflow-ai-studio.vercel.app';
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // App surface is authenticated — no value in letting crawlers hammer it.
        disallow: ['/api/', '/admin/', '/dashboard'],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
