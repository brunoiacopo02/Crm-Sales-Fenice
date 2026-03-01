"use server"

import { db } from "@/db"
import { shopItems, userPurchases, users, coinTransactions } from "@/db/schema"
import { eq, and, desc } from "drizzle-orm"
import crypto from "crypto"

// --- MANAGER ACTIONS ---

export async function getAdminShopItems() {
    return await db.select().from(shopItems).orderBy(desc(shopItems.createdAt))
}

export async function createShopItem(data: { name: string, description: string, cost: number, cssValue: string }) {
    const id = crypto.randomUUID()
    await db.insert(shopItems).values({
            id,
            ...data,
            isActive: true,
            createdAt: new Date()
        })
    return id
}

export async function updateShopItem(id: string, data: { name: string, description: string, cost: number, cssValue: string }) {
    await db.update(shopItems)
            .set(data)
            .where(eq(shopItems.id, id))
        
}

export async function toggleShopItemStatus(id: string, currentStatus: boolean) {
    await db.update(shopItems)
            .set({ isActive: !currentStatus })
            .where(eq(shopItems.id, id))
        
}

// --- GDO ACTIONS ---

export async function getActiveShopItems() {
    return await db.select()
            .from(shopItems)
            .where(eq(shopItems.isActive, true))
            .orderBy(desc(shopItems.createdAt))
        
}

export async function getUserInventory(userId: string) {
    const purchases = await db.select({
            shopItem: shopItems
        })
            .from(userPurchases)
            .innerJoin(shopItems, eq(userPurchases.shopItemId, shopItems.id))
            .where(eq(userPurchases.userId, userId))
        

    return purchases.map(p => p.shopItem)
}

export async function buyShopItem(userId: string, shopItemId: string) {
    const user = (await db.select().from(users).where(eq(users.id, userId)))[0]
    if (!user) throw new Error("Utente non trovato")

    const item = (await db.select().from(shopItems).where(eq(shopItems.id, shopItemId)))[0]
    if (!item) throw new Error("Oggetto non trovato")
    if (!item.isActive) throw new Error("Oggetto non disponibile per l'acquisto")

    // Check if already purchased
    const existing = (await db.select().from(userPurchases).where(
            and(eq(userPurchases.userId, userId), eq(userPurchases.shopItemId, shopItemId))
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

    // Deduct
    await db.update(users)
            .set({ walletCoins: user.walletCoins - item.cost })
            .where(eq(users.id, userId))
        

    // Record Transaction
    await db.insert(coinTransactions).values({
            id: crypto.randomUUID(),
            userId,
            amount: -item.cost,
            reason: 'SHOP_PURCHASE',
            createdAt: now
        })

    // Add to Inventory
    await db.insert(userPurchases).values({
            id: crypto.randomUUID(),
            userId,
            shopItemId,
            purchasedAt: now
        })

    return true
}

export async function equipShopItem(userId: string, shopItemId: string) {
    // Verify ownership
    const existing = (await db.select().from(userPurchases).where(
            and(eq(userPurchases.userId, userId), eq(userPurchases.shopItemId, shopItemId))
        ))[0]

    if (!existing) {
        throw new Error("Non possiedi questo oggetto")
    }

    await db.update(users)
            .set({ equippedItemId: shopItemId })
            .where(eq(users.id, userId))
        
}

export async function unequipShopItem(userId: string) {
    await db.update(users)
            .set({ equippedItemId: null })
            .where(eq(users.id, userId))
        
}

export async function getEquippedSkinCss(userId: string) {
    const user = (await db.select({ equippedItemId: users.equippedItemId }).from(users).where(eq(users.id, userId)))[0]
    if (!user?.equippedItemId) return null

    const item = (await db.select({ cssValue: shopItems.cssValue }).from(shopItems).where(eq(shopItems.id, user.equippedItemId)))[0]
    return item?.cssValue || null
}
