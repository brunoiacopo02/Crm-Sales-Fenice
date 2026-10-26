"use server"

// Negozio nuovo della Diretta (PO 25/10/2026): GDO e Conferme spendono
// Scintille e Piume in rewardItems, l'admin consegna o annulla da /admin/premi.
//
// Ogni movimento di saldo passa dal registro (creditOnce) dentro una
// transazione che blocca la riga dell'utente: due acquisti in parallelo non
// spendono lo stesso saldo due volte. Le regole stanno in lib/diretta/negozio.ts.

import { randomUUID } from "crypto"
import { and, asc, desc, eq, gte, lt, ne } from "drizzle-orm"
import { revalidatePath, updateTag } from "next/cache"
import { after } from "next/server"
import { numeroIt } from "@/lib/diretta/formato"
import { db } from "@/db"
import { appSettings, notifications, rewardItems, rewardPurchases, users } from "@/db/schema"
import { assertSalesArea, currentTenant } from "@/lib/tenancy"
import { conRuoloDb } from "@/lib/auth/ruoloDb"
import { creditOnce, type Currency } from "@/lib/economy/ledger"
import { currencyLedger } from "@/db/schema"
import { boosterAttivo, puoComprareBooster, KIND_BOOSTER } from "@/lib/economy/booster"
import { moltiplicatoriComprati, puoComprareMoltiplicatore, KIND_MOLTIPLICATORE } from "@/lib/economy/moltiplicatore"
import { prossimaTappa, puoComprareScudo, scudiDelMese, KIND_SCUDO, type TappaSerie } from "@/lib/economy/serie"
import { leggiSerie } from "@/lib/economy/serieDb"
import { readEconomyRules } from "@/lib/economy/awards"
import { readGamificationTargets } from "@/lib/diretta/settings"
import { shiftWindow } from "@/lib/diretta/config"
import { dayBoundsRome } from "@/lib/dateUtils"
import { comeFunziona, type BloccoSpiegazione } from "@/lib/diretta/comeFunziona"
import { DIRETTA_FLAG_KEYS, personName } from "@/lib/diretta/config"
import {
    canTransition, checkPurchase, daApprovare, messaggioErrore, unaVoltaSola, nomeValuta, ownedItemIds, statoIniziale,
    stileProfilo, type BuyError, type PurchaseStatus, type StileProfilo,
} from "@/lib/diretta/negozio"

// L'economia nuova è di Fenice: Serenamente per GDO e Conferme non esiste.
const FENICE = 'fenice'
// Tag della cache della pagina Squadra (squadraActions): immagini e
// personalizzazioni nuove si vedono subito, non dopo 20 s.
const TAG_SQUADRA = 'diretta-squadra'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface NegozioArticolo {
    id: string
    name: string
    description: string | null
    kind: string
    currency: 'S' | 'P'
    price: number
    imageUrl: string | null
    giftable: boolean
    posseduto: boolean
}

export interface NegozioAcquisto {
    id: string
    itemId: string
    nome: string
    kind: string
    imageUrl: string | null
    currency: 'S' | 'P'
    price: number
    status: PurchaseStatus
    giftTo: string | null
    createdAt: string
    handledAt: string | null
}

export interface NegozioView {
    nome: string
    ruolo: string
    scintille: number
    piume: number
    profileImageUrl: string | null
    stile: StileProfilo
    articoli: NegozioArticolo[]
    acquisti: NegozioAcquisto[]
    /** Fine del booster in corso (ISO), null se non ce n'è uno attivo. */
    boosterFino: string | null
    /** Moltiplicatore presenza già comprato oggi (vale fino a fine giornata). */
    moltiplicatoreOggi: boolean
    /** Serie e scudi del GDO (null per le Conferme). */
    serie: VistaSerie | null
    /** Come si guadagna e come si compra, con i numeri delle regole salvate. */
    comeFunziona: BloccoSpiegazione[]
}

export interface VistaSerie {
    giorni: number
    oggiFatto: boolean
    prossima: TappaSerie | null
    scudiInTasca: number
    scudiMese: number
    scudiAlMese: number
}

const asCurrency = (c: string): 'S' | 'P' => (c === 'P' ? 'P' : 'S')
const asStatus = (s: string): PurchaseStatus => (s === 'consegnato' || s === 'annullato' ? s : 'richiesto')
const prezzo = (currency: string, price: number) =>
    `${numeroIt(price)} ${nomeValuta(currency, price)}`

/** Saldo, catalogo per il ruolo e storico di chi guarda: serve a /store e a /profilo. */
export async function getNegozioView(): Promise<NegozioView> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)

    const [me] = await db.select({
        id: users.id, role: users.role, firstName: users.firstName, displayName: users.displayName, name: users.name,
        scintille: users.scintille, piume: users.piume, profileImageUrl: users.profileImageUrl,
    }).from(users).where(eq(users.id, ctx.userId)).limit(1)
    if (!me) throw new Error('Utente non trovato')

    const [items, purchases] = await Promise.all([
        db.select().from(rewardItems)
            .where(and(eq(rewardItems.companyId, FENICE), eq(rewardItems.isActive, true)))
            .orderBy(asc(rewardItems.sortOrder), asc(rewardItems.name)),
        db.select({
            id: rewardPurchases.id, itemId: rewardPurchases.itemId, currency: rewardPurchases.currency,
            price: rewardPurchases.price, status: rewardPurchases.status, giftTo: rewardPurchases.giftTo,
            createdAt: rewardPurchases.createdAt, handledAt: rewardPurchases.handledAt,
            nome: rewardItems.name, kind: rewardItems.kind, imageUrl: rewardItems.imageUrl,
        }).from(rewardPurchases)
            .innerJoin(rewardItems, eq(rewardPurchases.itemId, rewardItems.id))
            .where(eq(rewardPurchases.userId, me.id))
            .orderBy(desc(rewardPurchases.createdAt))
            .limit(100),
    ])

    const owned = ownedItemIds(purchases)
    const adesso = new Date()
    const { start, end } = dayBoundsRome(adesso)
    const righeOggi = me.role === 'GDO' ? await db.select({
        reason: currencyLedger.reason, amount: currencyLedger.amount,
        createdAt: currencyLedger.createdAt, metadata: currencyLedger.metadata,
    }).from(currencyLedger).where(and(
        eq(currencyLedger.userId, me.id), gte(currencyLedger.createdAt, start), lt(currencyLedger.createdAt, end),
    )) : []
    const booster = boosterAttivo(righeOggi, adesso)
    const [regole, obiettivi, serieLetta] = await Promise.all([
        readEconomyRules(), readGamificationTargets(),
        me.role === 'GDO' ? leggiSerie(db, me.id, adesso) : Promise.resolve(null),
    ])
    const serie: VistaSerie | null = serieLetta ? {
        giorni: serieLetta.stato.giorni,
        oggiFatto: serieLetta.stato.oggiFatto,
        prossima: prossimaTappa(serieLetta.stato.giorni, regole.serie),
        scudiInTasca: serieLetta.stato.scudiInTasca,
        scudiMese: scudiDelMese(serieLetta.scudi, serieLetta.oggi),
        scudiAlMese: regole.serie.scudiAlMese,
    } : null
    return {
        nome: personName(me),
        ruolo: me.role,
        scintille: me.scintille,
        piume: me.piume,
        profileImageUrl: me.profileImageUrl,
        stile: stileProfilo(purchases.filter(p => p.status !== 'annullato')),
        articoli: items.filter(i => i.roles.includes(me.role)).map(i => ({
            id: i.id, name: i.name, description: i.description, kind: i.kind, currency: asCurrency(i.currency),
            price: i.price, imageUrl: i.imageUrl, giftable: i.giftable, posseduto: owned.has(i.id),
        })),
        acquisti: purchases.map(p => ({
            id: p.id, itemId: p.itemId, nome: p.nome, kind: p.kind, imageUrl: p.imageUrl,
            currency: asCurrency(p.currency), price: p.price, status: asStatus(p.status), giftTo: p.giftTo,
            createdAt: p.createdAt.toISOString(), handledAt: p.handledAt ? p.handledAt.toISOString() : null,
        })),
        boosterFino: booster ? booster.fino.toISOString() : null,
        moltiplicatoreOggi: moltiplicatoriComprati(righeOggi) > 0,
        serie,
        comeFunziona: comeFunziona(me.role, regole, obiettivi),
    }
}

export type BuyResult =
    | { ok: true; purchaseId: string; status: PurchaseStatus; scintille: number; piume: number }
    | { ok: false; error: string }

/**
 * Compra un articolo. `requestId` (uuid generato dal browser all'apertura
 * della conferma) diventa l'id della richiesta: un doppio clic rimanda la
 * stessa richiesta e non scala due volte.
 */
export async function buyReward(itemId: string, giftTo?: string | null, requestId?: string): Promise<BuyResult> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    if (typeof itemId !== 'string' || itemId.length === 0 || itemId.length > 100) {
        return { ok: false, error: messaggioErrore('articolo') }
    }
    const purchaseId = typeof requestId === 'string' && UUID_RE.test(requestId) ? requestId : randomUUID()

    type Esito =
        | { ok: true; status: PurchaseStatus; scintille: number; piume: number; persona: string; articolo: string; prezzo: string; nuovo: boolean; diProva: boolean }
        | { ok: false; error: BuyError | 'diretta' | 'errore' }

    let esito: Esito
    try {
        esito = await db.transaction(async (tx): Promise<Esito> => {
            const [user] = await tx.select({
                id: users.id, role: users.role, isActive: users.isActive, isBot: users.isBot, isTest: users.isTest,
                scintille: users.scintille, piume: users.piume,
                firstName: users.firstName, displayName: users.displayName, name: users.name,
            }).from(users).where(eq(users.id, ctx.userId)).for('update')
            if (!user) return { ok: false, error: 'utente' }

            // Stessa richiesta già registrata (doppio clic): si restituisce com'è.
            const [esistente] = await tx.select({ userId: rewardPurchases.userId, status: rewardPurchases.status })
                .from(rewardPurchases).where(eq(rewardPurchases.id, purchaseId)).limit(1)
            if (esistente) {
                if (esistente.userId !== user.id) return { ok: false, error: 'errore' }
                return { ok: true, status: asStatus(esistente.status), scintille: user.scintille, piume: user.piume, persona: '', articolo: '', prezzo: '', nuovo: false, diProva: user.isTest }
            }

            // Il ruolo si legge dal database, non dai metadati della sessione.
            const flagKey = user.role === 'GDO' ? DIRETTA_FLAG_KEYS.GDO : user.role === 'CONFERME' ? DIRETTA_FLAG_KEYS.CONFERME : null
            if (!flagKey) return { ok: false, error: 'ruolo' }
            const [flag] = await tx.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, flagKey)).limit(1)
            if (flag?.value !== 'on') return { ok: false, error: 'diretta' }

            const [item] = await tx.select().from(rewardItems)
                .where(and(eq(rewardItems.id, itemId), eq(rewardItems.companyId, FENICE))).limit(1)

            let alreadyOwned = false
            if (item && unaVoltaSola(item.kind)) {
                const owned = await tx.select({ id: rewardPurchases.id }).from(rewardPurchases)
                    .where(and(eq(rewardPurchases.userId, user.id), eq(rewardPurchases.itemId, item.id), ne(rewardPurchases.status, 'annullato')))
                    .limit(1)
                alreadyOwned = owned.length > 0
            }

            const check = checkPurchase({ user, item: item ? { ...item, id: item.id } : item, giftTo, alreadyOwned })
            if (!check.ok) return { ok: false, error: check.error }
            if (!item) return { ok: false, error: 'articolo' }

            const now = new Date()
            // Booster: si compra solo in turno, uno alla volta e uno al giorno;
            // durata scritta sull'addebito, così vale quella del momento.
            let booster: { minuti: number } | null = null
            if (item.kind === KIND_BOOSTER) {
                const [targets, rules] = await Promise.all([readGamificationTargets(), readEconomyRules()])
                const { start, end } = dayBoundsRome(now)
                const righeOggi = await tx.select({
                    reason: currencyLedger.reason, amount: currencyLedger.amount,
                    createdAt: currencyLedger.createdAt, metadata: currencyLedger.metadata,
                }).from(currencyLedger).where(and(
                    eq(currencyLedger.userId, user.id), gte(currencyLedger.createdAt, start), lt(currencyLedger.createdAt, end),
                ))
                const puo = puoComprareBooster({ righeOggi, now, turno: shiftWindow(now, targets), rules: rules.booster })
                if (!puo.ok) return { ok: false, error: puo.error }
                booster = { minuti: rules.booster.minuti }
            }
            // Moltiplicatore presenza: come il booster, solo in turno e uno al giorno.
            // Scudo della serie: uno da parte alla volta, al massimo N nel mese.
            let marca: Record<string, unknown> = {}
            if (item.kind === KIND_MOLTIPLICATORE) {
                const [targets, rules] = await Promise.all([readGamificationTargets(), readEconomyRules()])
                const { start, end } = dayBoundsRome(now)
                const righeOggi = await tx.select({
                    reason: currencyLedger.reason, amount: currencyLedger.amount,
                    createdAt: currencyLedger.createdAt, metadata: currencyLedger.metadata,
                }).from(currencyLedger).where(and(
                    eq(currencyLedger.userId, user.id), gte(currencyLedger.createdAt, start), lt(currencyLedger.createdAt, end),
                ))
                const puo = puoComprareMoltiplicatore({ righeOggi, now, turno: shiftWindow(now, targets), rules: rules.moltiplicatore })
                if (!puo.ok) return { ok: false, error: puo.error }
                marca = { moltiplicatore: true }
            } else if (item.kind === KIND_SCUDO) {
                const rules = await readEconomyRules()
                const serie = await leggiSerie(tx, user.id, now)
                const puo = puoComprareScudo({ stato: serie.stato, scudi: serie.scudi, oggi: serie.oggi, rules: rules.serie })
                if (!puo.ok) return { ok: false, error: puo.error }
                marca = { scudo: true }
            }
            const status = statoIniziale(item.kind)
            await tx.insert(rewardPurchases).values({
                id: purchaseId,
                userId: user.id,
                itemId: item.id,
                currency: item.currency,
                price: item.price,
                status,
                giftTo: check.giftTo,
                createdAt: now,
                // I digitali non passano dall'admin: consegnati alla richiesta.
                handledAt: status === 'consegnato' ? now : null,
                handledBy: status === 'consegnato' ? 'automatico' : null,
            })
            const debited = await creditOnce({
                userId: user.id,
                currency: item.currency as Currency,
                amount: -item.price,
                reason: 'negozio',
                idemKey: `buy:${purchaseId}`,
                metadata: booster ? { purchaseId, itemId: item.id, booster: true, minuti: booster.minuti } : { purchaseId, itemId: item.id, ...marca },
                companyId: FENICE,
            }, tx)
            if (!debited) throw new Error('NEGOZIO_DEBITO_NON_SCRITTO')

            return {
                ok: true,
                status,
                scintille: user.scintille - (item.currency === 'S' ? item.price : 0),
                piume: user.piume - (item.currency === 'P' ? item.price : 0),
                persona: personName(user),
                articolo: check.giftTo ? `${item.name} da regalare a ${check.giftTo}` : item.name,
                prezzo: prezzo(item.currency, item.price),
                nuovo: true,
                diProva: user.isTest,
            }
        })
    } catch (e) {
        console.error('[negozio] buyReward', e)
        return { ok: false, error: messaggioErrore('errore') }
    }

    if (!esito.ok) return { ok: false, error: messaggioErrore(esito.error) }

    // Gli acquisti dell'account di prova (migr. 0050) non avvisano gli admin:
    // la richiesta resta comunque in /admin/premi, col nome "Prova".
    // L'avviso parte dopo la risposta (collaudo del 25/10/2026: la conferma
    // del corso restava su "Un attimo" per secondi). Fuori da una richiesta
    // (script) si manda subito.
    if (esito.nuovo && esito.status === 'richiesto' && !esito.diProva) {
        const { persona, articolo, prezzo: costo } = esito
        const avviso = () => avvisaAdmin(persona, articolo, costo, purchaseId)
        try {
            after(avviso)
        } catch {
            await avviso()
        }
    }
    if (esito.nuovo && esito.status === 'consegnato') updateTag(TAG_SQUADRA)
    // Niente revalidatePath qui: con la pagina in uso Next la ridisegnava
    // dentro la risposta dell'action, e il bottone aspettava anche quello. Il
    // saldo nuovo arriva nella risposta, il negozio chiama router.refresh() e
    // /store e /profilo sono dinamiche (si rileggono a ogni visita).
    return { ok: true, purchaseId, status: esito.status, scintille: esito.scintille, piume: esito.piume }
}

/** Imposta come immagine profilo un'immagine comprata (null la toglie). */
export async function setProfileImage(itemId: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    try {
        if (itemId === null) {
            await db.update(users).set({ profileImageUrl: null }).where(eq(users.id, ctx.userId))
        } else {
            if (typeof itemId !== 'string' || itemId.length > 100) return { ok: false, error: messaggioErrore('articolo') }
            const [row] = await db.select({ kind: rewardItems.kind, imageUrl: rewardItems.imageUrl })
                .from(rewardPurchases)
                .innerJoin(rewardItems, eq(rewardPurchases.itemId, rewardItems.id))
                .where(and(
                    eq(rewardPurchases.userId, ctx.userId),
                    eq(rewardPurchases.itemId, itemId),
                    ne(rewardPurchases.status, 'annullato'),
                ))
                .limit(1)
            if (!row || row.kind !== 'immagine' || !row.imageUrl) {
                return { ok: false, error: 'Puoi usare solo le immagini che hai preso nel negozio.' }
            }
            await db.update(users).set({ profileImageUrl: row.imageUrl }).where(eq(users.id, ctx.userId))
        }
    } catch (e) {
        console.error('[negozio] setProfileImage', e)
        return { ok: false, error: messaggioErrore('errore') }
    }
    updateTag(TAG_SQUADRA)
    revalidatePath('/profilo')
    revalidatePath('/classifica')
    return { ok: true }
}

/**
 * Il nome vero che si vede in barra, in Squadra e nelle schede (PO 26/10/2026):
 * ognuno può correggere il proprio. Solo lettere, spazi, apostrofi e trattini.
 */
export async function setMyFirstName(nome: string): Promise<{ ok: true; nome: string } | { ok: false; error: string }> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    const pulito = typeof nome === 'string' ? nome.trim().replace(/\s+/g, ' ') : ''
    if (pulito.length < 2 || pulito.length > 30) return { ok: false, error: 'Il nome va da 2 a 30 lettere.' }
    if (!/^[\p{L}][\p{L} '’-]*$/u.test(pulito)) return { ok: false, error: 'Usa solo lettere, spazi e apostrofi.' }
    try {
        await db.update(users).set({ firstName: pulito }).where(eq(users.id, ctx.userId))
    } catch (e) {
        console.error('[negozio] setMyFirstName', e)
        return { ok: false, error: messaggioErrore('errore') }
    }
    updateTag(TAG_SQUADRA)
    revalidatePath('/', 'layout')
    return { ok: true, nome: pulito }
}

// ── Admin ────────────────────────────────────────────────────────────────

/** Solo ADMIN, letto dalla tabella users: i metadati della sessione non bastano. */
async function requireAdmin(): Promise<{ id: string }> {
    const admin = await conRuoloDb(['ADMIN'])
    if (!admin) throw new Error('Unauthorized')
    return { id: admin.id }
}

export interface RichiestaPremio {
    id: string
    createdAt: string
    handledAt: string | null
    status: PurchaseStatus
    currency: 'S' | 'P'
    price: number
    giftTo: string | null
    itemNome: string
    kind: string
    persona: string
    ruolo: string
}

export interface ArticoloAdmin {
    id: string
    name: string
    kind: string
    currency: 'S' | 'P'
    price: number
    giftable: boolean
    isActive: boolean
}

export async function getRewardRequests(): Promise<{ daGestire: RichiestaPremio[]; recenti: RichiestaPremio[]; catalogo: ArticoloAdmin[] }> {
    await requireAdmin()
    const select = {
        id: rewardPurchases.id, createdAt: rewardPurchases.createdAt, handledAt: rewardPurchases.handledAt,
        status: rewardPurchases.status, currency: rewardPurchases.currency, price: rewardPurchases.price,
        giftTo: rewardPurchases.giftTo, itemNome: rewardItems.name, kind: rewardItems.kind,
        firstName: users.firstName, displayName: users.displayName, name: users.name, ruolo: users.role,
    }
    const [aperte, ultime, articoli] = await Promise.all([
        db.select(select).from(rewardPurchases)
            .innerJoin(rewardItems, eq(rewardPurchases.itemId, rewardItems.id))
            .innerJoin(users, eq(rewardPurchases.userId, users.id))
            .where(eq(rewardPurchases.status, 'richiesto'))
            .orderBy(asc(rewardPurchases.createdAt))
            .limit(200),
        db.select(select).from(rewardPurchases)
            .innerJoin(rewardItems, eq(rewardPurchases.itemId, rewardItems.id))
            .innerJoin(users, eq(rewardPurchases.userId, users.id))
            .where(ne(rewardPurchases.status, 'richiesto'))
            .orderBy(desc(rewardPurchases.createdAt))
            .limit(100),
        db.select({
            id: rewardItems.id, name: rewardItems.name, kind: rewardItems.kind, currency: rewardItems.currency,
            price: rewardItems.price, giftable: rewardItems.giftable, isActive: rewardItems.isActive,
        }).from(rewardItems)
            .where(eq(rewardItems.companyId, FENICE))
            .orderBy(asc(rewardItems.sortOrder), asc(rewardItems.name)),
    ])
    const map = (r: typeof aperte[number]): RichiestaPremio => ({
        id: r.id, createdAt: r.createdAt.toISOString(), handledAt: r.handledAt ? r.handledAt.toISOString() : null,
        status: asStatus(r.status), currency: asCurrency(r.currency), price: r.price, giftTo: r.giftTo,
        itemNome: r.itemNome, kind: r.kind, persona: personName(r), ruolo: r.ruolo,
    })
    return {
        daGestire: aperte.map(map),
        recenti: ultime.map(map),
        catalogo: articoli.map(a => ({ ...a, currency: asCurrency(a.currency) })),
    }
}

/** Consegna o annulla una richiesta. L'annullamento rimborsa una volta sola (refund:<id>). */
export async function handleRewardPurchase(purchaseId: string, to: 'consegnato' | 'annullato'): Promise<{ ok: true } | { ok: false; error: string }> {
    const admin = await requireAdmin()
    if (typeof purchaseId !== 'string' || !UUID_RE.test(purchaseId)) return { ok: false, error: 'Richiesta non trovata.' }
    if (to !== 'consegnato' && to !== 'annullato') return { ok: false, error: 'Stato non valido.' }

    type Esito = { ok: true; userId: string; itemNome: string; kind: string; prezzo: string } | { ok: false; error: string }
    let esito: Esito
    try {
        esito = await db.transaction(async (tx): Promise<Esito> => {
            const [p] = await tx.select().from(rewardPurchases).where(eq(rewardPurchases.id, purchaseId)).for('update')
            if (!p) return { ok: false, error: 'Richiesta non trovata.' }
            if (!canTransition(p.status, to)) return { ok: false, error: 'Questa richiesta è già stata gestita.' }

            const now = new Date()
            await tx.update(rewardPurchases)
                .set({ status: to, handledAt: now, handledBy: admin.id })
                .where(eq(rewardPurchases.id, p.id))

            const [item] = await tx.select({ name: rewardItems.name, kind: rewardItems.kind, imageUrl: rewardItems.imageUrl })
                .from(rewardItems).where(eq(rewardItems.id, p.itemId)).limit(1)

            if (to === 'annullato') {
                await creditOnce({
                    userId: p.userId,
                    currency: p.currency as Currency,
                    amount: p.price,
                    reason: 'negozio_rimborso',
                    idemKey: `refund:${p.id}`,
                    metadata: { purchaseId: p.id, itemId: p.itemId },
                    companyId: FENICE,
                }, tx)
                // Immagine annullata e in uso: se non ne resta un'altra copia
                // valida, il profilo torna senza immagine.
                if (item?.kind === 'immagine' && item.imageUrl) {
                    const [altra] = await tx.select({ id: rewardPurchases.id }).from(rewardPurchases)
                        .where(and(eq(rewardPurchases.userId, p.userId), eq(rewardPurchases.itemId, p.itemId), ne(rewardPurchases.status, 'annullato')))
                        .limit(1)
                    if (!altra) {
                        await tx.update(users).set({ profileImageUrl: null })
                            .where(and(eq(users.id, p.userId), eq(users.profileImageUrl, item.imageUrl)))
                    }
                }
            }
            return { ok: true, userId: p.userId, itemNome: item?.name ?? 'Premio', kind: item?.kind ?? '', prezzo: prezzo(p.currency, p.price) }
        })
    } catch (e) {
        console.error('[negozio] handleRewardPurchase', e)
        return { ok: false, error: messaggioErrore('errore') }
    }
    if (!esito.ok) return esito

    await avvisaUtente(esito.userId, to, esito.itemNome, esito.kind, esito.prezzo, purchaseId)
    if (to === 'annullato') updateTag(TAG_SQUADRA)
    revalidatePath('/admin/premi')
    revalidatePath('/store')
    revalidatePath('/profilo')
    return { ok: true }
}

// ── Notifiche (best effort: un errore qui non tocca l'acquisto) ─────────────

async function avvisaAdmin(persona: string, articolo: string, costo: string, purchaseId: string) {
    try {
        const admins = await db.select({ id: users.id }).from(users)
            .where(and(eq(users.role, 'ADMIN'), eq(users.isActive, true), eq(users.companyId, FENICE)))
        if (admins.length === 0) return
        const now = new Date()
        await db.insert(notifications).values(admins.map(a => ({
            id: randomUUID(),
            recipientUserId: a.id,
            type: 'negozio_richiesta',
            title: 'Nuova richiesta dal negozio',
            body: `${persona} chiede ${articolo} (${costo}). Si gestisce da Premi del negozio.`,
            metadata: { purchaseId },
            status: 'unread',
            createdAt: now,
            companyId: FENICE,
        })))
    } catch (e) {
        console.error('[negozio] avviso admin', e)
    }
}

async function avvisaUtente(userId: string, to: 'consegnato' | 'annullato', itemNome: string, kind: string, costo: string, purchaseId: string) {
    // Un permesso (es. la pausa quando vuoi, che approva Bruno) si approva, non si consegna (PO 25/10/2026).
    const permesso = daApprovare(kind)
    try {
        await db.insert(notifications).values({
            id: randomUUID(),
            recipientUserId: userId,
            type: 'negozio_esito',
            title: to === 'consegnato' ? (permesso ? 'Permesso approvato' : 'Premio consegnato') : 'Richiesta annullata',
            body: to === 'consegnato'
                ? (permesso ? `La richiesta di ${itemNome} è stata approvata.` : `La richiesta di ${itemNome} è stata segnata come consegnata.`)
                : `La richiesta di ${itemNome} è stata annullata e le ${costo} sono tornate nel saldo.`,
            metadata: { purchaseId, status: to },
            status: 'unread',
            createdAt: new Date(),
            companyId: FENICE,
        })
    } catch (e) {
        console.error('[negozio] avviso utente', e)
    }
}
