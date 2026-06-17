/**
 * Tema estetico per-utente (override token brand via [data-theme] in globals.css).
 * Scoped per email perché robusto al re-seed (gli UUID utente sono rigenerati,
 * l'email no) e coerente col pattern email-gate già usato (isConfermeTl).
 */
export type UserTheme = 'rosa'

const USER_THEME_BY_EMAIL: Record<string, UserTheme> = {
  'andrea@fenice.local': 'rosa',
}

export function getUserTheme(email: string | null | undefined): UserTheme | undefined {
  if (!email) return undefined
  return USER_THEME_BY_EMAIL[email.toLowerCase()]
}
