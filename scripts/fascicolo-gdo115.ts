/**
 * Fascicolo probatorio GDO 115 — estrazione allegati.
 *
 *   npx tsx --env-file=.env scripts/fascicolo-gdo115.ts
 *
 * Produce in data/fascicolo-gdo115/ (cartella gitignorata: contiene dati personali):
 *   B-chiamate-postazione-GDO115.csv      tutte le chiamate uscenti della postazione nella finestra
 *   C-esiti-GDO115-con-verifica.csv       ogni esito CRM della persona, con l'esito della verifica sui tabulati
 *   D-confronto-squadra.csv               tabella di raffronto, colleghi pseudonimizzati
 *   E1-lead-mai-chiamati.csv              lead toccati senza chiamata e MAI composti da nessuno
 *   E2-lead-toccati-senza-chiamata.csv    tutti i lead toccati senza chiamata (gruppo recuperati + mai chiamati)
 *   G-giorno-per-giorno.csv               giornata per giornata, con la squadra come controllo
 *   H-dopo-il-24-agosto.csv               andamento 25/08 -> ultimo tabulato importato
 *   I-mesi-aprile-agosto.csv              stessa misura mese per mese da aprile, con il test di completezza dei tabulati
 *   F-legenda-pseudonimi.txt              SOLO per chi deve risalire ai nomi: non va nella cartella condivisa
 *   riepilogo.json                        tutti i numeri usati nel documento, dallo stesso calcolo
 *
 * Definizione unica, usata ovunque: un esito e' "scoperto" quando nei tabulati del
 * centralino non esiste alcuna chiamata (in nessuna direzione, da nessun interno) verso
 * le ultime dieci cifre del numero del lead nella stessa giornata (ora di Roma).
 * Finestra 2026-07-01 .. 2026-08-24, escluso il 2026-07-04 (centralino fermo per tutti:
 * 1 chiamata registrata in tutta la giornata contro 1.385 esiti di 8 operatori).
 */
import { Pool } from 'pg'
import { mkdirSync, writeFileSync, copyFileSync, createReadStream, statSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

const OUT = join(process.cwd(), 'data', 'fascicolo-gdo115')
const WIN_FROM = '2026-07-01'
const WIN_TO = '2026-08-24'
const EXCLUDED_DAY = '2026-07-04'
const GDO115 = 'a2d174ce-916c-4d02-92f6-e5b7c6ef5adf'
const CPL_EUR = 9.5 // costo per lead a pagamento, parametro dichiarato nel documento

// Pseudonimi: la persona interessata resta col suo codice, i colleghi diventano lettere.
const PSEUDO: Record<string, string> = {
    'GDO 105': 'Operatore A', 'GDO 106': 'Operatore B', 'GDO 107': 'Operatore C',
    'GDO 109': 'Operatore D', 'GDO 110': 'Operatore E', 'GDO 112': 'Operatore F',
    'GDO 114': 'Operatore G', 'GDO 117': 'Operatore H', 'GDO 118': 'Operatore I',
    'GDO 119': 'Operatore J', 'GDO 115': 'GDO 115', 'GDO 108': 'Operatore K',
}
// Interno usato da ciascuno NELLA FINESTRA: tre postazioni sono state scambiate il 27/08,
// quindi pbxExtensions di oggi non descrive luglio-agosto.
const EXT_WINDOW: Record<string, string> = {
    'GDO 105': '1016', 'GDO 106': '1014', 'GDO 107': '1009 (dal 27/08/2026: 1023)', 'GDO 108': 'n/d (attivo fino a maggio)', 'GDO 109': '1008',
    'GDO 110': '1020 (dal 27/08/2026: 1009)', 'GDO 112': '1023 (dal 27/08/2026: 1020)', 'GDO 114': '1015', 'GDO 115': '1007 (Clara Muresan; invariato per tutta la finestra)',
    'GDO 117': '1017', 'GDO 118': '1010', 'GDO 119': '1019',
}
// Esclusi dal confronto, con motivo scritto nel documento
const EXCLUDED_USERS = "('GDO 201','GDO 116')"

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 3 })

function csv(rows: Record<string, unknown>[], columns?: string[]): string {
    const cols = columns ?? Object.keys(rows[0] ?? {})
    const esc = (v: unknown) => {
        if (v === null || v === undefined) return ''
        const s = v instanceof Date ? v.toISOString() : String(v)
        return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    return '﻿' + [cols.join(';'), ...rows.map(r => cols.map(c => esc(r[c])).join(';'))].join('\r\n') + '\r\n'
}
async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const r = await pool.query(sql, params)
    return r.rows as T[]
}
function sha256(path: string): Promise<string> {
    return new Promise((res, rej) => {
        const h = createHash('sha256')
        createReadStream(path).on('data', d => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej)
    })
}

// CTE comune: esiti degli operatori nella finestra, con la verifica sui tabulati
const BASE = `
with e as (
  select c.id, c."userId", c."leadId", c.outcome, c.note, c."discardReason", c."createdAt",
         (c."createdAt" at time zone 'Europe/Rome') as t_rome,
         (c."createdAt" at time zone 'Europe/Rome')::date as d,
         l.phone, l.funnel,
         right(regexp_replace(coalesce(l.phone,''),'\\D','','g'),10) as key
  from "callLogs" c join leads l on l.id=c."leadId"
  where (c."createdAt" at time zone 'Europe/Rome')::date between $1::date and $2::date
    and (c."createdAt" at time zone 'Europe/Rome')::date <> $3::date
    and c."userId" in (select id from users where role='GDO' and "statsActive" and name not in ${EXCLUDED_USERS})
), ec as (
  select e.*, length(e.key)>=10 as validkey,
    (select count(*) from "pbxCalls" p where p."dstKey"=e.key and p."dateLocal"=e.d::text) as n_sameday,
    (select min(p."dateLocal") from "pbxCalls" p where p."dstKey"=e.key) as first_call_day,
    (select count(*) from "pbxCalls" p where p."dstKey"=e.key) as n_ever
  from e
)`
const P = [WIN_FROM, WIN_TO, EXCLUDED_DAY]

async function main() {
    await pool.query("set statement_timeout = '600s'")
    mkdirSync(OUT, { recursive: true })
    writeFileSync(join(OUT, '.gitignore'), '*\n!.gitignore\n')
    const riepilogo: Record<string, unknown> = {
        generato_il: new Date().toISOString(), finestra: { da: WIN_FROM, a: WIN_TO, giorno_escluso: EXCLUDED_DAY },
        definizione: 'esito scoperto = nessuna chiamata (qualsiasi direzione, qualsiasi interno) verso le ultime 10 cifre del numero nella stessa giornata (ora di Roma)',
        cpl_eur: CPL_EUR,
    }

    // --- D: confronto squadra ---------------------------------------------------------
    const team = await q(`${BASE},
      calls as (select "userId", count(*) n, count(*) filter (where billsec>0) risp, count(distinct "dateLocal") giorni
                from "pbxCalls" where direction='out' and "dateLocal" between $1::text and $2::text and "dateLocal"<>$3::text group by 1),
      gaps as (select ec."userId", ec.validkey and ec.n_sameday=0 as scoperto,
                 extract(epoch from (ec."createdAt" - lag(ec."createdAt") over (partition by ec."userId" order by ec."createdAt", ec.id))) gap from ec)
      select u.name, count(*)::int esiti, count(*) filter (where not validkey)::int numeri_non_validi,
        coalesce((select n from calls where calls."userId"=u.id),0)::int chiamate,
        coalesce((select risp from calls where calls."userId"=u.id),0)::int risposte,
        coalesce((select giorni from calls where calls."userId"=u.id),0)::int giorni_al_telefono,
        round(1.0*count(*)/nullif((select n from calls where calls."userId"=u.id),0),2)::float rapporto_esiti_chiamate,
        count(*) filter (where validkey and n_sameday=0)::int scoperti,
        round(100.0*count(*) filter (where validkey and n_sameday=0)/nullif(count(*) filter (where validkey),0),1)::float pct_scoperti,
        count(*) filter (where validkey and n_ever=0)::int mai_chiamati,
        round(100.0*count(*) filter (where validkey and n_ever=0)/nullif(count(*) filter (where validkey),0),1)::float pct_mai_chiamati,
        count(*) filter (where outcome='APPUNTAMENTO')::int appuntamenti,
        count(*) filter (where outcome='APPUNTAMENTO' and validkey and n_sameday=0)::int appuntamenti_scoperti,
        count(*) filter (where outcome='RICHIAMO')::int richiami,
        count(*) filter (where outcome='RICHIAMO' and validkey and n_sameday=0)::int richiami_scoperti,
        (select count(*) from gaps g where g."userId"=u.id and g.scoperto and g.gap<10)::int scoperti_entro_10s_dal_precedente,
        (select round(percentile_cont(0.5) within group (order by gap)) from gaps g where g."userId"=u.id and g.scoperto and g.gap<3600)::int mediana_secondi_scoperti,
        (select round(percentile_cont(0.5) within group (order by gap)) from gaps g where g."userId"=u.id and not g.scoperto and g.gap<3600)::int mediana_secondi_coperti
      from ec join users u on u.id=ec."userId" group by u.id,u.name order by pct_scoperti desc`, P)
    const teamRows = team.map(r => ({ operatore: PSEUDO[r.name as string] ?? (r.name as string), ...Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'name')) }))
    writeFileSync(join(OUT, 'D-confronto-squadra.csv'), csv(teamRows))
    riepilogo.confronto_squadra = teamRows

    // --- produzione (contesto di equita') --------------------------------------------
    const prod = await q(`with app as (
        select distinct on (c."leadId") c."leadId", c."userId" from "callLogs" c
        where c.outcome='APPUNTAMENTO' and (c."createdAt" at time zone 'Europe/Rome')::date between $1::date and $2::date
          and c."userId" in (select id from users where role='GDO' and "statsActive" and name not in ${EXCLUDED_USERS})
        order by c."leadId", c."createdAt" desc)
      select u.name, count(*)::int appuntamenti_fissati, count(*) filter (where l."presentedAt" is not null)::int presenze,
        count(*) filter (where coalesce(l."closeAmountEur",0)>0)::int vendite, coalesce(sum(l."closeAmountEur"),0)::float fatturato_eur
      from app join leads l on l.id=app."leadId" join users u on u.id=app."userId" group by u.id,u.name order by fatturato_eur desc`, [WIN_FROM, WIN_TO])
    riepilogo.produzione = prod.map(r => { const { name, ...rest } = r; return { operatore: PSEUDO[name as string] ?? name, ...rest } })

    // --- C: esiti di GDO 115 con verifica ---------------------------------------------
    const esiti = await q(`${BASE}
      select ec.id, to_char(ec.t_rome,'YYYY-MM-DD') giorno, to_char(ec.t_rome,'HH24:MI:SS') ora, ec."leadId" lead_id, ec.phone telefono, ec.key ultime_10_cifre,
        ec.funnel, ec.outcome esito, ec."discardReason" motivo_scarto, ec.note nota, ec.validkey, ec.n_sameday::int chiamate_stesso_giorno, ec.first_call_day prima_chiamata_mai_registrata, ec.n_ever::int chiamate_totali_al_numero,
        trunc(extract(epoch from (ec."createdAt" - lag(ec."createdAt") over (order by ec."createdAt", ec.id)))::numeric,3)::float secondi_dall_esito_precedente
      from ec where ec."userId"=$4 order by ec."createdAt", ec.id`, [...P, GDO115])
    const cls = (r: Record<string, unknown>) => !r.validkey ? 'NUMERO NON VALIDO (escluso dai conteggi)'
        : (r.chiamate_stesso_giorno as number) > 0 ? 'COPERTO: chiamata nello stesso giorno'
        : (r.chiamate_totali_al_numero as number) > 0 ? 'SCOPERTO: chiamato solo in un altro giorno'
        : 'SCOPERTO: numero mai chiamato da nessuno'
    const esitiRows = esiti.map(r => ({ ...r, verifica_tabulati: cls(r), validkey: undefined }))
    writeFileSync(join(OUT, 'C-esiti-GDO115-con-verifica.csv'), csv(esitiRows,
        ['id', 'giorno', 'ora', 'lead_id', 'telefono', 'ultime_10_cifre', 'funnel', 'esito', 'motivo_scarto', 'verifica_tabulati', 'chiamate_stesso_giorno', 'prima_chiamata_mai_registrata', 'chiamate_totali_al_numero', 'secondi_dall_esito_precedente', 'nota']))
    const perEsito: Record<string, Record<string, number>> = {}
    for (const r of esitiRows) {
        const o = r.esito as string; perEsito[o] ??= { totale: 0, coperti: 0, scoperti_altro_giorno: 0, scoperti_mai_chiamati: 0, numeri_non_validi: 0 }
        perEsito[o].totale++
        const v = r.verifica_tabulati as string
        if (v.startsWith('COPERTO')) perEsito[o].coperti++
        else if (v.includes('altro giorno')) perEsito[o].scoperti_altro_giorno++
        else if (v.includes('mai chiamato')) perEsito[o].scoperti_mai_chiamati++
        else perEsito[o].numeri_non_validi++
    }
    riepilogo.gdo115_per_esito = perEsito

    // --- B: chiamate della postazione ---------------------------------------------------
    const chiamate = await q(`select p.id uniqueid, to_char(p.calldate at time zone 'Europe/Rome','YYYY-MM-DD') giorno, to_char(p.calldate at time zone 'Europe/Rome','HH24:MI:SS') ora_roma,
        to_char(p.calldate at time zone 'UTC','YYYY-MM-DD HH24:MI:SS') calldate_utc_come_nel_tabulato, p.src interno, p."dstKey" numero_chiamato_ultime_10, p.duration durata_totale_s, p.billsec conversazione_s, p.disposition esito_tecnico
      from "pbxCalls" p where p."userId"=$1 and p.direction='out' and p."dateLocal" between $2::text and $3::text order by p.calldate`, [GDO115, WIN_FROM, WIN_TO])
    writeFileSync(join(OUT, 'B-chiamate-postazione-GDO115.csv'), csv(chiamate))
    riepilogo.gdo115_chiamate_uscenti_incluso_4_luglio = chiamate.length

    // --- E: lead toccati senza chiamata ------------------------------------------------
    const leadRows = await q(`${BASE},
      lk as (select id, coalesce("closeAmountEur",0) eur, right(regexp_replace(coalesce(phone,''),'\\D','','g'),10) key from leads),
      sc as (select ec."leadId", ec.key, max(ec.d) ultimo_esito_scoperto from ec where ec."userId"=$4 and ec.validkey and ec.n_sameday=0 group by 1,2),
      lc as (select sc."leadId", sc.key, sc.ultimo_esito_scoperto,
        (select count(*) from "pbxCalls" p where p."dstKey"=sc.key) n_ever,
        (select min(p."dateLocal") from "pbxCalls" p where p."dstKey"=sc.key) prima_chiamata,
        (select count(*) from "pbxCalls" p where p."dstKey"=sc.key and p."dateLocal">sc.ultimo_esito_scoperto::text) n_dopo,
        exists(select 1 from "pbxCalls" p where p."dstKey"=sc.key and p."dateLocal">sc.ultimo_esito_scoperto::text and p."userId"=$4) dopo_lei,
        exists(select 1 from "pbxCalls" p where p."dstKey"=sc.key and p."dateLocal">sc.ultimo_esito_scoperto::text and p."userId" is not null and p."userId"<>$4) dopo_altri,
        exists(select 1 from "leadEvents" le where le."leadId"=sc."leadId" and le."eventType"='REASSIGNED_FROM_BOT') rientrato_dal_bot,
        (select string_agg(lk.id, ',') from lk where lk.key=sc.key and lk.id<>sc."leadId") altri_record_stesso_numero,
        (select coalesce(sum(lk.eur),0) from lk where lk.key=sc.key and lk.id<>sc."leadId") eur_altri_record
        from sc)
      select lc."leadId" lead_id, l.phone telefono, l.funnel, l."createdAt"::date lead_creato_il, l.status stato_attuale,
        case when lc.n_ever=0 then 'MAI CHIAMATO DA NESSUNO' when lc.n_dopo=0 then 'CHIAMATO SOLO PRIMA dell''esito scoperto' else 'RECUPERATO: chiamato dopo l''esito scoperto' end gruppo,
        lc.ultimo_esito_scoperto, lc.n_ever::int chiamate_totali_al_numero, lc.prima_chiamata, lc.n_dopo::int chiamate_dopo_esito_scoperto, lc.dopo_lei chiamato_dopo_da_gdo115, lc.dopo_altri chiamato_dopo_da_altri,
        lc.rientrato_dal_bot, lc.altri_record_stesso_numero, lc.eur_altri_record::float fatturato_su_altri_record,
        (select count(*) from "callLogs" c where c."leadId"=l.id and c."userId"=$4 and (c."createdAt" at time zone 'Europe/Rome')::date between $1::date and $2::date)::int esiti_gdo115_finestra,
        (select min((c."createdAt" at time zone 'Europe/Rome')) from "callLogs" c where c."leadId"=l.id and c."userId"=$4)::text primo_esito_gdo115,
        exists(select 1 from "callLogs" c where c."leadId"=l.id and c.outcome='APPUNTAMENTO') appuntamento_preso,
        l."presentedAt" is not null presentato, coalesce(l."closeAmountEur",0)::float fatturato_eur,
        case when l.funnel in ('Database') then 'database (costo 0)' else 'a pagamento' end tipo_costo
      from lc join leads l on l.id=lc."leadId" order by gruppo, l."createdAt"`, [...P, GDO115])
    const mai = leadRows.filter(r => r.gruppo === 'MAI CHIAMATO DA NESSUNO')
    const prima = leadRows.filter(r => (r.gruppo as string).startsWith('CHIAMATO SOLO PRIMA'))
    const rec = leadRows.filter(r => (r.gruppo as string).startsWith('RECUPERATO'))
    writeFileSync(join(OUT, 'E1-lead-mai-chiamati.csv'), csv(mai))
    writeFileSync(join(OUT, 'E2-lead-toccati-senza-chiamata.csv'), csv(leadRows))
    const agg = (rows: Record<string, unknown>[]) => ({
        lead: rows.length,
        a_pagamento: rows.filter(r => r.tipo_costo === 'a pagamento').length,
        database: rows.filter(r => r.tipo_costo !== 'a pagamento').length,
        appuntamenti: rows.filter(r => r.appuntamento_preso).length,
        presenze: rows.filter(r => r.presentato).length,
        vendite: rows.filter(r => (r.fatturato_eur as number) > 0).length,
        fatturato_eur: rows.reduce((s, r) => s + (r.fatturato_eur as number), 0),
        chiamati_dopo_da_gdo115: rows.filter(r => r.chiamato_dopo_da_gdo115).length,
        chiamati_dopo_da_altri: rows.filter(r => r.chiamato_dopo_da_altri).length,
        rientrati_dal_bot: rows.filter(r => r.rientrato_dal_bot).length,
        numeri_distinti: new Set(rows.map(r => r.telefono)).size,
        con_altro_record_stesso_numero: rows.filter(r => r.altri_record_stesso_numero).length,
        fatturato_su_altri_record_eur: rows.reduce((s, r) => s + (r.fatturato_su_altri_record as number), 0),
        per_funnel: Object.fromEntries([...new Set(rows.map(r => r.funnel))].map(f => [f, rows.filter(r => r.funnel === f).length])),
    })
    const gMai = agg(mai), gPrima = agg(prima), gRec = agg(rec)
    const resaAppRec = gRec.appuntamenti / gRec.lead, resaEurRec = gRec.fatturato_eur / gRec.lead
    const tot = gRec.lead + gPrima.lead
    const resaAppTot = gRec.appuntamenti / tot, resaEurTot = gRec.fatturato_eur / tot
    riepilogo.lead = {
        toccati_senza_chiamata: leadRows.length, recuperati_chiamati_dopo: gRec, chiamati_solo_prima: gPrima, mai_chiamati: gMai,
        stima_controfattuale: {
            metodo: 'resa osservata sui lead chiamati, applicata ai 269 mai chiamati; prudente = resa su tutti i 921 chiamati (prima o dopo), piena = resa sui soli chiamati dopo',
            prudente: { resa_app: resaAppTot, resa_eur: resaEurTot, appuntamenti: +(resaAppTot * gMai.lead).toFixed(1), fatturato_eur: +(resaEurTot * gMai.lead).toFixed(0) },
            piena: { resa_app: resaAppRec, resa_eur: resaEurRec, appuntamenti: +(resaAppRec * gMai.lead).toFixed(1), fatturato_eur: +(resaEurRec * gMai.lead).toFixed(0) },
            costo_lead_pagati_mai_chiamati_eur: +(gMai.a_pagamento * CPL_EUR).toFixed(2),
        },
    }
    // motivi di scarto: lei contro gli altri dieci
    riepilogo.motivi_scarto = await q(`${BASE}
      select case when ec."userId"=$4 then 'GDO 115' else 'altri dieci' end chi, coalesce(ec."discardReason",'(vuoto)') motivo,
        count(*)::int totale, count(*) filter (where validkey and n_sameday>0)::int coperti, count(*) filter (where validkey and n_sameday=0)::int scoperti, count(*) filter (where validkey and n_ever=0)::int mai_chiamati
      from ec where ec.outcome='DA_SCARTARE' group by 1,2 order by 1, 3 desc`, [...P, GDO115])
    // mesi precedenti, stessa misura, con il test di completezza dei tabulati (appuntamenti scoperti)
    riepilogo.mesi_aprile_agosto = (await q(`${BASE}
      select u.name, to_char(ec.d,'YYYY-MM') mese, count(*)::int esiti,
        round(100.0*count(*) filter (where validkey and n_sameday=0)/nullif(count(*) filter (where validkey),0),1)::float pct_scoperti,
        count(*) filter (where outcome='APPUNTAMENTO')::int appuntamenti,
        count(*) filter (where outcome='APPUNTAMENTO' and validkey and n_sameday=0)::int appuntamenti_scoperti,
        round(100.0*count(*) filter (where outcome='APPUNTAMENTO' and validkey and n_sameday=0)/nullif(count(*) filter (where outcome='APPUNTAMENTO' and validkey),0),1)::float pct_appuntamenti_scoperti
      from ec join users u on u.id=ec."userId" group by u.name, 2 order by 2, pct_scoperti desc`, ['2026-04-01', WIN_TO, EXCLUDED_DAY]))
      .map(r => { const { name, ...rest } = r; return { operatore: PSEUDO[name as string] ?? name, ...rest } })
    writeFileSync(join(OUT, 'I-mesi-aprile-agosto.csv'), csv(riepilogo.mesi_aprile_agosto as Record<string, unknown>[]))

    // --- G: giorno per giorno ---------------------------------------------------------
    const giorni = await q(`${BASE},
      team as (select d, round(100.0*count(*) filter (where validkey and n_sameday=0)/nullif(count(*) filter (where validkey),0),1)::float pct_squadra, count(distinct "userId")::int operatori_squadra from ec where "userId"<>$4 group by d),
      her as (select d, count(*)::int esiti, count(*) filter (where validkey and n_sameday=0)::int scoperti,
              round(100.0*count(*) filter (where validkey and n_sameday=0)/nullif(count(*) filter (where validkey),0),1)::float pct_scoperti,
              count(*) filter (where outcome='APPUNTAMENTO')::int appuntamenti from ec where "userId"=$4 group by d),
      calls as (select "dateLocal"::date d, count(*)::int n, count(*) filter (where billsec>0)::int risp from "pbxCalls" where direction='out' and "userId"=$4 and "dateLocal" between $1::text and $2::text group by 1)
      select to_char(her.d,'YYYY-MM-DD') giorno, to_char(her.d,'Dy') gg, her.esiti, coalesce(calls.n,0) chiamate, coalesce(calls.risp,0) risposte, her.scoperti, her.pct_scoperti, her.appuntamenti, team.pct_squadra pct_scoperti_resto_squadra, team.operatori_squadra
      from her left join calls on calls.d=her.d left join team on team.d=her.d order by her.d`, [...P, GDO115])
    writeFileSync(join(OUT, 'G-giorno-per-giorno.csv'), csv(giorni))
    riepilogo.giorno_per_giorno = giorni

    // --- H: dopo il 24 agosto (fino all'ultimo tabulato importato) --------------------
    // l'ultimo giorno importato e' sempre parziale (l'export si fa a meta' pomeriggio): ci si ferma al giorno prima
    const lastDay = (await q<{ d: string }>(`select (max("dateLocal")::date - 1)::text d from "pbxCalls"`))[0].d
    const dopo = await q(`${BASE},
      team as (select d, round(100.0*count(*) filter (where validkey and n_sameday=0)/nullif(count(*) filter (where validkey),0),1)::float pct_squadra from ec where "userId"<>$4 group by d),
      her as (select d, count(*)::int esiti, count(*) filter (where validkey and n_sameday=0)::int scoperti,
              round(100.0*count(*) filter (where validkey and n_sameday=0)/nullif(count(*) filter (where validkey),0),1)::float pct_scoperti from ec where "userId"=$4 group by d),
      calls as (select "dateLocal"::date d, count(*)::int n from "pbxCalls" where direction='out' and "userId"=$4 and "dateLocal" between $1::text and $2::text group by 1)
      select to_char(her.d,'YYYY-MM-DD') giorno, to_char(her.d,'Dy') gg, her.esiti, coalesce(calls.n,0) chiamate, her.scoperti, her.pct_scoperti, team.pct_squadra pct_scoperti_resto_squadra
      from her left join calls on calls.d=her.d left join team on team.d=her.d order by her.d`, ['2026-08-25', lastDay, '1900-01-01', GDO115])
    writeFileSync(join(OUT, 'H-dopo-il-24-agosto.csv'), csv(dopo))
    riepilogo.dopo_il_24_agosto = { ultimo_tabulato_importato: lastDay, giorni: dopo }

    // --- giornata del centralino fermo (prova dell'esclusione) -------------------------
    riepilogo.giorno_escluso = (await q(`select (select count(*)::int from "callLogs" c where (c."createdAt" at time zone 'Europe/Rome')::date=$1::date and c."userId" in (select id from users where role='GDO' and "statsActive" and name not in ${EXCLUDED_USERS})) esiti_squadra,
        (select count(distinct "userId")::int from "callLogs" c where (c."createdAt" at time zone 'Europe/Rome')::date=$1::date and c."userId" in (select id from users where role='GDO' and "statsActive" and name not in ${EXCLUDED_USERS})) operatori,
        (select count(*)::int from "pbxCalls" where "dateLocal"=$1::text and direction='out') chiamate_uscenti_registrate,
        (select count(*)::int from "pbxCalls" where "dateLocal"=$1::text) righe_tabulato_totali`, [EXCLUDED_DAY]))[0]

    // --- tabulati grezzi: copia + impronte -------------------------------------------
    const rawDir = join(OUT, 'A-tabulati-grezzi-centralino'); mkdirSync(rawDir, { recursive: true })
    const raw = []
    for (const f of readdirSync(join(process.cwd(), 'data', 'cdr')).filter(f => f.endsWith('.csv')).sort()) {
        const src = join(process.cwd(), 'data', 'cdr', f); const dst = join(rawDir, f)
        copyFileSync(src, dst)
        raw.push({ file: f, sha256: await sha256(dst), byte: statSync(dst).size, modificato_il: statSync(src).mtime.toISOString() })
    }
    writeFileSync(join(rawDir, 'SHA256SUMS.txt'), raw.map(r => `${r.sha256}  ${r.file}`).join('\n') + '\n')
    riepilogo.tabulati_grezzi = raw

    // --- legenda (file separato) ---------------------------------------------------
    const legendRows = Object.keys(PSEUDO).sort((a, b) => (PSEUDO[a] === 'GDO 115' ? -1 : PSEUDO[b] === 'GDO 115' ? 1 : PSEUDO[a].localeCompare(PSEUDO[b])))
    writeFileSync(join(OUT, 'F-legenda-pseudonimi.txt'),
        "LEGENDA PSEUDONIMI - documento riservato, NON inserire nella cartella condivisa ne' nella produzione in giudizio\r\n\r\n" +
        'Pseudonimo      Codice CRM   Interno centralino nella finestra 1/07-24/08/2026\r\n' +
        legendRows.map(n => `${PSEUDO[n].padEnd(15)} ${n.padEnd(12)} ${EXT_WINDOW[n] ?? 'n/d'}`).join('\r\n') + '\r\n\r\n' +
        'Esclusi dal confronto (motivo nel fascicolo, par. 4): GDO 201 (sistema automatico), GDO 116 (cessato 08/08/2026, attribuzione incompleta).\r\n' +
        "L'attribuzione interno -> persona non e' fissa nel software: viene ricavata dai dati (chi ha registrato gli esiti sui numeri chiamati da quell'interno) e riverificata a ogni importazione dei tabulati.\r\n")

    writeFileSync(join(OUT, 'riepilogo.json'), JSON.stringify(riepilogo, null, 2))
    console.log('OK ->', OUT)
    console.log(JSON.stringify({ squadra: teamRows.map(r => [r.operatore, r.esiti, r.chiamate, r.scoperti, r.pct_scoperti]), lead: riepilogo.lead, per_esito: perEsito, giorno_escluso: riepilogo.giorno_escluso, raw }, null, 1))
    await pool.end()
}
main().catch(e => { console.error(e); process.exit(1) })
