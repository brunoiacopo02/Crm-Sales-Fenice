import { redirect } from "next/navigation";
import { conRuoloDb } from "@/lib/auth/ruoloDb";
import { listGdoPools } from "@/app/actions/gestionePoolActions";
import GestioneClient from "./GestioneClient";

/**
 * /gestione — governo dei pool di assegnazione lead.
 *
 * Nome volutamente generico, chiesto dal PO il 15/09/2026.
 *
 * La protezione VERA è questo gate: solo ADMIN, verificato lato server, come
 * nelle action che la pagina chiama. Il blocco a password dentro il client è
 * un deterrente in più, non una difesa: chi sa aprire gli strumenti
 * sviluppatore la legge in chiaro. Non aggiungere qui dati che non possano
 * stare davanti a un ADMIN.
 */
export default async function GestionePage() {
    // Ruolo letto dalla tabella users (collaudo del 25/10/2026), come nel
    // resto dell'admin della Diretta: i metadati della sessione non bastano.
    if (!(await conRuoloDb(["ADMIN"]))) redirect("/unauthorized");

    const gdos = await listGdoPools();
    return <GestioneClient initialGdos={gdos} />;
}
