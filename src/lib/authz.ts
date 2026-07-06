import { redirect } from 'next/navigation'

export async function requireRole(session: { user?: { role?: string } } | null, roles: string[]): Promise<void> {
    if (!session?.user?.role || !roles.includes(session.user.role)) redirect('/unauthorized')
}
