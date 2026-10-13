"use client"

import { useCallback, useSyncExternalStore } from "react"

/**
 * Occhietto "come nel conto in banca" della dashboard venditore: nasconde gli
 * importi dei contratti (Fatturato, ticket medio, € nello Storico). È solo una
 * comodità di chi guarda lo schermo, quindi vive nel browser e non nel DB.
 * Tutti i punti che lo usano condividono lo stesso stato: un clic su un
 * occhietto chiude anche gli altri.
 */
const STORAGE_KEY = "venditore.hideAmounts"
const EVENT = "venditore-hide-amounts"

// Copia in memoria: se lo storage è bloccato (navigazione privata) l'occhietto
// funziona lo stesso, solo non sopravvive al ricaricamento.
let memory = false

function read(): boolean {
    try {
        return localStorage.getItem(STORAGE_KEY) === "1"
    } catch {
        return memory
    }
}

function subscribe(cb: () => void): () => void {
    window.addEventListener(EVENT, cb)
    window.addEventListener("storage", cb)
    return () => {
        window.removeEventListener(EVENT, cb)
        window.removeEventListener("storage", cb)
    }
}

export function useHideAmounts(): [boolean, () => void] {
    const hidden = useSyncExternalStore(subscribe, read, () => false)
    const toggle = useCallback(() => {
        memory = !read()
        try {
            localStorage.setItem(STORAGE_KEY, memory ? "1" : "0")
        } catch {
            // Storage bloccato: resta la copia in memoria.
        }
        window.dispatchEvent(new Event(EVENT))
    }, [])
    return [hidden, toggle]
}

export const HIDDEN_AMOUNT = "•••••"
