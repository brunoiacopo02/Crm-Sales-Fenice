'use client';

import { useState, useEffect } from 'react';
import { Plus, UserPlus, Trophy, Target } from 'lucide-react';
import { addManualAdjustment, getGdoAndConfermeUsers } from '@/app/actions/manualAdjustmentActions';
import { useRouter } from 'next/navigation';

interface UserOption {
    id: string;
    name: string | null;
    displayName: string | null;
    role: string | null;
    gdoCode: number | null;
}

export function ManualAdjustmentPanel() {
    const [users, setUsers] = useState<UserOption[]>([]);
    const [selectedUserId, setSelectedUserId] = useState('');
    const [count, setCount] = useState(1);
    const [note, setNote] = useState('');
    const [loading, setLoading] = useState(false);
    const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
    const router = useRouter();

    useEffect(() => {
        getGdoAndConfermeUsers().then(setUsers).catch(console.error);
    }, []);

    const selectedUser = users.find(u => u.id === selectedUserId);
    const adjustmentType = selectedUser?.role === 'CONFERME' ? 'chiusure' : selectedUser?.role === 'VENDITORE' ? 'fatturato' : 'presenze';

    const handleSubmit = async () => {
        if (!selectedUserId || count < 1) return;
        setLoading(true);
        setFeedback(null);
        try {
            await addManualAdjustment(selectedUserId, adjustmentType, count, note || undefined);
            setFeedback({ ok: true, msg: `+${count} ${adjustmentType} aggiunto a ${selectedUser?.displayName || selectedUser?.name}` });
            setCount(1);
            setNote('');
            router.refresh();
        } catch (e: any) {
            setFeedback({ ok: false, msg: e.message || 'Errore' });
        } finally {
            setLoading(false);
        }
    };

    const gdoUsers = users.filter(u => u.role === 'GDO');
    const confermeUsers = users.filter(u => u.role === 'CONFERME');
    const venditoreUsers = users.filter(u => u.role === 'VENDITORE');

    return (
        <div className="bg-white border border-ash-200/60 rounded-xl p-5 shadow-soft">
            <div className="flex items-center gap-2 mb-4">
                <div className="p-2 rounded-xl bg-brand-orange-50 border border-brand-orange-200/60">
                    <UserPlus className="w-5 h-5 text-brand-orange-600" />
                </div>
                <div>
                    <h3 className="font-bold text-ash-800">Aggiustamenti Manuali</h3>
                    <div className="text-xs text-ash-500">Aggiungi presenze (GDO), chiusure (Conferme) o fatturato (Venditori)</div>
                </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
                <div className="sm:col-span-2">
                    <label className="text-xs font-semibold text-ash-600 uppercase mb-1 block">Operatore</label>
                    <select
                        value={selectedUserId}
                        onChange={e => setSelectedUserId(e.target.value)}
                        className="w-full border border-ash-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-orange/30 focus:border-brand-orange"
                    >
                        <option value="">Seleziona...</option>
                        <optgroup label="GDO (+ Presenze)">
                            {gdoUsers.map(u => (
                                <option key={u.id} value={u.id}>
                                    {u.displayName || u.name} {u.gdoCode ? `(${u.gdoCode})` : ''}
                                </option>
                            ))}
                        </optgroup>
                        <optgroup label="Conferme (+ Chiusure)">
                            {confermeUsers.map(u => (
                                <option key={u.id} value={u.id}>
                                    {u.displayName || u.name}
                                </option>
                            ))}
                        </optgroup>
                        <optgroup label="Venditori (+ Fatturato €)">
                            {venditoreUsers.map(u => (
                                <option key={u.id} value={u.id}>
                                    {u.displayName || u.name}
                                </option>
                            ))}
                        </optgroup>
                    </select>
                </div>

                <div>
                    <label className="text-xs font-semibold text-ash-600 uppercase mb-1 block">
                        {adjustmentType === 'fatturato' ? 'Importo €' : 'Quantità'} {selectedUser ? `(${adjustmentType})` : ''}
                    </label>
                    <input
                        type="number"
                        min={1}
                        max={adjustmentType === 'fatturato' ? 999999 : 50}
                        value={count}
                        onChange={e => setCount(parseInt(e.target.value) || 1)}
                        placeholder={adjustmentType === 'fatturato' ? 'es. 5000' : '1'}
                        className="w-full border border-ash-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-orange/30 focus:border-brand-orange"
                    />
                </div>

                <div>
                    <button
                        onClick={handleSubmit}
                        disabled={!selectedUserId || loading}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-brand-orange text-white font-bold text-sm hover:bg-brand-orange-hover transition-colors disabled:opacity-50"
                    >
                        <Plus className="w-4 h-4" />
                        {loading ? 'Aggiunta...' : 'Aggiungi'}
                    </button>
                </div>
            </div>

            {feedback && (
                <div className={`mt-3 text-sm font-medium px-3 py-2 rounded-lg ${feedback.ok ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                    {feedback.msg}
                </div>
            )}
        </div>
    );
}
