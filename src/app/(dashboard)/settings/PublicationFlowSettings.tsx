'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export default function PublicationFlowSettings() {
  const [requireApproval, setRequireApproval] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/org/settings')
      .then((res) => res.json())
      .then(({ data }) => setRequireApproval(!!data?.requireApproval))
      .catch(() => toast.error('Erreur de chargement des paramètres'))
      .finally(() => setLoading(false));
  }, []);

  async function onChange(checked: boolean) {
    setRequireApproval(checked);
    setSaving(true);
    const res = await fetch('/api/org/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requireApproval: checked }),
    });
    setSaving(false);
    if (!res.ok) {
      setRequireApproval(!checked);
      const j = await res.json().catch(() => ({}));
      return toast.error(j.message ?? 'Erreur lors de la sauvegarde');
    }
    toast.success('Paramètre enregistré');
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Flux de publication</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4"
            checked={requireApproval}
            disabled={loading || saving}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span>Exiger une validation avant de publier ou programmer</span>
        </label>
        <p className="text-muted-foreground">
          Désactivé : les contenus concrétisés arrivent directement en « Prêt à publier »
          et peuvent être publiés depuis le pipeline ou la file de production. Activé : ils
          passent par « En validation » et doivent être approuvés (page File de production)
          avant tout envoi.
        </p>
      </CardContent>
    </Card>
  );
}
