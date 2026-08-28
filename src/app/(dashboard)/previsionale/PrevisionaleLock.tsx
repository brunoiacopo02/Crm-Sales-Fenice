"use client";

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Lock } from 'lucide-react';
import { unlockPrevisionale } from '@/app/actions/previsionaleActions';

/**
 * Solo il form: la password viaggia al server e viene confrontata lì, nel
 * bundle client non ne esiste traccia.
 */
export default function PrevisionaleLock() {
    const router = useRouter();
    const [value, setValue] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();

    const submit = (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
            const res = await unlockPrevisionale(value);
            if (!res.ok) {
                setError(res.error ?? 'Password errata.');
                setValue('');
                return;
            }
            router.refresh();
        });
    };

    return (
        <div className="mx-auto mt-10 max-w-md">
            <div className="rounded-2xl border border-ash-200/60 bg-white p-6 shadow-soft sm:p-8">
                <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-orange/10 text-brand-orange">
                        <Lock className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                        <h1 className="text-lg font-bold text-brand-charcoal">Previsionale</h1>
                        <p className="text-sm text-ash-500">Area riservata alla Direzione.</p>
                    </div>
                </div>

                <p className="mt-5 text-sm leading-relaxed text-ash-600">
                    Questa pagina contiene budget, marginalità e proiezioni di fatturato.
                    Inserisci la password di accesso per aprirla: resta sbloccata per 8 ore.
                </p>

                <form onSubmit={submit} className="mt-5 space-y-3">
                    <label className="block">
                        <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ash-500">
                            Password
                        </span>
                        <input
                            type="password"
                            autoFocus
                            autoComplete="off"
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                            className="w-full rounded-lg border border-ash-200 bg-ash-50/60 px-3 py-2.5 text-brand-charcoal outline-none transition-colors focus:border-brand-orange focus:bg-white"
                            placeholder="••••"
                        />
                    </label>

                    {error && (
                        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
                            {error}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={pending || value.length === 0}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-orange px-4 py-2.5 font-semibold text-brand-charcoal transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <KeyRound className="h-4 w-4" />
                        {pending ? 'Verifica…' : 'Sblocca'}
                    </button>
                </form>
            </div>
        </div>
    );
}
