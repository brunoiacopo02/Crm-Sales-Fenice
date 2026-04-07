'use server';

import { db } from "@/db";
import { gdoNotes, users } from "@/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { randomUUID } from "crypto";

export type GdoNoteCategory = 'formazione' | 'positivo' | 'negativo' | 'disciplinare';

export interface GdoNote {
    id: string;
    gdoUserId: string;
    authorUserId: string;
    authorName: string | null;
    content: string;
    category: GdoNoteCategory;
    createdAt: Date;
}

export interface GdoUserForNotes {
    id: string;
    name: string | null;
    displayName: string | null;
    gdoCode: number | null;
    level: number;
}

export async function getGdoUsersForNotes(): Promise<GdoUserForNotes[]> {
    const allGdos = await db.select({
        id: users.id,
        name: users.name,
        displayName: users.displayName,
        gdoCode: users.gdoCode,
        level: users.level,
        isActive: users.isActive,
    })
        .from(users)
        .where(eq(users.role, 'GDO'));

    return allGdos
        .filter(u => u.isActive === true)
        .map(({ isActive, ...rest }) => rest);
}

export async function createGdoNote(
    gdoUserId: string,
    authorUserId: string,
    content: string,
    category: GdoNoteCategory
): Promise<{ success: boolean; error?: string }> {
    try {
        if (!content.trim()) {
            return { success: false, error: "Il contenuto della nota non può essere vuoto" };
        }

        const validCategories: GdoNoteCategory[] = ['formazione', 'positivo', 'negativo', 'disciplinare'];
        if (!validCategories.includes(category)) {
            return { success: false, error: "Categoria non valida" };
        }

        await db.insert(gdoNotes).values({
            id: randomUUID(),
            gdoUserId,
            authorUserId,
            content: content.trim(),
            category,
        });

        return { success: true };
    } catch (error) {
        console.error("Errore creazione nota GDO:", error);
        return { success: false, error: "Errore durante la creazione della nota" };
    }
}

export async function getGdoNotes(gdoUserId: string): Promise<GdoNote[]> {
    const rows = await db
        .select({
            id: gdoNotes.id,
            gdoUserId: gdoNotes.gdoUserId,
            authorUserId: gdoNotes.authorUserId,
            authorName: users.name,
            content: gdoNotes.content,
            category: gdoNotes.category,
            createdAt: gdoNotes.createdAt,
        })
        .from(gdoNotes)
        .leftJoin(users, eq(gdoNotes.authorUserId, users.id))
        .where(eq(gdoNotes.gdoUserId, gdoUserId))
        .orderBy(desc(gdoNotes.createdAt));

    return rows.map(r => ({
        ...r,
        category: r.category as GdoNoteCategory,
    }));
}

export async function deleteGdoNote(
    noteId: string,
    authorUserId: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const result = await db
            .delete(gdoNotes)
            .where(and(eq(gdoNotes.id, noteId), eq(gdoNotes.authorUserId, authorUserId)))
            .returning();

        if (result.length === 0) {
            return { success: false, error: "Nota non trovata o non autorizzato" };
        }

        return { success: true };
    } catch (error) {
        console.error("Errore eliminazione nota GDO:", error);
        return { success: false, error: "Errore durante l'eliminazione della nota" };
    }
}
