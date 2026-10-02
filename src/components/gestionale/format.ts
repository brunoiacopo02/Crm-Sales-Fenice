const EUR = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' })
export function formatEur(cents: number): string { return EUR.format(cents / 100) }
export function formatDate(d: string | null): string { return d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—' }
export function formatMonth(m: string): string {
    return new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${m}-01T00:00:00Z`))
}
