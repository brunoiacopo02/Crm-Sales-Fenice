// Invio messaggi WhatsApp Serenamente via la webapp Twilio (no ActiveCampaign).
// Usato server-side (server actions). Il secret resta server-side.

const TEMPLATE_URL = process.env.SERENAMENTE_TEMPLATE_URL ?? "https://web-app-messaggistica.vercel.app/api/send-template"

/** Template Twilio per i messaggi di conferma (NR). */
export const SERENAMENTE_TEMPLATE_NR = "HX03ed6706d8dcac89be7b1a9c7f991b2a"            // dopo 1ª chiamata NR
export const SERENAMENTE_TEMPLATE_AUTOCONFERMA = "HX76ab1b241703e2742215d504d294e525" // dopo 3ª chiamata NR

/** Normalizza un numero IT a E.164 best-effort. */
export function normalizePhoneIT(raw: string): string | null {
  if (!raw) return null
  let p = raw.replace(/[^\d+]/g, "")
  if (!p) return null
  if (p.startsWith("+")) return p
  if (p.startsWith("00")) return "+" + p.slice(2)
  if (p.startsWith("39") && p.length >= 12) return "+" + p
  p = p.replace(/^0+/, "")
  if (!p) return null
  return "+39" + p
}

export type SendTemplateResult = { ok: boolean; sid?: string; error?: string }

/** POST a /api/send-template con secret da env. Best-effort: ritorna {ok:false,error} su fallimento. */
export async function sendSerenamenteTemplate(opts: {
  phone: string
  templateSid: string
  label?: string
  firstName?: string
  lastName?: string
}): Promise<SendTemplateResult> {
  const secret = process.env.SERENAMENTE_AGENDA_SECRET
  if (!secret) return { ok: false, error: "SERENAMENTE_AGENDA_SECRET non impostato" }
  const phone = normalizePhoneIT(opts.phone || "")
  if (!phone) return { ok: false, error: "Telefono mancante o non valido" }
  try {
    const res = await fetch(TEMPLATE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-agenda-secret": secret },
      body: JSON.stringify({ phone, templateSid: opts.templateSid, label: opts.label, firstName: opts.firstName, lastName: opts.lastName }),
    })
    const data: any = await res.json().catch(() => ({}))
    if (!res.ok || data?.ok === false) return { ok: false, error: data?.error || `HTTP ${res.status}` }
    return { ok: true, sid: data?.sid }
  } catch (e: any) {
    return { ok: false, error: e?.message || "Errore invio template" }
  }
}
