"use client"

// Time pickers for outcome scheduling.
// AppointmentDateTimePicker: only whole hours 10:00 → 21:00
// RecallDateTimePicker: hours + minutes in 5-minute increments

function getTodayStr() {
    const d = new Date()
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

function parseValue(value: string): { date: string; hour: string; minute: string } {
    if (!value) return { date: getTodayStr(), hour: '', minute: '00' }
    const [datePart, timePart] = value.split('T')
    const [h, m] = (timePart || '').split(':')
    return { date: datePart || getTodayStr(), hour: h || '', minute: m || '00' }
}

function buildValue(date: string, hour: string, minute: string): string {
    if (!date || !hour) return ''
    return `${date}T${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
}

const APPT_HOURS = ['09', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21']
const RECALL_HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const FIVE_MIN_STEPS = ['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55']

export function AppointmentDateTimePicker({ value, onChange, compact = false }: { value: string; onChange: (v: string) => void; compact?: boolean }) {
    const { date, hour } = parseValue(value)
    const inputClass = compact ? "input-fenice !text-xs !py-2 !px-2.5" : "input-fenice text-sm"

    return (
        <div className="grid grid-cols-2 gap-2">
            <input
                type="date"
                value={date}
                min={getTodayStr()}
                onChange={(e) => onChange(buildValue(e.target.value, hour || '09', '00'))}
                className={inputClass}
                required
            />
            <select
                value={hour}
                onChange={(e) => onChange(buildValue(date || getTodayStr(), e.target.value, '00'))}
                className={inputClass}
                required
            >
                <option value="" disabled>Ora</option>
                {APPT_HOURS.map(h => (
                    <option key={h} value={h}>{h}:00</option>
                ))}
            </select>
        </div>
    )
}

export function RecallDateTimePicker({ value, onChange, compact = false }: { value: string; onChange: (v: string) => void; compact?: boolean }) {
    const { date, hour, minute } = parseValue(value)
    const inputClass = compact ? "input-fenice !text-xs !py-2 !px-2.5" : "input-fenice text-sm"

    return (
        <div className="grid grid-cols-3 gap-2">
            <input
                type="date"
                value={date}
                min={getTodayStr()}
                onChange={(e) => onChange(buildValue(e.target.value, hour || '09', minute || '00'))}
                className={inputClass}
                required
            />
            <select
                value={hour}
                onChange={(e) => onChange(buildValue(date || getTodayStr(), e.target.value, minute || '00'))}
                className={inputClass}
                required
            >
                <option value="" disabled>Ora</option>
                {RECALL_HOURS.map(h => (
                    <option key={h} value={h}>{h}</option>
                ))}
            </select>
            <select
                value={minute}
                onChange={(e) => onChange(buildValue(date || getTodayStr(), hour || '09', e.target.value))}
                className={inputClass}
            >
                {FIVE_MIN_STEPS.map(m => (
                    <option key={m} value={m}>{m}</option>
                ))}
            </select>
        </div>
    )
}
