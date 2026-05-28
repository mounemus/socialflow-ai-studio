'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Clock } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';

interface TimeSlot {
  iso: string;
  weekday: number;
  hour: number;
  rationale: string;
  confidence: 'low' | 'medium' | 'high';
  source: string;
}

const WEEKDAY = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

export function OptimalTimesCard({ brandId }: { brandId: string }) {
  const [platform, setPlatform] = useState('INSTAGRAM');
  const [tzOffset, setTzOffset] = useState(60); // Paris default
  const [loading, setLoading] = useState(false);
  const [slots, setSlots] = useState<TimeSlot[]>([]);

  async function load() {
    setLoading(true);
    const res = await fetch('/api/intelligence/optimal-times', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        brandId: brandId || undefined,
        platform,
        audienceTimezoneOffsetMinutes: tzOffset,
        count: 8,
      }),
    });
    setLoading(false);
    if (!res.ok) return toast.error('Calcul échoué');
    const { data } = await res.json();
    setSlots(data.slots);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-blue-600" /> Créneaux optimaux
        </CardTitle>
        <CardDescription>Empirique si tu as des analytics, sinon standards plateforme.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Plateforme</Label>
            <select className="w-full rounded-md border px-2 py-2 text-sm" value={platform} onChange={(e) => setPlatform(e.target.value)}>
              {['INSTAGRAM', 'FACEBOOK', 'LINKEDIN', 'TWITTER', 'TIKTOK', 'YOUTUBE', 'PINTEREST'].map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-xs">Fuseau audience (min)</Label>
            <select className="w-full rounded-md border px-2 py-2 text-sm" value={tzOffset} onChange={(e) => setTzOffset(Number(e.target.value))}>
              <option value={0}>UTC</option>
              <option value={60}>Paris +1</option>
              <option value={120}>Paris +2 (été)</option>
              <option value={-300}>New York −5</option>
              <option value={540}>Tokyo +9</option>
            </select>
          </div>
        </div>
        <Button onClick={load} disabled={loading} variant="brand" size="sm">
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Clock className="mr-2 h-4 w-4" />}
          Calculer
        </Button>

        {slots.length ? (
          <div className="space-y-1">
            {slots.map((s, i) => (
              <div key={i} className="flex items-center justify-between rounded-md border bg-slate-50 p-2 text-xs">
                <div>
                  <div className="font-semibold">
                    {WEEKDAY[s.weekday]} {s.hour}h00 <span className="text-muted-foreground">— {new Date(s.iso).toLocaleString('fr-FR')}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground">{s.rationale}</div>
                </div>
                <Badge variant={s.confidence === 'high' ? 'success' : s.confidence === 'medium' ? 'info' : 'secondary'} className="text-[10px]">
                  {s.source}
                </Badge>
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
