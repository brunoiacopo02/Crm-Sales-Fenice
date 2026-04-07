'use server';

import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getGdoRpgProfile } from "@/app/actions/rpgProfileActions";

export async function fetchAllGdoRpgProfiles() {
    const allUsers = await db.select().from(users).where(eq(users.role, 'GDO'));
    const results = [];

    for (const u of allUsers) {
        if (!u.isActive) continue;
        try {
            const profile = await getGdoRpgProfile(u.id);
            results.push(profile);
        } catch (e) {
            console.error(`Errore fetch profilo RPG per ${u.id}:`, e);
        }
    }

    return results.sort((a, b) => b.level - a.level); // Ordina dal livello più alto
}

export async function updateGdoBaseSalary(userId: string, newSalary: number) {
    if (newSalary < 0) throw new Error("Salario non valido");
    await db.update(users).set({ baseSalaryEur: newSalary }).where(eq(users.id, userId));
}

export async function addGdoCoins(userId: string, amount: number) {
    const u = await db.select().from(users).where(eq(users.id, userId));
    if (u.length > 0) {
        await db.update(users).set({ coins: u[0].coins + amount }).where(eq(users.id, userId));
    }
}

export async function updateVenditoreSalesTarget(userId: string, salesTargetEur: number) {
    if (salesTargetEur < 0) throw new Error("Target non valido");
    await db.update(users).set({ salesTargetEur }).where(eq(users.id, userId));
}

export async function getVenditoriWithTargets() {
    const venditori = await db.select({
        id: users.id,
        name: users.name,
        displayName: users.displayName,
        email: users.email,
        isActive: users.isActive,
        salesTargetEur: users.salesTargetEur,
    }).from(users).where(eq(users.role, 'VENDITORE'));
    return venditori.filter(v => v.isActive);
}
