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
            router.refresh(); // Refresh SSR to pull new profiles
        } catch (e) {
            console.error(e);
            alert("Errore durante il salvataggio.");
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <div className="flex-1 space-y-6 p-4 lg:p-8 pt-6 pb-20 max-w-7xl mx-auto w-full">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-6">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight text-slate-900 flex items-center gap-3">
                        <Gamepad2 className="h-8 w-8 text-purple-600" />
                        Cruscotto GDO RPG
                    </h2>
                    <p className="text-slate-500 mt-1">Supervisione dei Livelli di Esperienza (XP), Avatar e Controllo Stipendi Base & Fenice Coins.</p>
                </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-slate-900 text-white">
                                <th className="p-4 font-semibold text-sm">GDO</th>
                                <th className="p-4 font-semibold text-sm text-center">Evolution Stage</th>
                                <th className="p-4 font-semibold text-sm text-center">XP</th>
                                <th className="p-4 font-semibold text-sm text-center">Bonus Correnti</th>
                                <th className="p-4 font-semibold text-sm text-right">Stipendio Mese Stimato</th>
                                <th className="p-4 font-semibold text-sm text-right">Fenice Coins</th>
                                <th className="p-4 font-semibold text-sm text-center">Azioni</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                            {initialProfiles.length === 0 && (
                                <tr>
                                    <td colSpan={7} className="p-8 text-center text-slate-500">Nessun GDO trovato.</td>
                                </tr>
                            )}
                            {initialProfiles.map(p => {
                                const xpPerc = Math.min((p.experience / p.targetXpForNext) * 100, 100);
                                const isWeekCompleted = p.weekState.currentPresences >= p.weekState.target1;

                                return (
                                    <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                                        <td className="p-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-full bg-slate-100 border-2 border-slate-300 flex items-center justify-center font-bold text-slate-600 shadow-sm shrink-0">
                                                    L{p.level}
                                                </div>
                                                <div>
                                                    <p className="font-bold text-slate-900">{p.displayName || `GDO ${p.gdoCode}`}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="p-4 text-center">
                                            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border shadow-sm ${p.stage.badgeClass}`}>
                                                {p.stage.name}
                                            </span>
                                        </td>
                                        <td className="p-4">
                                            <div className="flex flex-col gap-1 items-center">
                                                <span className="text-xs font-bold text-slate-600">{p.experience} / {p.targetXpForNext}</span>
                                                <div className="w-24 h-2 bg-slate-200 rounded-full overflow-hidden">
                                                    <div className="h-full bg-purple-500" style={{ width: `${xpPerc}%` }}></div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="p-4 text-center">
                                            {isWeekCompleted ? (
                                                <span className="inline-flex items-center gap-1 text-xs font-bold text-green-700 bg-green-100 px-2 py-1 rounded-full"><CheckCircle className="w-3 h-3" /> Vinto</span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1 text-xs font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded-full">{p.weekState.currentPresences} / {p.weekState.target1}</span>
                                            )}
                                        </td>
                                        <td className="p-4 text-right">
                                            <p className="font-bold text-slate-900 text-lg">€ {p.financials.expectedSalaryGross.toLocaleString('it-IT')}</p>
                                            <p className="text-xs text-slate-400">Base €{p.baseSalaryEur}</p>
                                        </td>
                                        <td className="p-4 text-right">
                                            <p className="font-bold text-yellow-600 text-lg flex items-center justify-end gap-1">
                                                {p.coins} <Coins className="w-4 h-4" />
                                            </p>
                                        </td>
                                        <td className="p-4 text-center">
                                            <div className="flex items-center justify-center gap-2">
                                                <button
                                                    onClick={() => openDialog(p.id, p.displayName || `GDO ${p.gdoCode}`, 'salary', p.baseSalaryEur)}
                                                    className="p-2 bg-white border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
                                                    title="Aggiorna Stipendio Base"
                                                >
                                                    <TrendingUp className="w-4 h-4" />
                                                </button>
                                                <button
                                                    onClick={() => openDialog(p.id, p.displayName || `GDO ${p.gdoCode}`, 'coins', p.coins)}
                                                    className="p-2 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-700 hover:bg-yellow-100 transition-colors"
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
                <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center">
                    <div className="bg-white p-6 rounded-2xl shadow-xl w-full max-w-sm border border-slate-200">
                        <div className="flex items-center gap-3 mb-4">
                            {dialogData.action === 'coins' ? <Coins className="w-6 h-6 text-yellow-500" /> : <TrendingUp className="w-6 h-6 text-slate-700" />}
                            <h3 className="text-lg font-bold text-slate-900">
                                {dialogData.action === 'coins' ? 'Invia Coins a' : 'Modifica Salario Base per'} {dialogData.gdoName}
                            </h3>
                        </div>

                        <div className="mb-6">
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                                {dialogData.action === 'coins' ? 'Quantità di Coins da Regalare (+)' : 'Nuovo Stipendio Lordo Mese (€)'}
                            </label>
                            <input
                                type="number"
                                className="w-full border-2 border-slate-200 focus:border-purple-500 rounded-xl px-4 py-3 font-bold text-slate-900 outline-none transition-all"
                                value={inputValue}
                                onChange={(e) => setInputValue(Number(e.target.value))}
                            />
                            {dialogData.action === 'coins' && <p className="text-xs text-slate-400 mt-2">I Coins saranno letteralmente sommati a quelli già posseduti ({dialogData.currentValue}).</p>}
                        </div>

                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={() => setDialogData(null)}
                                className="px-4 py-2 font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                            >
                                Annulla
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={isProcessing}
                                className={`px-4 py-2 font-bold text-white rounded-lg shadow-md transition-all ${dialogData.action === 'coins' ? 'bg-yellow-500 hover:bg-yellow-600' : 'bg-slate-900 hover:bg-slate-800'
                                    }`}
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
