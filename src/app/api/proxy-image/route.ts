import { handle } from '@/lib/api';
import { requireTenant } from '@/lib/tenant';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Same-origin image proxy so the Design Studio editor can draw remote AI/Canva
 * images onto a <canvas> and export them without tainting the canvas (CORS).
 * Auth-gated, https-only, image content-type only, 25MB cap.
 */
export const GET = handle(async (req) => {
  await requireTenant();
  const url = new URL(req.url).searchParams.get('url');
  if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 });

  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return NextResponse.json({ error: 'invalid url' }, { status: 400 });
  }
  if (target.protocol !== 'https:') {
    return NextResponse.json({ error: 'https only' }, { status: 400 });
  }
  // Block internal/metadata hosts (basic SSRF guard).
  const host = target.hostname;
  if (
    host === 'localhost' || host.endsWith('.local') ||
    host.startsWith('10.') || host.startsWith('192.168.') || host.startsWith('169.254.') ||
    /^127\./.test(host)
  ) {
    return NextResponse.json({ error: 'blocked host' }, { status: 400 });
  }

  const upstream = await fetch(target.toString(), {
    headers: { accept: 'image/*' },
    redirect: 'follow',
  });
  if (!upstream.ok) {
    return NextResponse.json({ error: `upstream ${upstream.status}` }, { status: 502 });
  }
  const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';
  if (!contentType.startsWith('image/')) {
    return NextResponse.json({ error: 'not an image' }, { status: 415 });
  }
  const buf = Buffer.from(await upstream.arrayBuffer());
  if (buf.byteLength > 25 * 1024 * 1024) {
    return NextResponse.json({ error: 'too large' }, { status: 413 });
  }
  return new NextResponse(buf, {
    status: 200,
    headers: {
      'content-type': contentType,
      'cache-control': 'private, max-age=300',
    },
  });
});
