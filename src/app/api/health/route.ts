import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: 'socialflow-ai-studio',
    time: new Date().toISOString(),
    realPublishing: process.env.ENABLE_REAL_PUBLISHING === 'true',
    realAi: process.env.ENABLE_REAL_AI === 'true',
    canvaApi: process.env.ENABLE_CANVA_API === 'true',
  });
}
