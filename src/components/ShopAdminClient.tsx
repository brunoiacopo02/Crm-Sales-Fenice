"use client"

import { useState, useEffect } from "react"
import { getAdminShopItems, createShopItem, updateShopItem, toggleShopItemStatus } from "@/app/actions/shopActions"
import { Plus, Edit2, CheckCircle2, XCircle, Store } from "lucide-react"

export function ShopAdminClient() {
    const [items, setItems] = useState<any[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [isFormOpen, setIsFormOpen] = useState(false)
    const [editingId, setEditingId] = useState<string | null>(null)

    // Form state
    const [name, setName] = useState("")
    const [description, setDescription] = useState("")
    const [cost, setCost] = useState(1)
    const [cssValue, setCssValue] = useState("")

    useEffect(() => {
        const loadItems = async () => {
            const data = await getAdminShopItems()
            setItems(data)
            setIsLoading(false)
        }
        loadItems()
    }, [])

    const handleOpenCreate = () => {
        setEditingId(null)
        setName("")
        setDescription("")
        setCost(1)
        setCssValue("")
        setIsFormOpen(true)
    }

    const handleOpenEdit = (item: any) => {
        setEditingId(item.id)
        setName(item.name)
        setDescription(item.description)
        setCost(item.cost)
        setCssValue(item.cssValue)
        setIsFormOpen(true)
    }

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault()
        const data = { name, description, cost, cssValue }

        try {
            if (editingId) {
                await updateShopItem(editingId, data)
            } else {
                await createShopItem(data)
            }
            const updated = await getAdminShopItems()
            setItems(updated)
            setIsFormOpen(false)
        } catch (error) {
            console.error(error)
            alert("Errore nel salvataggio")
        }
    }

    const handleToggleStatus = async (item: any) => {
        try {
            await toggleShopItemStatus(item.id, item.isActive)
            setItems(items.map(i => i.id === item.id ? { ...i, isActive: !item.isActive } : i))
        } catch (error) {
            console.error(error)
        }
    }

    if (isLoading) return <div className="animate-pulse bg-white h-64 rounded-xl border border-ash-100" />

    return (
        <div className="bg-white rounded-xl shadow-sm border border-ash-200 overflow-hidden">
            <div className="p-6 border-b border-ash-100 flex items-center justify-between bg-ash-50/50">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-brand-orange/10 text-brand-orange rounded-lg">
                        <Store className="h-5 w-5" />
                    </div>
                    <div>
                        <h2 className="font-semibold text-ash-800">Catalogo Fenice Store</h2>
                        <p className="text-sm text-ash-500">Gestisci le personalizzazioni acquistabili dai GDO.</p>
                    </div>
                </div>
                <button
                    onClick={handleOpenCreate}
                    className="bg-brand-orange hover:bg-orange-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 shadow-sm"
                >
                    <Plus className="h-4 w-4" />
                    Nuovo Elemento
                </button>
            </div>

            {isFormOpen && (
                <div className="p-6 bg-ash-50 border-b border-ash-200">
                    <form onSubmit={handleSave} className="max-w-3xl border border-ash-200 rounded-xl p-5 bg-white shadow-sm">
                        <h3 className="text-sm font-bold text-ash-800 mb-4">{editingId ? "Modifica Elemento" : "Aggiungi al Catalogo"}</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                            <div>
                                <label className="block text-xs font-semibold text-ash-700 mb-1">Nome Oggetto (Skin/Badge)</label>
                                <input required type="text" value={name} onChange={e => setName(e.target.value)} className="w-full text-sm border-ash-300 rounded-md shadow-sm focus:ring-brand-orange focus:border-brand-orange" placeholder="Es. Bordo Dorato Premium" />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-ash-700 mb-1">Costo (Fenice Coin)</label>
                                <input required type="number" min="0" value={cost} onChange={e => setCost(Number(e.target.value))} className="w-full text-sm border-ash-300 rounded-md shadow-sm focus:ring-brand-orange focus:border-brand-orange" />
                            </div>
                            <div className="md:col-span-2">
                                <label className="block text-xs font-semibold text-ash-700 mb-1">Descrizione</label>
                                <input required type="text" value={description} onChange={e => setDescription(e.target.value)} className="w-full text-sm border-ash-300 rounded-md shadow-sm focus:ring-brand-orange focus:border-brand-orange" placeholder="Es. Un bordo luccicante per i migliori GDO." />
                            </div>
                            <div className="md:col-span-2">
                                <label className="block text-xs font-semibold text-ash-700 mb-1">Valore CSS / Classi Tailwind</label>
                                <input required type="text" value={cssValue} onChange={e => setCssValue(e.target.value)} className="w-full text-sm font-mono border-ash-300 rounded-md shadow-sm focus:ring-brand-orange focus:border-brand-orange" placeholder="Es. ring-2 ring-yellow-400 border-yellow-200" />
                                <p className="text-[10px] text-ash-500 mt-1">Queste classi saranno applicate all'avatar dell'utente nella Topbar e nella Classifica.</p>
                            </div>
                        </div>
                        <div className="flex justify-end gap-3 mt-4 border-t border-ash-100 pt-4">
                            <button type="button" onClick={() => setIsFormOpen(false)} className="px-4 py-2 text-sm text-ash-600 hover:bg-ash-100 rounded-lg transition-colors font-medium">Annulla</button>
                            <button type="submit" className="bg-ash-900 hover:bg-black text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm">{editingId ? "Aggiorna" : "Salva"}</button>
                        </div>
                    </form>
                </div>
            )}

            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-ash-200">
                    <thead className="bg-white">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-semibold text-ash-500 uppercase tracking-wider">Oggetto</th>
                            <th className="px-6 py-3 text-left text-xs font-semibold text-ash-500 uppercase tracking-wider">Classi CSS</th>
                            <th className="px-6 py-3 text-left text-xs font-semibold text-ash-500 uppercase tracking-wider">Costo</th>
                            <th className="px-6 py-3 text-left text-xs font-semibold text-ash-500 uppercase tracking-wider">Stato</th>
                            <th className="px-6 py-3 text-right text-xs font-semibold text-ash-500 uppercase tracking-wider">Azioni</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-ash-100">
                        {items.length === 0 ? (
                            <tr>
                                <td colSpan={5} className="px-6 py-8 text-center text-sm text-ash-500">Nessun oggetto nello store. Creane uno per iniziare.</td>
                            </tr>
                        ) : (
                            items.map(item => (
                                <tr key={item.id} className="hover:bg-ash-50 transition-colors">
                                    <td className="px-6 py-4">
                                        <div className="flex flex-col">
                                            <span className="text-sm font-semibold text-ash-900">{item.name}</span>
                                            <span className="text-xs text-ash-500 mt-0.5 max-w-xs truncate">{item.description}</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-3">
                                            {item.cssValue?.includes('skin-theme') ? (
                                                <div className={`h-8 w-12 rounded bg-ash-200 shrink-0 shadow-inner ${item.cssValue}`} style={{ backgroundAttachment: 'scroll' }} title="Preview"></div>
                                            ) : (
                                                <div className={`h-8 w-8 rounded-full bg-ash-200 shrink-0 text-transparent flex items-center justify-center ${item.cssValue}`} title="Preview"></div>
                                            )}
                                            <span className="font-mono text-[10px] text-ash-500 bg-ash-100 px-2 py-1 rounded w-32 truncate">{item.cssValue}</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-1.5 font-bold text-gold-600 bg-gold-50 px-2.5 py-1 rounded-full text-xs w-max border border-gold-200">
                                            <span>{item.cost}</span>
                                            <span>Coin</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <button
                                            onClick={() => handleToggleStatus(item)}
                                            className="flex items-center gap-1.5 focus:outline-none"
                                        >
                                            {item.isActive ? (
                                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 hover:bg-green-200 transition-colors">
                                                    <CheckCircle2 className="h-3 w-3" /> Attivo
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-ash-100 text-ash-600 hover:bg-ash-200 transition-colors">
                                                    <XCircle className="h-3 w-3" /> Nascosto
                                                </span>
                                            )}
                                        </button>
                                    </td>
                                    <td className="px-6 py-4 text-right text-sm font-medium">
                                        <button onClick={() => handleOpenEdit(item)} className="text-brand-orange hover:text-orange-900 transition-colors p-2 hover:bg-orange-50 rounded-lg">
                                            <Edit2 className="h-4 w-4" />
                                        </button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    )
}
