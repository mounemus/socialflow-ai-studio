import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export default function BillingPage() {
  const plans = [
    { name: 'Free', price: '0 €', features: ['1 marque', '2 comptes sociaux', 'Génération IA mockée', 'Publication mock'] },
    { name: 'Pro', price: '29 €/mo', features: ['5 marques', '15 comptes', '100k tokens IA réels', 'Publication réelle', 'Veille marketing'] },
    { name: 'Agency', price: '99 €/mo', features: ['Marques illimitées', 'Espaces clients', 'Validation client', 'Analytique avancée'] },
    { name: 'Enterprise', price: 'Sur devis', features: ['Multi-organisation', 'SSO', 'SLA', 'Support dédié'] },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Facturation</h1>
        <p className="text-sm text-muted-foreground">Stripe sera branché à la prochaine itération.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {plans.map((p) => (
          <Card key={p.name}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                {p.name}
                <Badge variant="secondary">{p.price}</Badge>
              </CardTitle>
              <CardDescription>Inclus :</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1 text-sm">
                {p.features.map((f) => <li key={f}>· {f}</li>)}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
