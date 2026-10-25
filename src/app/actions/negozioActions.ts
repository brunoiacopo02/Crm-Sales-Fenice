"use server"

// Negozio nuovo della Diretta (PO 25/10/2026): GDO e Conferme spendono
// Scintille e Piume in rewardItems, l'admin consegna o annulla da /admin/premi.
//
// Ogni movimento di saldo passa dal registro (creditOnce) dentro una
// transazione che blocca la riga dell'utente: due acquisti in parallelo non
// spendono lo stesso saldo due volte. Le regole stanno in lib/diretta/negozio.ts.

import { randomUUID } from "crypto"
import { and, asc, desc, eq, ne } from "drizzle-orm"
import { revalidatePath, updateTag } from "next/cache"
import { db } from "@/db"
import { appSettings, notifications, rewardItems, rewardPurchases, users } from "@/db/schema"
import { assertSalesArea, currentTenant } from "@/lib/tenancy"
import { conRuoloDb } from "@/lib/auth/ruoloDb"
import { creditOnce, type Currency } from "@/lib/economy/ledger"
import { DIRETTA_FLAG_KEYS, personName } from "@/lib/diretta/config"
import {
    canTransition, checkPurchase, isDigitale, messaggioErrore, nomeValuta, ownedItemIds, statoIniziale,
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
}

const asCurrency = (c: string): 'S' | 'P' => (c === 'P' ? 'P' : 'S')
const asStatus = (s: string): PurchaseStatus => (s === 'consegnato' || s === 'annullato' ? s : 'richiesto')
const prezzo = (currency: string, price: number) =>
    `${new Intl.NumberFormat('it-IT').format(price)} ${nomeValuta(currency, price)}`

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
        | { ok: true; status: PurchaseStatus; scintille: number; piume: number; persona: string; articolo: string; prezzo: string; nuovo: boolean }
        | { ok: false; error: BuyError | 'diretta' | 'errore' }

    let esito: Esito
    try {
        esito = await db.transaction(async (tx): Promise<Esito> => {
            const [user] = await tx.select({
                id: users.id, role: users.role, isActive: users.isActive, isBot: users.isBot,
                scintille: users.scintille, piume: users.piume,
                firstName: users.firstName, displayName: users.displayName, name: users.name,
            }).from(users).where(eq(users.id, ctx.userId)).for('update')
            if (!user) return { ok: false, error: 'utente' }

            // Stessa richiesta già registrata (doppio clic): si restituisce com'è.
            const [esistente] = await tx.select({ userId: rewardPurchases.userId, status: rewardPurchases.status })
                .from(rewardPurchases).where(eq(rewardPurchases.id, purchaseId)).limit(1)
            if (esistente) {
                if (esistente.userId !== user.id) return { ok: false, error: 'errore' }
                return { ok: true, status: asStatus(esistente.status), scintille: user.scintille, piume: user.piume, persona: '', articolo: '', prezzo: '', nuovo: false }
            }

            // Il ruolo si legge dal database, non dai metadati della sessione.
            const flagKey = user.role === 'GDO' ? DIRETTA_FLAG_KEYS.GDO : user.role === 'CONFERME' ? DIRETTA_FLAG_KEYS.CONFERME : null
            if (!flagKey) return { ok: false, error: 'ruolo' }
            const [flag] = await tx.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, flagKey)).limit(1)
            if (flag?.value !== 'on') return { ok: false, error: 'diretta' }

            const [item] = await tx.select().from(rewardItems)
                .where(and(eq(rewardItems.id, itemId), eq(rewardItems.companyId, FENICE))).limit(1)

            let alreadyOwned = false
            if (item && isDigitale(item.kind)) {
                const owned = await tx.select({ id: rewardPurchases.id }).from(rewardPurchases)
                    .where(and(eq(rewardPurchases.userId, user.id), eq(rewardPurchases.itemId, item.id), ne(rewardPurchases.status, 'annullato')))
                    .limit(1)
                alreadyOwned = owned.length > 0
            }

            const check = checkPurchase({ user, item, giftTo, alreadyOwned })
            if (!check.ok) return { ok: false, error: check.error }
            if (!item) return { ok: false, error: 'articolo' }

            const now = new Date()
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
                metadata: { purchaseId, itemId: item.id },
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
            }
        })
    } catch (e) {
        console.error('[negozio] buyReward', e)
        return { ok: false, error: messaggioErrore('errore') }
    }

    if (!esito.ok) return { ok: false, error: messaggioErrore(esito.error) }

    if (esito.nuovo && esito.status === 'richiesto') {
        await avvisaAdmin(esito.persona, esito.articolo, esito.prezzo, purchaseId)
    }
    if (esito.nuovo && esito.status === 'consegnato') updateTag(TAG_SQUADRA)
    revalidatePath('/store')
    revalidatePath('/profilo')
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

    type Esito = { ok: true; userId: string; itemNome: string; prezzo: string } | { ok: false; error: string }
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
            return { ok: true, userId: p.userId, itemNome: item?.name ?? 'Premio', prezzo: prezzo(p.currency, p.price) }
        })
    } catch (e) {
        console.error('[negozio] handleRewardPurchase', e)
        return { ok: false, error: messaggioErrore('errore') }
    }
    if (!esito.ok) return esito

    await avvisaUtente(esito.userId, to, esito.itemNome, esito.prezzo, purchaseId)
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

async function avvisaUtente(userId: string, to: 'consegnato' | 'annullato', itemNome: string, costo: string, purchaseId: string) {
    try {
        await db.insert(notifications).values({
            id: randomUUID(),
            recipientUserId: userId,
            type: 'negozio_esito',
            title: to === 'consegnato' ? 'Premio consegnato' : 'Richiesta annullata',
            body: to === 'consegnato'
                ? `La richiesta di ${itemNome} è stata segnata come consegnata.`
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
