/**
 * Lead della brochure arrivati da ActiveCampaign (PO 10/11/2026).
 *
 * La campagna Meta della brochure gratuita (utm_campaign "Campagna di Ret - pdf")
 * porta su AC la Provenienza TELEGRAM. Fino al 10/11 il CRM li registrava col
 * funnel TELEGRAM e il bot gli mandava l'apertura del Telegram: 11 lead su 32 non
 * hanno mai ricevuto il PDF promesso dall'inserzione.
 *
 * Ora il lead della campagna entra col funnel PROFESSIONI, qualunque cosa dica la
 * Provenienza. Il segno e' lo stesso della pagina /marketing-analytics/brochure
 * ("brochure" o "pdf" in un utm). Il Black Friday vince comunque, la lista 137 e'
 * bloccata prima. Instradamento e tetto del bot restano quelli di sempre.
 *
 * Modulo puro: niente DB, niente rete.
 */
import { utmDaBrochure, FUNNEL_PROFESSIONI } from '@/lib/brochure/brochure';

export const BROCHURE_FUNNEL = FUNNEL_PROFESSIONI;

/** Il lead AC e' della campagna brochure? Basta un utm che nomini brochure o pdf. */
export function isLeadBrochureAc(i: {
    utmSource?: string | null;
    utmMedium?: string | null;
    utmCampaign?: string | null;
    utmContent?: string | null;
    utmTerm?: string | null;
}): boolean {
    return utmDaBrochure([i.utmSource, i.utmMedium, i.utmCampaign, i.utmContent, i.utmTerm]);
}

/** Slug dei sei corsi, come li scrive il bot in `conversations.professione`. */
export type SlugProfessione =
    | 'sviluppatore_web_ai' | 'video_editor' | 'project_manager'
    | 'graphic_designer' | 'copywriter' | 'social_media_manager';

// Stesse parole del catalogo del bot (lib/professioni.ts), stesso ordine:
// "social media manager" prima di "project manager".
const PAROLE: ReadonlyArray<[SlugProfessione, RegExp]> = [
    ['social_media_manager', /social\s*media\s*manager|\bsmm\b/i],
    ['project_manager', /project\s*manager/i],
    ['video_editor', /video\s*-?\s*editor|montaggio\s+video/i],
    ['graphic_designer', /graphic\s*designer|\bgrafic[ao]\b/i],
    ['copywriter', /copy\s*-?\s*writer/i],
    ['sviluppatore_web_ai', /sviluppatore\s+web|web\s*developer|\bsviluppatore\b/i],
];

/**
 * Il corso dall'utm_content dell'inserzione ("Video 1  smm" → social_media_manager).
 * "Video 2 generale" e ogni altro testo senza corso → null: Mario lo chiede.
 */
export function professioneDaUtmContent(utmContent: string | null | undefined): SlugProfessione | null {
    const t = utmContent ?? '';
    return PAROLE.find(([, re]) => re.test(t))?.[0] ?? null;
}
