import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(request: NextRequest) {
    // I webhook esterni (ActiveCampaign, ecc.) non hanno sessione Supabase:
    // devono passare dritti al route handler, che valida col proprio secret.
    if (request.nextUrl.pathname.startsWith('/api/webhooks/')) {
        return NextResponse.next({ request });
    }

    // Il bot fissatore chiama /api/bot/* con HMAC proprio (x-bot-signature):
    // nessuna sessione Supabase, bypass del middleware come i webhook.
    if (request.nextUrl.pathname.startsWith('/api/bot/')) {
        return NextResponse.next({ request });
    }

    // Vercel Cron e PULL endpoint marketing usano auth via Bearer token,
    // non Supabase session — bypass del middleware.
    if (request.nextUrl.pathname.startsWith('/api/cron/')
        || request.nextUrl.pathname === '/api/marketing/leads') {
        return NextResponse.next({ request });
    }

    let supabaseResponse = NextResponse.next({
        request,
    });

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return request.cookies.getAll();
                },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value));
                    supabaseResponse = NextResponse.next({
                        request,
                    });
                    cookiesToSet.forEach(({ name, value, options }) =>
                        supabaseResponse.cookies.set(name, value, options)
                    );
                },
            },
        }
    );

    let user = null;
    let timedOut = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
        const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => {
                timedOut = true;
                reject(new Error('SUPABASE_AUTH_TIMEOUT'));
            }, 3000);
        });
        const result = await Promise.race([supabase.auth.getUser(), timeoutPromise]);
        user = result.data?.user;
    } catch {
        // Two failure modes:
        //  - timedOut === true: upstream Supabase blip (UND_ERR_CONNECT_TIMEOUT, etc).
        //    Redirect to /login WITHOUT clearing cookies so the user is logged back in
        //    on the next request once Supabase recovers — a transient outage must not
        //    mass-logout everyone.
        //  - timedOut === false: token refresh crash / parse error. Clear cookies.
        if (!request.nextUrl.pathname.startsWith('/login')) {
            const url = request.nextUrl.clone();
            url.pathname = '/login';
            const response = NextResponse.redirect(url);
            if (!timedOut) {
                request.cookies.getAll().forEach(c => {
                    if (c.name.includes('auth-token')) {
                        response.cookies.delete(c.name);
                    }
                });
            }
            return response;
        }
        return supabaseResponse;
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }

    if (!user && !request.nextUrl.pathname.startsWith('/login')) {
        const url = request.nextUrl.clone();
        url.pathname = '/login';
        return NextResponse.redirect(url);
    }

    return supabaseResponse;
}

export const config = {
    matcher: [
        "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
    ],
};
