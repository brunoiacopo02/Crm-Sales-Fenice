import { Brain } from "lucide-react"

/** Logo SerenaMente per la sidebar (sfondo scuro): badge verde salvia con
 *  cervello navy + wordmark bianco + payoff. Font Sora. */
export function SerenaMenteLogo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="w-9 h-9 rounded-lg bg-[#78B48C] flex items-center justify-center shrink-0 shadow-sm">
        <Brain className="w-5 h-5 text-[#191970]" />
      </div>
      <div className="flex flex-col leading-tight">
        <span
          className="font-bold text-base text-white tracking-wide"
          style={{ fontFamily: "var(--font-sora), sans-serif" }}
        >
          SerenaMente
        </span>
        <span className="text-[10px] text-[#78B48C] tracking-wide -mt-0.5">crescita mentale</span>
      </div>
    </div>
  )
}
