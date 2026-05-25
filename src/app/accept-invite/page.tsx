'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardFooter, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function AcceptInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const token = sp.get('token') ?? '';
  const [needsAccount, setNeedsAccount] = useState(false);
  const [form, setForm] = useState({ name: '', password: '' });
  const [loading, setLoading] = useState(false);

  async function accept() {
    setLoading(true);
    const res = await fetch('/api/team/invites/accept', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, ...(needsAccount ? form : {}) }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setLoading(false);
      if (j.message?.includes('Mot de passe')) {
        setNeedsAccount(true);
        return;
      }
      toast.error(j.message ?? 'Erreur');
      return;
    }
    if (needsAccount && form.password) {
      // Auto sign-in after registration
      const email = sp.get('email');
      if (email) await signIn('credentials', { email, password: form.password, redirect: false });
    }
    toast.success('Invitation acceptée');
    router.push('/dashboard');
  }

  useEffect(() => { if (token && !needsAccount) accept(); /* eslint-disable-next-line */ }, [token]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Accepter l'invitation</CardTitle>
          <CardDescription>
            {needsAccount ? 'Crée ton compte pour rejoindre l\'organisation.' : 'Validation en cours...'}
          </CardDescription>
        </CardHeader>
        {needsAccount ? (
          <>
            <CardContent className="space-y-3">
              <div className="space-y-2"><Label>Nom</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
              <div className="space-y-2"><Label>Mot de passe (min 8)</Label><Input type="password" minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required /></div>
            </CardContent>
            <CardFooter>
              <Button variant="brand" className="w-full" onClick={accept} disabled={loading}>{loading ? '...' : 'Rejoindre'}</Button>
            </CardFooter>
          </>
        ) : null}
      </Card>
    </div>
  );
}

export default function AcceptInvitePage() {
  return <Suspense fallback={<div className="p-8 text-center">Chargement...</div>}><AcceptInner /></Suspense>;
}
