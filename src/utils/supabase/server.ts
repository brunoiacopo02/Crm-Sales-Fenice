import { createServerClient } from "@supabase/ssr";

export async function createClient() {
    if (process.env.E2E_CLI_MODE === 'true') {
        return {
            auth: {
                getUser: async () => ({
                    data: {
                        user: {
                            id: process.env.E2E_USER_ID || '00000000-0000-0000-0000-000000000000',
                            email: 'admin@fenice.local',
                            user_metadata: { role: 'ADMIN', name: 'Admin Test' }
                        }
                    }
                })
            }
        } as any;
    }

    const { cookies } = await import("next/headers");
    const cookieStore = await cookies();

    return createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return cookieStore.getAll();
                },
                setAll(cookiesToSet) {
                    try {
                        cookiesToSet.forEach(({ name, value, options }) =>
                            cookieStore.set(name, value, options)
                        );
                    } catch {
                        // Server Component cannot set cookies but Middleware will
                    }
                },
            },
        }
    );
}
