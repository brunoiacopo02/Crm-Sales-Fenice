// Voci di menu della Diretta per il GDO (PO 25/10/2026): le stesse nella barra
// in alto (schermi larghi) e nel menu a scomparsa (schermi stretti). Niente
// creature, avventura, scambi né profilo dei giochi.

import { Calendar, CalendarClock, LayoutDashboard, Phone, Store, Users, type LucideIcon } from "lucide-react"

export type VoceMenu = { name: string; href: string; icon: LucideIcon; richiami?: boolean }

export const MENU_GDO_DIRETTA: VoceMenu[] = [
    { name: "Pipeline", href: "/", icon: Phone },
    { name: "Richiami", href: "/richiami", icon: CalendarClock, richiami: true },
    { name: "Appuntamenti", href: "/appuntamenti", icon: Calendar },
    { name: "I miei risultati", href: "/kpi-gdo", icon: LayoutDashboard },
    { name: "Squadra", href: "/classifica", icon: Users },
    { name: "Negozio", href: "/store", icon: Store },
]
