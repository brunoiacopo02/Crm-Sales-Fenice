// Chi vede le pagine del gruppo Marketing: ADMIN e MANAGER (ruolo dalla
// tabella users) e l'account marketing dedicato, come /marketing-analytics.

import { conRuoloDb } from '@/lib/auth/ruoloDb'
import { createClient } from '@/utils/supabase/server'

export const EMAIL_MARKETING = 'marketing@fenice.local'

export async function puoVedereMarketing(): Promise<boolean> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return false
    if (user.email === EMAIL_MARKETING) return true
    return !!(await conRuoloDb(['ADMIN', 'MANAGER']))
}
