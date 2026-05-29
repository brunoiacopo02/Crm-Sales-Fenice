// src/lib/marketing/ac-credentials.ts
// Risolve le credenziali ActiveCampaign per company.
//
// Env convention: AC_API_URL_<SLUG_UPPER> + AC_API_KEY_<SLUG_UPPER>.
// Per backwards compat con Fenice: se le env scoped sono mancanti,
// fallback alle env legacy AC_API_URL / AC_API_KEY (solo per slug 'fenice').

export interface AcCredentials {
    url: string;
    key: string;
}

export function getAcCredentials(companyId: string): AcCredentials | null {
    const upper = companyId.toUpperCase().replace(/-/g, '_');
    const url = process.env[`AC_API_URL_${upper}`];
    const key = process.env[`AC_API_KEY_${upper}`];
    if (url && key) return { url: url.replace(/\/$/, ''), key };
    if (companyId === 'fenice') {
        const legacyUrl = process.env.AC_API_URL;
        const legacyKey = process.env.AC_API_KEY;
        if (legacyUrl && legacyKey) {
            return { url: legacyUrl.replace(/\/$/, ''), key: legacyKey };
        }
    }
    return null;
}
