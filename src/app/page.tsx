import Link from 'next/link';
import { useTranslations } from 'next-intl';

export default function LandingPage() {
  return <LandingContent />;
}

function LandingContent() {
  const t = useTranslations();
  return (
    <main className="min-h-screen bg-gradient-to-b from-white via-slate-50 to-slate-100">
      <header className="container flex items-center justify-between py-6">
        <div className="text-xl font-bold tracking-tight">SocialFlow <span className="text-brand-600">AI</span></div>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/login" className="text-slate-600 hover:text-slate-900">Connexion</Link>
          <Link href="/register" className="rounded-lg bg-slate-900 px-4 py-2 text-white hover:bg-slate-800">
            Démarrer
          </Link>
        </nav>
      </header>

      <section className="container py-20 text-center">
        <h1 className="mx-auto max-w-4xl text-5xl font-bold tracking-tight md:text-6xl">
          {t('app.tagline')}
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-600">
          Multi-marques, multi-comptes, multi-supports. IA générative, veille concurrentielle,
          intégration Canva, publication automatisée. Construit pour les créateurs, agences et marques.
        </p>
        <div className="mt-10 flex justify-center gap-4">
          <Link href="/register" className="rounded-lg bg-brand-600 px-6 py-3 text-white shadow-lg hover:bg-brand-700">
            Créer mon espace
          </Link>
          <Link href="/dashboard" className="rounded-lg border border-slate-300 bg-white px-6 py-3 text-slate-700 hover:bg-slate-50">
            Voir la démo
          </Link>
        </div>
      </section>

      <section className="container grid gap-6 pb-24 md:grid-cols-3">
        {[
          { title: 'IA multi-plateforme', desc: 'Posts, captions, scripts, threads, briefs Canva — adaptés à chaque réseau.' },
          { title: 'Veille marketing', desc: 'Tendances, hashtags, concurrents, RSS, scoring d\'opportunité.' },
          { title: 'Publication unifiée', desc: 'Calendrier multi-marques, approbation client, queue robuste, retry auto.' },
        ].map((c) => (
          <div key={c.title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="font-semibold text-slate-900">{c.title}</h3>
            <p className="mt-2 text-sm text-slate-600">{c.desc}</p>
          </div>
        ))}
      </section>

      <footer className="border-t border-slate-200 py-8 text-center text-sm text-slate-500">
        © {new Date().getFullYear()} SocialFlow AI Studio — Mode démo
      </footer>
    </main>
  );
}
