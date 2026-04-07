'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { updateGdoBaseSalary, addGdoCoins } from '@/app/actions/managerRpgActions';
import { Gamepad2, Coins, TrendingUp, UserCog, CheckCircle } from 'lucide-react';

interface Props {
    initialProfiles: any[];
}

export default function ManagerRpgClient({ initialProfiles }: Props) {
    const router = useRouter();
    const [profiles, setProfiles] = useState(initialProfiles);
    const [isProcessing, setIsProcessing] = useState(false);

    // Modal state
    const [dialogData, setDialogData] = useState<{ userId: string, gdoName: string, action: 'salary' | 'coins', currentValue: number } | null>(null);
    const [inputValue, setInputValue] = useState(0);

    const openDialog = (userId: string, gdoName: string, action: 'salary' | 'coins', currentValue: number) => {
        setDialogData({ userId, gdoName, action, currentValue });
        setInputValue(action === 'salary' ? currentValue : 0);
    };

    const handleSave = async () => {
        if (!dialogData) return;
        setIsProcessing(true);

        try {
            if (dialogData.action === 'salary') {
                await updateGdoBaseSalary(dialogData.userId, inputValue);
            } else if (dialogData.action === 'coins') {
                await addGdoCoins(dialogData.userId, inputValue);
            }

            setDialogData(null);
            router.refresh();
        } catch (e) {
            console.error(e);
            alert("Errore durante il salvataggio.");
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <div className="flex-1 space-y-6 p-4 lg:p-8 pt-6 pb-20 max-w-7xl mx-auto w-full animate-fade-in">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-ash-200/60 pb-6">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight text-ash-800 flex items-center gap-3">
                        <Gamepad2 className="h-8 w-8 text-brand-orange" />
                        Cruscotto GDO RPG
                    </h2>
                    <div className="text-ash-500 mt-1">Supervisione dei Livelli di Esperienza (XP), Avatar e Controllo Stipendi Base & Fenice Coins.</div>
                </div>
            </div>

            <div className="bg-white rounded-xl shadow-soft border border-ash-200/60 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-gradient-to-r from-brand-charcoal to-ash-800 text-white">
                                <th className="p-4 font-semibold text-sm">GDO</th>
                                <th className="p-4 font-semibold text-sm text-center">Evolution Stage</th>
                                <th className="p-4 font-semibold text-sm text-center">XP</th>
                                <th className="p-4 font-semibold text-sm text-center">Bonus Correnti</th>
                                <th className="p-4 font-semibold text-sm text-right">Stipendio Mese Stimato</th>
                                <th className="p-4 font-semibold text-sm text-right">Fenice Coins</th>
                                <th className="p-4 font-semibold text-sm text-center">Azioni</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-ash-200/60">
                            {initialProfiles.length === 0 && (
                                <tr>
                                    <td colSpan={7} className="p-8 text-center text-ash-400">Nessun GDO trovato.</td>
                                </tr>
                            )}
                            {initialProfiles.map((p, idx) => {
                                const xpPerc = Math.min((p.experience / p.targetXpForNext) * 100, 100);
                                const isWeekCompleted = p.weekState.currentPresences >= p.weekState.target1;

                                return (
                                    <tr
                                        key={p.id}
                                        className="hover:bg-brand-orange-50/20 transition-all duration-200 animate-fade-in"
                                        style={{ animationDelay: `${Math.min(idx * 50, 400)}ms`, animationFillMode: 'backwards' }}
                                    >
                                        <td className="p-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-ash-100 to-ash-200 border border-ash-300 flex items-center justify-center font-bold text-ash-600 shadow-soft shrink-0">
                                                    L{p.level}
                                                </div>
                                                <div>
                                                    <div className="font-bold text-ash-800">{p.displayName || `GDO ${p.gdoCode}`}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="p-4 text-center">
                                            <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border shadow-soft ${p.stage.badgeClass}`}>
                                                {p.stage.name}
                                            </div>
                                        </td>
                                        <td className="p-4">
                                            <div className="flex flex-col gap-1 items-center">
                                                <div className="text-xs font-bold text-ash-600">{p.experience} / {p.targetXpForNext}</div>
                                                <div className="w-24 h-2.5 bg-ash-100 rounded-full overflow-hidden">
                                                    <div className="h-full bg-gradient-to-r from-brand-orange to-brand-orange-600 rounded-full transition-[width] duration-700" style={{ width: `${xpPerc}%` }}></div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="p-4 text-center">
                                            {isWeekCompleted ? (
                                                <div className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200/50"><CheckCircle className="w-3 h-3" /> Vinto</div>
                                            ) : (
                                                <div className="inline-flex items-center gap-1 text-xs font-bold text-ash-500 bg-ash-100 px-2.5 py-1 rounded-full">{p.weekState.currentPresences} / {p.weekState.target1}</div>
                                            )}
                                        </td>
                                        <td className="p-4 text-right">
                                            <div className="font-bold text-ash-800 text-lg">€ {p.financials.expectedSalaryGross.toLocaleString('it-IT')}</div>
                                            <div className="text-xs text-ash-400">Base €{p.baseSalaryEur}</div>
                                        </td>
                                        <td className="p-4 text-right">
                                            <div className="font-bold text-gold-600 text-lg flex items-center justify-end gap-1">
                                                {p.coins} <Coins className="w-4 h-4" />
                                            </div>
                                        </td>
                                        <td className="p-4 text-center">
                                            <div className="flex items-center justify-center gap-2">
                                                <button
                                                    onClick={() => openDialog(p.id, p.displayName || `GDO ${p.gdoCode}`, 'salary', p.baseSalaryEur)}
                                                    className="p-2 bg-white border border-ash-200/60 rounded-lg text-ash-600 hover:bg-ash-100 hover:text-ash-800 transition-all shadow-soft hover:shadow-card"
                                                    title="Aggiorna Stipendio Base"
                                                >
                                                    <TrendingUp className="w-4 h-4" />
                                                </button>
                                                <button
                                                    onClick={() => openDialog(p.id, p.displayName || `GDO ${p.gdoCode}`, 'coins', p.coins)}
                                                    className="p-2 bg-gold-50 border border-gold-200/60 rounded-lg text-gold-700 hover:bg-gold-100 transition-all shadow-soft hover:shadow-card"
                                                    title="Invia Fenice Coins Extra"
                                                >
                                                    <Coins className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {dialogData && (
                <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center animate-fade-in">
                    <div className="bg-white p-6 rounded-2xl shadow-elevated w-full max-w-sm border border-ash-200/60">
                        <div className="flex items-center gap-3 mb-4">
                            {dialogData.action === 'coins' ? <Coins className="w-6 h-6 text-gold-500" /> : <TrendingUp className="w-6 h-6 text-ash-700" />}
                            <h3 className="text-lg font-bold text-ash-800">
                                {dialogData.action === 'coins' ? 'Invia Coins a' : 'Modifica Salario Base per'} {dialogData.gdoName}
                            </h3>
                        </div>

                        <div className="mb-6">
                            <label className="block text-xs font-semibold text-ash-500 uppercase tracking-wide mb-2">
                                {dialogData.action === 'coins' ? 'Quantità di Coins da Regalare (+)' : 'Nuovo Stipendio Lordo Mese (€)'}
                            </label>
                            <input
                                type="number"
                                className="w-full border-2 border-ash-200 focus:border-brand-orange rounded-xl px-4 py-3 font-bold text-ash-800 outline-none transition-all"
                                value={inputValue}
                                onChange={(e) => setInputValue(Number(e.target.value))}
                            />
                            {dialogData.action === 'coins' && <div className="text-xs text-ash-400 mt-2">I Coins saranno letteralmente sommati a quelli già posseduti ({dialogData.currentValue}).</div>}
                        </div>

                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={() => setDialogData(null)}
                                className="btn-ghost px-4 py-2"
                            >
                                Annulla
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={isProcessing}
                                className={`px-4 py-2 font-bold text-white rounded-lg shadow-card transition-all ${dialogData.action === 'coins' ? 'bg-gradient-to-r from-gold-400 to-gold-500 hover:from-gold-500 hover:to-gold-600' : 'bg-brand-charcoal hover:bg-ash-800'
                                    } disabled:opacity-50`}
                            >
                                {isProcessing ? 'Salvataggio...' : 'Conferma'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
