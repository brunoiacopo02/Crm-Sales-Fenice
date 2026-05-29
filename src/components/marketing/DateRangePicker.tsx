'use client'

import { useState, useRef, useEffect } from 'react'
import { Calendar, ChevronDown } from 'lucide-react'

export interface DateRange {
  from: string
  to: string
  label: string
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function daysAgo(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

function startOfMonth() {
  const d = new Date()
  d.setDate(1)
  return d.toISOString().slice(0, 10)
}

function startOfLastMonth() {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - 1)
  return d.toISOString().slice(0, 10)
}

function endOfLastMonth() {
  const d = new Date()
  d.setDate(0)
  return d.toISOString().slice(0, 10)
}

const PRESETS: { label: string; range: () => DateRange }[] = [
  { label: 'Oggi', range: () => ({ from: today(), to: today(), label: 'Oggi' }) },
  { label: 'Ieri', range: () => ({ from: daysAgo(1), to: daysAgo(1), label: 'Ieri' }) },
  {
    label: 'Ultimi 7 giorni',
    range: () => ({ from: daysAgo(6), to: today(), label: 'Ultimi 7 giorni' }),
  },
  {
    label: 'Ultimi 14 giorni',
    range: () => ({ from: daysAgo(13), to: today(), label: 'Ultimi 14 giorni' }),
  },
  {
    label: 'Ultimi 30 giorni',
    range: () => ({ from: daysAgo(29), to: today(), label: 'Ultimi 30 giorni' }),
  },
  {
    label: 'Questo mese',
    range: () => ({ from: startOfMonth(), to: today(), label: 'Questo mese' }),
  },
  {
    label: 'Mese scorso',
    range: () => ({ from: startOfLastMonth(), to: endOfLastMonth(), label: 'Mese scorso' }),
  },
]

interface Props {
  value: DateRange
  onChange: (range: DateRange) => void
}

export default function DateRangePicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [customFrom, setCustomFrom] = useState(value.from)
  const [customTo, setCustomTo] = useState(value.to)
  const [showCustom, setShowCustom] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function selectPreset(preset: (typeof PRESETS)[0]) {
    const range = preset.range()
    setShowCustom(false)
    onChange(range)
    setOpen(false)
  }

  function applyCustom() {
    if (!customFrom || !customTo) return
    onChange({ from: customFrom, to: customTo, label: `${customFrom} → ${customTo}` })
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} className="btn">
        <Calendar size={14} style={{ color: 'var(--accent)' }} />
        <span>{value.label}</span>
        <ChevronDown
          size={12}
          className={`transition-transform ${open ? 'rotate-180' : ''}`}
          style={{ color: 'var(--muted)' }}
        />
      </button>

      {open && (
        <div
          className="absolute top-full mt-1 left-0 z-50 card min-w-52 py-1"
          style={{ boxShadow: 'var(--shadow-md)' }}
        >
          {PRESETS.map((preset) => {
            const isActive = value.label === preset.label
            return (
              <button
                key={preset.label}
                onClick={() => selectPreset(preset)}
                className="w-full text-left px-4 py-2 text-sm transition-colors"
                style={{
                  color: isActive ? 'var(--accent-text)' : 'var(--text)',
                  fontWeight: isActive ? 500 : 400,
                  background: 'transparent',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--s2)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                {preset.label}
              </button>
            )
          })}
          <div style={{ borderTop: '1px solid var(--border-soft)', marginTop: 4, paddingTop: 4 }}>
            <button
              onClick={() => setShowCustom(!showCustom)}
              className="w-full text-left px-4 py-2 text-sm transition-colors"
              style={{
                color: showCustom ? 'var(--accent-text)' : 'var(--text)',
                fontWeight: showCustom ? 500 : 400,
                background: 'transparent',
              }}
            >
              Personalizzato
            </button>
            {showCustom && (
              <div className="px-4 pb-3 space-y-2">
                <div className="flex gap-2 items-center">
                  <input
                    type="date"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    className="input flex-1"
                    style={{ padding: '.35rem .5rem', fontSize: '.75rem' }}
                  />
                  <span className="text-xs" style={{ color: 'var(--faint)' }}>
                    →
                  </span>
                  <input
                    type="date"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                    className="input flex-1"
                    style={{ padding: '.35rem .5rem', fontSize: '.75rem' }}
                  />
                </div>
                <button onClick={applyCustom} className="btn btn-primary btn-sm w-full justify-center">
                  Applica
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
