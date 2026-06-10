/**
 * Badge azienda del lead: verde = Serenamente, arancione = Fenice.
 * Colori HARDCODED (indipendenti dal tema) così la provenienza del lead è sempre
 * riconoscibile a colpo d'occhio, qualunque sia l'azienda in cui si sta lavorando.
 */
export function CompanyBadge({ companyId, className = "" }: { companyId?: string | null; className?: string }) {
  const isSerenamente = companyId === 'serenamente'
  return (
    <span
      title={isSerenamente ? 'Lead Serenamente' : 'Lead Fenice'}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider shrink-0 border ${
        isSerenamente
          ? 'bg-[#78B48C]/15 text-[#2F543E] border-[#78B48C]/40'
          : 'bg-orange-100 text-orange-700 border-orange-200'
      } ${className}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${isSerenamente ? 'bg-[#78B48C]' : 'bg-orange-500'}`} />
      {isSerenamente ? 'Serenamente' : 'Fenice'}
    </span>
  )
}
