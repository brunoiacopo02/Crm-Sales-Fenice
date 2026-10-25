"use client"

// "La tua postazione" nel negozio (PO 25/10/2026): gli upgrade fisici della
// scrivania disegnati come slot di una postazione. Ognuno si prende una volta
// sola a persona e passa dall'admin come gli altri premi. Lo stato dello slot
// viene dalle richieste: Di base, In arrivo (richiesto), Arrivato (consegnato).
// Gli oggetti restano dell'azienda (PO 25/10/2026): per questo lo slot
// consegnato dice "Arrivato", non "Tuo".
// Pulsanti e conferma sono quelli del negozio (azione e dettaglio).
// Ogni ruolo vede i suoi pezzi (rewardItems.roles): i GDO le cuffie, le
// Conferme, che chiamano col telefono, auricolari e telefono (PO 25/10/2026).

import type { ReactNode } from "react"
import { Ear, Gift, Headphones, Keyboard, LampDesk, Monitor, Mouse, Smartphone, type LucideIcon } from "lucide-react"
import type { NegozioAcquisto, NegozioArticolo } from "@/app/actions/negozioActions"
import { statoPostazione, type StatoPostazione } from "@/lib/diretta/negozio"
import { numeroIt } from "@/lib/diretta/formato"
import { prezzoTesto } from "./ui"

const ICONA: Record<string, LucideIcon> = {
    'postazione-cuffie': Headphones,
    'postazione-auricolari': Ear,
    'postazione-telefono': Smartphone,
    'postazione-tastiera': Keyboard,
    'postazione-mouse': Mouse,
    'postazione-monitor': Monitor,
    'postazione-gadget': LampDesk,
}

// Dove sta ogni slot sulla scrivania, da tablet in su: monitor al centro,
// tastiera davanti, cuffie (o auricolari) e gadget a sinistra, mouse a destra.
// Il telefono delle Conferme sta a destra del monitor: il riepilogo della
// scrivania allora scende sotto, su tutta la riga.
const POSTO: Record<string, string> = {
    'postazione-monitor': 'sm:col-span-2 lg:col-span-1 lg:col-start-2 lg:row-start-1',
    'postazione-tastiera': 'lg:col-start-2 lg:row-start-2',
    'postazione-cuffie': 'lg:col-start-1 lg:row-start-1',
    'postazione-auricolari': 'lg:col-start-1 lg:row-start-1',
    'postazione-telefono': 'lg:col-start-3 lg:row-start-1',
    'postazione-gadget': 'lg:col-start-1 lg:row-start-2',
    'postazione-mouse': 'lg:col-start-3 lg:row-start-2',
}

const ETICHETTA: Record<StatoPostazione, string> = { base: 'Di base', in_arrivo: 'In arrivo', tuo: 'Arrivato' }

const BORDO: Record<StatoPostazione, string> = {
    base: 'border-dashed border-[var(--d-line)]',
    in_arrivo: 'border-[var(--d-muted)]',
    tuo: 'border-[var(--d-orange)]',
}

const BADGE: Record<StatoPostazione, string> = {
    base: 'bg-[var(--d-line)] text-[var(--d-muted)]',
    in_arrivo: 'bg-[var(--d-text)] text-[var(--d-bg)]',
    tuo: 'bg-[var(--d-orange)] text-[var(--d-orange-ink)]',
}

export function PostazioneDiretta({ articoli, acquisti, azione, dettaglio }: {
    articoli: NegozioArticolo[]
    acquisti: NegozioAcquisto[]
    azione: (a: NegozioArticolo) => ReactNode
    dettaglio: (a: NegozioArticolo) => ReactNode
}) {
    const stati = articoli.map(a => ({ a, stato: statoPostazione(a.id, acquisti) }))
    const tuoi = stati.filter(s => s.stato === 'tuo').length
    const inArrivo = stati.filter(s => s.stato === 'in_arrivo').length
    const conTelefono = articoli.some(a => a.id === 'postazione-telefono')
    const postoRiepilogo = conTelefono
        ? 'sm:col-span-2 lg:col-span-3 lg:col-start-1 lg:row-start-3'
        : 'sm:col-span-2 lg:col-span-1 lg:col-start-3 lg:row-start-1'

    return (
        <section aria-label="La tua postazione" id="postazione">
            <h2 className="text-lg font-semibold">
                La tua <span className="text-[var(--d-orange)]">postazione</span>
            </h2>
            <div className="mt-1 max-w-2xl text-sm leading-relaxed text-[var(--d-muted)]">
                Gli upgrade veri della tua scrivania. Ognuno si prende una volta sola e arriva dall&apos;admin, come gli altri premi.
                Restano dell&apos;azienda: sono per la tua postazione di lavoro, così lavori meglio ogni giorno.
            </div>

            <div className="mt-4 rounded-[16px] bg-[var(--d-surface)] p-4 sm:p-6">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1.4fr_1fr] lg:grid-rows-[auto_auto]">
                    {stati.map(({ a, stato }) => (
                        <Slot key={a.id} articolo={a} stato={stato} posto={POSTO[a.id] ?? ''} azione={azione(a)} dettaglio={dettaglio(a)} />
                    ))}
                    <div className={`flex flex-col justify-center rounded-[12px] px-1 py-2 lg:px-4 ${postoRiepilogo}`}>
                        <div className="text-sm text-[var(--d-muted)]">La tua scrivania</div>
                        <div className="mt-1 text-[28px] font-semibold leading-tight tabular-nums">
                            {numeroIt(tuoi)}<span className="text-[var(--d-muted)]"> su {numeroIt(articoli.length)}</span>
                        </div>
                        <div className="mt-1 text-sm text-[var(--d-muted)]">
                            {inArrivo > 0 ? `${numeroIt(inArrivo)} in arrivo.` : tuoi === articoli.length ? 'Postazione completa.' : 'Upgrade arrivati.'}
                        </div>
                    </div>
                </div>
                {/* Il piano della scrivania: tiene insieme gli slot come un mobile. */}
                <div aria-hidden="true" className="mt-4 h-2 rounded-full bg-[var(--d-line)]" />
            </div>
        </section>
    )
}

function Slot({ articolo: a, stato, posto, azione, dettaglio }: {
    articolo: NegozioArticolo
    stato: StatoPostazione
    posto: string
    azione: ReactNode
    dettaglio: ReactNode
}) {
    const Icon = ICONA[a.id] ?? Gift
    const grande = a.id === 'postazione-monitor'
    return (
        <div className={`flex min-w-0 flex-col rounded-[12px] border-2 bg-[var(--d-bg)] p-4 ${BORDO[stato]} ${posto}`}>
            <div className="flex items-start justify-between gap-3">
                <Icon
                    className={`${grande ? 'h-10 w-10' : 'h-8 w-8'} shrink-0 ${stato === 'tuo' ? 'text-[var(--d-orange)]' : 'text-[var(--d-muted)]'}`}
                    strokeWidth={1.5}
                    aria-hidden="true"
                />
                <div className={`shrink-0 rounded-[6px] px-2 py-0.5 text-xs font-semibold ${BADGE[stato]}`}>{ETICHETTA[stato]}</div>
            </div>
            <div className="mt-3 font-medium">{a.name}</div>
            {a.description && <div className="mt-0.5 text-sm leading-relaxed text-[var(--d-muted)]">{a.description}</div>}
            <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-2 pt-3">
                <div className="font-semibold tabular-nums">{stato === 'base' ? prezzoTesto(a.currency, a.price) : ''}</div>
                {stato === 'base' && azione && <div className="flex">{azione}</div>}
            </div>
            {dettaglio}
        </div>
    )
}
