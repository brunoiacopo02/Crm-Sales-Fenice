import Link from "next/link"

/**
 * Pagina di atterraggio per i redirect "non autorizzato" (es. da
 * /manager-gdo-performance). Prima questa route non esisteva e il redirect
 * finiva in un 404. Trovato dal QA e2e 2026-06-11.
 */
export default function UnauthorizedPage() {
    return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-gray-50 p-6 text-center">
            <div className="text-5xl">🔒</div>
            <h1 className="text-2xl font-bold text-gray-800">Non sei autorizzato</h1>
            <p className="max-w-md text-sm text-gray-500">
                Questa sezione non è disponibile per il tuo ruolo. Se pensi sia un errore,
                contatta un amministratore.
            </p>
            <Link
                href="/"
                className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600 transition-colors"
            >
                Torna alla dashboard
            </Link>
        </div>
    )
}
