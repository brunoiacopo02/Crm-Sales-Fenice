/**
 * Riga `leads` creata dalla riconciliazione per la famiglia lead-assente: un
 * contratto firmato nel gestionale senza nessun lead nel CRM.
 *
 * Sta fuori da engine.ts (che importa il db) per poterla testare da sola.
 *
 * `salespersonUserId` è OBBLIGATORIO: firmato, obiettivi, guadagni e
 * classifica dei venditori sommano su `leads.salespersonUserId`, non sul testo
 * `salespersonAssigned`. Fino al 29/10/2026 l'insert lo lasciava NULL e 4
 * contratti (Sales 008 e Sales 004, 5.211 €) non comparivano nel firmato.
 * Non finisce nelle liste "da esitare": l'esito è già 'Chiuso' e non c'è
 * appointmentDate.
 *
 * Volutamente assenti: presentedAt, appointmentDate, assignedToId,
 * confermeUserId. Il contratto non è passato dal funnel GDO/Conferme e non
 * deve gonfiare presenze, appuntamenti o tassi di quei team. `status` resta al
 * default della colonna.
 */
export type LeadAssenteSheet = {
    fullName: string;
    email: string | null;
    signedAt: Date;
    amountEur: number;
    salesCode: string | null;
};

export function buildLeadAssenteRow(input: {
    leadId: string;
    companyId: string;
    phone: string;
    sheet: LeadAssenteSheet;
    salesUserId: string;
}) {
    const { leadId, companyId, phone, sheet, salesUserId } = input;
    return {
        id: leadId,
        companyId,
        name: sheet.fullName,
        phone,
        email: sheet.email,
        // Origine dedicata: il contratto entra nel fatturato totale ma resta
        // distinguibile nelle statistiche per funnel.
        funnel: 'FUORI FUNNEL',
        salespersonOutcome: 'Chiuso',
        salespersonOutcomeAt: sheet.signedAt,
        closeAmountEur: sheet.amountEur,
        salespersonAssigned: sheet.salesCode,
        salespersonUserId: salesUserId,
    };
}
