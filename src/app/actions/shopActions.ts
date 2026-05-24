"use server"

import { db } from "@/db"
import { shopItems, userPurchases, users, coinTransactions } from "@/db/schema"
import { eq, and, desc, sql } from "drizzle-orm"
import crypto from "crypto"
import { currentTenant, assertSalesArea } from "@/lib/tenancy"

// --- MANAGER ACTIONS ---

export async function getAdminShopItems() {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    return await db.select().from(shopItems)
        .where(eq(shopItems.companyId, ctx.companyId))
        .orderBy(desc(shopItems.createdAt))
}

export async function createShopItem(data: { name: string, description: string, cost: number, cssValue: string }) {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    const id = crypto.randomUUID()
    await db.insert(shopItems).values({
            id,
            ...data,
            isActive: true,
            createdAt: new Date(),
            companyId: ctx.companyId,
        })
    return id
}

export async function updateShopItem(id: string, data: { name: string, description: string, cost: number, cssValue: string }) {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    await db.update(shopItems)
            .set(data)
            .where(and(eq(shopItems.id, id), eq(shopItems.companyId, ctx.companyId)))

}

export async function toggleShopItemStatus(id: string, currentStatus: boolean) {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    await db.update(shopItems)
            .set({ isActive: !currentStatus })
            .where(and(eq(shopItems.id, id), eq(shopItems.companyId, ctx.companyId)))

}

// --- GDO ACTIONS ---

export async function getActiveShopItems() {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    return await db.select()
            .from(shopItems)
            .where(and(eq(shopItems.isActive, true), eq(shopItems.companyId, ctx.companyId)))
            .orderBy(desc(shopItems.createdAt))

}

export async function getUserInventory(userId: string) {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    const purchases = await db.select({
            shopItem: shopItems
        })
            .from(userPurchases)
            .innerJoin(shopItems, eq(userPurchases.shopItemId, shopItems.id))
            .where(and(
                eq(userPurchases.userId, userId),
                eq(userPurchases.companyId, ctx.companyId),
            ))


    return purchases.map(p => p.shopItem)
}

export async function buyShopItem(userId: string, shopItemId: string) {
    const ctx = await currentTenant()
    assertSalesArea(ctx)

    const user = (await db.select().from(users).where(
            and(eq(users.id, userId), eq(users.companyId, ctx.companyId))
        ))[0]
    if (!user) throw new Error("Utente non trovato")

    const item = (await db.select().from(shopItems).where(
            and(eq(shopItems.id, shopItemId), eq(shopItems.companyId, ctx.companyId))
        ))[0]
    if (!item) throw new Error("Oggetto non trovato")
    if (!item.isActive) throw new Error("Oggetto non disponibile per l'acquisto")

    // Check if already purchased
    const existing = (await db.select().from(userPurchases).where(
            and(
                eq(userPurchases.userId, userId),
                eq(userPurchases.shopItemId, shopItemId),
                eq(userPurchases.companyId, ctx.companyId),
            )
        ))[0]

    if (existing) {
        throw new Error("Hai già acquistato questo oggetto")
    }

    if (user.walletCoins < item.cost) {
        throw new Error("Saldo insufficiente per acquistare questo oggetto")
    }

    const now = new Date()

    // Transaction logic: Since Drizzle ORM does not fully abstract transaction in SQLite smoothly across multiple ops,
    // we use sequential updates.

    // Deduct (SQL-level decrement to prevent race conditions)
    await db.update(users)
            .set({ walletCoins: sql`${users.walletCoins} - ${item.cost}` })
            .where(and(eq(users.id, userId), eq(users.companyId, ctx.companyId)))


    // Record Transaction
    await db.insert(coinTransactions).values({
            id: crypto.randomUUID(),
            userId,
            amount: -item.cost,
            reason: 'SHOP_PURCHASE',
            createdAt: now,
            companyId: ctx.companyId,
        })

    // Add to Inventory
    await db.insert(userPurchases).values({
            id: crypto.randomUUID(),
            userId,
            shopItemId,
            purchasedAt: now,
            companyId: ctx.companyId,
        })

    return true
}

export async function equipShopItem(userId: string, shopItemId: string) {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    // Verify ownership
    const existing = (await db.select().from(userPurchases).where(
            and(
                eq(userPurchases.userId, userId),
                eq(userPurchases.shopItemId, shopItemId),
                eq(userPurchases.companyId, ctx.companyId),
            )
        ))[0]

    if (!existing) {
        throw new Error("Non possiedi questo oggetto")
    }

    await db.update(users)
            .set({ equippedItemId: shopItemId })
            .where(and(eq(users.id, userId), eq(users.companyId, ctx.companyId)))

}

export async function unequipShopItem(userId: string) {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    await db.update(users)
            .set({ equippedItemId: null })
            .where(and(eq(users.id, userId), eq(users.companyId, ctx.companyId)))

}

export async function getEquippedSkinCss(userId: string) {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    const user = (await db.select({ equippedItemId: users.equippedItemId }).from(users).where(
            and(eq(users.id, userId), eq(users.companyId, ctx.companyId))
        ))[0]
    if (!user?.equippedItemId) return null

    const item = (await db.select({ cssValue: shopItems.cssValue }).from(shopItems).where(
            and(eq(shopItems.id, user.equippedItemId), eq(shopItems.companyId, ctx.companyId))
        ))[0]
    return item?.cssValue || null
}
