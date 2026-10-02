export type ContrattoRow = { id: string; dataFirma: string | null; pacchetto: string | null; importoTotaleCents: number; statoPagamento: string | null; venditoreCode: string | null; note: string | null; clienteNome: string | null; clienteCognome: string | null; clienteTelefono: string | null; clienteEmail: string | null }
export type RataRow = { id: string; contrattoId: string; numero: number | null; tipo: string | null; scadenza: string | null; importoCents: number; stato: string | null; incassoId: string | null }
export type IncassoRow = { id: string; contrattoId: string; data: string | null; importoCents: number; metodo: string | null; voce: string | null; stato: string | null; stornoDi: string | null; rataId: string | null; venditoreCode: string | null; contaCommissione: boolean; meseCommissione: string | null }
export type CommissioneRow = { venditoreCode: string; mese: string; totaleIncassatoCents: number; commissioneLordaCents: number; commissioneImponibileCents: number }
export type SnapshotRows = { generatoIl: string | null; contratti: ContrattoRow[]; rate: RataRow[]; incassi: IncassoRow[]; commissioni: CommissioneRow[] }
export const DIREZIONE = 'DIREZIONE'
