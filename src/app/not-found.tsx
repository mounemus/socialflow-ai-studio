import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-white via-slate-50 to-slate-100 px-6 text-center">
      <div className="text-xl font-bold tracking-tight">
        SocialFlow <span className="text-brand-600">AI</span>
      </div>
      <p className="mt-8 text-7xl font-bold tracking-tight text-slate-900">404</p>
      <h1 className="mt-4 text-2xl font-semibold text-slate-800">Page introuvable</h1>
      <p className="mx-auto mt-3 max-w-md text-slate-600">
        La page que vous cherchez n’existe pas ou a été déplacée.
      </p>
      <div className="mt-8 flex justify-center gap-4">
        <Link
          href="/dashboard"
          className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-800"
        >
          Retour au tableau de bord
        </Link>
        <Link
          href="/"
          className="rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Accueil
        </Link>
      </div>
    </main>
  );
}
