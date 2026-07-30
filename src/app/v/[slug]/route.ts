import { NextRequest, NextResponse } from "next/server"
import { resolveVideoUrl } from "@/lib/videoLinks"
import { logLeadEvent } from "@/lib/eventLogger"

// Rotta pubblica: la aprono i lead da WhatsApp, senza sessione.
// Il bypass in src/middleware.ts evita il redirect a /login.
export const dynamic = 'force-dynamic'

// I crawler che generano l'anteprima del link (WhatsApp, Facebook, ecc.) aprono
// l'URL prima del lead: se li contassimo, ogni messaggio inviato risulterebbe
// subito "video aperto" e la metrica non varrebbe nulla.
const CRAWLER_UA = /facebookexternalhit|whatsapp|telegrambot|twitterbot|slackbot|discordbot|linkedinbot|bingbot|googlebot|preview/i

const LEAD_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function courtesyPage() {
    return new NextResponse(
        `<!doctype html><html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Contenuto non disponibile</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f7f7f8;color:#27272a;padding:24px}
.b{max-width:420px;text-align:center}h1{font-size:20px;margin:0 0 12px}p{font-size:15px;line-height:1.5;color:#52525b;margin:0}</style>
</head><body><div class="b"><h1>Contenuto non disponibile</h1>
<p>Il video che stai cercando non &egrave; raggiungibile. Contatta il tuo consulente e te lo rimander&agrave; subito.</p>
</div></body></html>`,
        { status: 404, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } }
    )
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ slug: string }> }
) {
    const { slug } = await params
    const { url, known } = resolveVideoUrl(slug)

    if (!known || !url) {
        console.error(`[video-link] slug non risolto: "${slug}"`)
        return courtesyPage()
    }

    // Tracciamento best-effort: non deve MAI ritardare o rompere il redirect.
    // Il lead deve vedere il video anche se il DB è giù.
    const leadId = request.nextUrl.searchParams.get('l')
    const ua = request.headers.get('user-agent') || ''
    if (leadId && LEAD_ID_RE.test(leadId) && !CRAWLER_UA.test(ua)) {
        try {
            await logLeadEvent({
                leadId,
                eventType: 'VIDEO_OPENED',
                metadata: { slug, source: 'whatsapp' },
                companyId: 'fenice',
            })
        } catch (e) {
            console.error('[video-link] log VIDEO_OPENED fallito:', e)
        }
    }

    return NextResponse.redirect(url, { status: 302, headers: { 'cache-control': 'no-store' } })
}
