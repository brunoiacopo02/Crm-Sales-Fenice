// src/lib/marketing/meta-credentials.ts
// Risolve le credenziali Meta (Facebook Marketing API) per company.
//
// Env convention: META_ACCESS_TOKEN_<SLUG_UPPER>.
// Per backwards compat con Fenice: se l'env scoped è mancante, fallback
// all'env legacy META_ACCESS_TOKEN (solo per slug 'fenice').

export interface MetaCredentials {
    accessToken: string;
}

export function getMetaCredentials(companyId: string): MetaCredentials | null {
    const upper = companyId.toUpperCase().replace(/-/g, '_');
    const token = process.env[`META_ACCESS_TOKEN_${upper}`];
    if (token) return { accessToken: token };
    if (companyId === 'fenice') {
        const legacy = process.env.META_ACCESS_TOKEN;
        if (legacy) return { accessToken: legacy };
    }
    return null;
}
