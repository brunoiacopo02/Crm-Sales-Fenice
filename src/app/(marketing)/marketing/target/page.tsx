'use client'

import { useState, useEffect } from 'react'
import { Target as TargetIcon, Save, CheckCircle2 } from 'lucide-react'
import { SingleCompanyGuard } from '@/components/marketing/SingleCompanyRequired'

interface Targets {
  aov: number
  cac: number
  cost_app: number
  cost_conf: number
  lead_target_total: number
  lead_target_telegram: number
  lead_target_corso10ore: number
  lead_target_jobsimulator: number
  roas_target: number
  updated_at: string
}

type EditableFields = Omit<Targets, 'updated_at'>

type FieldDef = {
  key: keyof EditableFields
  label: string
  hint: string
  suffix?: string
  step?: string
  min?: number
}

const MONEY_FIELDS: FieldDef[] = [
  { key: 'aov', label: 'AOV (Average Order Value)', hint: 'Valore medio di un contratto', suffix: '€' },
  { key: 'cac', label: 'CAC (Customer Acquisition Cost)', hint: 'Costo target per acquisire un cliente', suffix: '€' },
  { key: 'cost_app', label: 'Costo Appuntamento', hint: 'Costo target per appuntamento fissato', suffix: '€' },
  { key: 'cost_conf', label: 'Costo Conferma', hint: 'Costo target per conferma', suffix: '€' },
]

const ALERT_FIELDS: FieldDef[] = [
  { key: 'lead_target_total', label: 'Lead Target — Totale (mensile)', hint: 'Numero di lead attesi nel mese complessivo', step: '1', min: 0 },
  { key: 'lead_target_telegram', label: 'Lead Target — Telegram (mensile)', hint: 'Funnel Telegram', step: '1', min: 0 },
  { key: 'lead_target_corso10ore', label: 'Lead Target — Corso 10 Ore (mensile)', hint: 'Funnel Corso 10 Ore', step: '1', min: 0 },
  { key: 'lead_target_jobsimulator', label: 'Lead Target — Job Simulator (mensile)', hint: 'Funnel Job Simulator', step: '1', min: 0 },
  { key: 'roas_target', label: 'ROAS Target', hint: 'ROAS target complessivo (es. 3.0 = 3x)', step: '0.01', min: 0, suffix: 'x' },
]

export default function TargetPage() {
  const [initial, setInitial] = useState<Targets | null>(null)
  const [form, setForm] = useState<EditableFields | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/marketing/targets')
      .then((r) => r.json())
      .then((data: Targets) => {
        setInitial(data)
        setForm({
          aov: data.aov,
          cac: data.cac,
          cost_app: data.cost_app,
          cost_conf: data.cost_conf,
          lead_target_total: data.lead_target_total,
          lead_target_telegram: data.lead_target_telegram,
          lead_target_corso10ore: data.lead_target_corso10ore,
          lead_target_jobsimulator: data.lead_target_jobsimulator,
          roas_target: data.roas_target,
        })
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  const dirty =
    form !== null && initial !== null &&
    (Object.keys(form) as (keyof EditableFields)[]).some((k) => form[k] !== initial[k])

  async function handleSave() {
    if (!form) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/marketing/targets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? `HTTP ${res.status}`)
      }
      const data: Targets = await res.json()
      setInitial(data)
      setForm({
        aov: data.aov, cac: data.cac, cost_app: data.cost_app, cost_conf: data.cost_conf,
        lead_target_total: data.lead_target_total, lead_target_telegram: data.lead_target_telegram,
        lead_target_corso10ore: data.lead_target_corso10ore, lead_target_jobsimulator: data.lead_target_jobsimulator,
        roas_target: data.roas_target,
      })
      setSavedAt(Date.now())
      setTimeout(() => setSavedAt(null), 2500)
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  if (loading || !form) {
    return (
      <div className="p-6"><div style={{ color: 'var(--faint)' }}>Caricamento...</div></div>
    )
  }

  function renderField(f: FieldDef) {
    return (
      <div key={f.key}>
        <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text)' }}>
          {f.label}
        </label>
        <div className="relative">
          <input
            type="number"
            min={f.min ?? 0}
            step={f.step ?? '0.01'}
            value={form![f.key]}
            onChange={(e) => setForm({ ...form!, [f.key]: Number(e.target.value) })}
            className="w-full px-3 py-2 pr-8 rounded-md border"
            style={{ background: 'var(--surface)', borderColor: 'var(--border-soft)', color: 'var(--text)' }}
          />
          {f.suffix && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: 'var(--faint)' }}>
              {f.suffix}
            </span>
          )}
        </div>
        <div className="text-xs mt-1" style={{ color: 'var(--faint)' }}>{f.hint}</div>
      </div>
    )
  }

  return (
    <SingleCompanyGuard>
      <div className="p-6 max-w-2xl">
        <div className="page-header mb-6">
          <div className="flex items-center gap-2">
            <TargetIcon size={20} style={{ color: 'var(--accent)' }} />
            <h1 className="page-title">Target</h1>
          </div>
          <p className="page-sub">Target globali per ROAS, analytics e alert.</p>
        </div>

        <div className="card p-6">
          <div className="grid gap-5">{MONEY_FIELDS.map(renderField)}</div>

          <div className="mt-8 pt-6" style={{ borderTop: '1px solid var(--border-soft)' }}>
            <div className="mb-4">
              <h2 className="text-base font-semibold" style={{ color: 'var(--text)' }}>Alert & Performance</h2>
              <p className="text-xs mt-1" style={{ color: 'var(--faint)' }}>
                Target mensili per gli alert lead e ROAS.
              </p>
            </div>
            <div className="grid gap-5">{ALERT_FIELDS.map(renderField)}</div>
          </div>

          {error && <div className="alert alert-error mt-4">{error}</div>}

          <div className="flex items-center justify-between mt-6 pt-4" style={{ borderTop: '1px solid var(--border-soft)' }}>
            <div className="text-xs" style={{ color: 'var(--faint)' }}>
              {initial && `Ultimo aggiornamento: ${new Date(initial.updated_at).toLocaleString('it-IT')}`}
            </div>
            <div className="flex items-center gap-3">
              {savedAt && (
                <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--ok)' }}>
                  <CheckCircle2 size={14} /> Salvato
                </span>
              )}
              <button onClick={handleSave} disabled={!dirty || saving} className="btn btn-primary">
                <Save size={14} />
                {saving ? 'Salvataggio...' : 'Salva'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </SingleCompanyGuard>
  )
}
