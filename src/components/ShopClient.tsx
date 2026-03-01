"use client"
import { useAuth } from "@/components/AuthProvider"

import { useState, useEffect } from "react"
import { getActiveShopItems, getUserInventory, buyShopItem, equipShopItem, unequipShopItem } from "@/app/actions/shopActions"
import { getUserWalletCoins } from "@/app/actions/sprintActions"
import { ShoppingBag, Box, CheckCircle2, Lock } from "lucide-react"
export function ShopClient({ userId }: { userId: string }) {
    // Removed useSession hooks
    const [activeTab, setActiveTab] = useState<'shop' | 'inventory'>('shop')
    const [items, setItems] = useState<any[]>([])
    const [inventory, setInventory] = useState<any[]>([])
    const [wallet, setWallet] = useState(0)
    const [isLoading, setIsLoading] = useState(true)
    const [equippedId, setEquippedId] = useState<string | null>(null)
    const [processingId, setProcessingId] = useState<string | null>(null)

    // Load Data
    const loadData = async () => {
        setIsLoading(true)
        try {
            const [shopData, invData, coins] = await Promise.all([
                getActiveShopItems(),
                getUserInventory(userId),
                getUserWalletCoins(userId) // Note: Need a simple way to fetch user's currently equipped too later, or relying on auth session
            ])
            setItems(shopData)
            setInventory(invData)
            setWallet(coins)
        } catch (e) {
            console.error(e)
        }
        setIsLoading(false)
    }

    // Since we don't have a direct fetcher for "equippedItemId" easily exposed yet, let's fetch it via a generic call or session. 
    // For now we will assume the session doesn't hold it until next step, 
    // actually let's fetch it dynamically.
    useEffect(() => {
        loadData()

        // Fetch equipped item inline to decouple from session delays
        fetch('/api/user/profile').then(res => res.json()).then(data => {
            // we don't have this API. We will fetch it from a new server action later.
        }).catch(() => { })

    }, [userId])

    useEffect(() => {
        // Just a workaround: fetch equipped string from a server action. 
        // We will add getEquippedSkinCss in shopActions or similar. 
        import('@/app/actions/shopActions').then(({ getEquippedSkinCss }) => {
            getEquippedSkinCss(userId).then(css => {
                // If we need the ID instead of CSS, we might need a getEquippedItem(userId)
            })
        })
    }, [userId])

    const handleBuy = async (item: any) => {
        if (wallet < item.cost) {
            alert("Coin insufficienti!")
            return
        }
        setProcessingId(item.id)
        try {
            await buyShopItem(userId, item.id)
            await loadData() // Refresh coin balance and inventory
            alert(`Acquisto completato! Hai sbloccato: ${item.name}`)
        } catch (e: any) {
            alert(e.message)
        }
        setProcessingId(null)
    }

    const handleEquip = async (item: any) => {
        setProcessingId(item.id)
        try {
            await equipShopItem(userId, item.id)
            setEquippedId(item.id)
            // Reload page to reflect CSS globally on layout if we rely on server fetches!
            window.location.reload()
        } catch (e: any) {
            alert(e.message)
        }
        setProcessingId(null)
    }

    const handleUnequip = async (item: any) => {
        setProcessingId(item.id)
        try {
            await unequipShopItem(userId)
            setEquippedId(null)
            window.location.reload()
        } catch (e: any) {
            alert(e.message)
        }
        setProcessingId(null)
    }

    if (isLoading) return <div className="h-64 animate-pulse bg-white rounded-xl border border-gray-100" />

    const myItemIds = new Set(inventory.map(i => i.id))

    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            {/* Header / Tabs */}
            <div className="border-b border-gray-200 bg-gray-50 flex items-center justify-between px-6">
                <div className="flex items-center gap-6">
                    <button
                        onClick={() => setActiveTab('shop')}
                        className={`py-4 font-medium text-sm flex items-center gap-2 border-b-2 transition-colors ${activeTab === 'shop' ? 'border-brand-orange text-brand-orange' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
                    >
                        <ShoppingBag className="h-4 w-4" /> Vetrina
                    </button>
                    <button
                        onClick={() => setActiveTab('inventory')}
                        className={`py-4 font-medium text-sm flex items-center gap-2 border-b-2 transition-colors ${activeTab === 'inventory' ? 'border-brand-orange text-brand-orange' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
                    >
                        <Box className="h-4 w-4" /> Il mio Inventario
                    </button>
                </div>

                {/* Coin Balance Badge */}
                <div className="flex items-center gap-2 bg-gradient-to-tr from-yellow-100 to-yellow-50 border border-yellow-200 px-4 py-2 rounded-full shadow-sm">
                    <img src="/assets/store/icon_fenice_coin.png" alt="Fenice Coin" className="w-5 h-5 object-contain drop-shadow-sm" />
                    <span className="text-sm font-bold text-yellow-800">Saldo: {wallet} Coin</span>
                </div>
            </div>

            {/* Content Body */}
            <div className="p-6 bg-gray-50/30 min-h-[400px]">
                {activeTab === 'shop' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                        {items.length === 0 ? (
                            <div className="col-span-full py-12 text-center text-gray-400">Nessun oggetto disponibile nello store.</div>
                        ) : (
                            items.map(item => {
                                const isOwned = myItemIds.has(item.id)
                                const canAfford = wallet >= item.cost

                                return (
                                    <div key={item.id} className="bg-white border text-center border-gray-200 rounded-xl overflow-hidden shadow-sm hover:shadow transition-shadow group">
                                        <div className="h-32 bg-gray-50 border-b border-gray-100 flex items-center justify-center p-6 relative overflow-hidden">
                                            {/* Preview Placeholder */}
                                            <div className="absolute inset-0 opacity-10 bg-stripes pointer-events-none" />
                                            {item.cssValue.includes('skin-theme') ? (
                                                <div className={`h-20 w-full max-w-[8rem] shadow-md rounded-lg relative z-10 ${item.cssValue} !bg-local`} style={{ backgroundAttachment: 'scroll' }} />
                                            ) : (
                                                <div className={`h-16 w-16 bg-white shadow-md rounded-full relative z-10 flex items-center justify-center text-transparent ${item.cssValue}`} />
                                            )}
                                            {isOwned && (
                                                <div className="absolute top-2 right-2 bg-green-100 text-green-700 p-1.5 rounded-full shadow-sm">
                                                    <CheckCircle2 className="h-4 w-4" />
                                                </div>
                                            )}
                                        </div>
                                        <div className="p-5">
                                            <h3 className="font-bold text-gray-900 mb-1">{item.name}</h3>
                                            <p className="text-xs text-gray-500 line-clamp-2 h-8">{item.description}</p>

                                            <div className="mt-5">
                                                {isOwned ? (
                                                    <button disabled className="w-full bg-gray-100 text-gray-400 font-medium py-2 rounded-lg text-sm flex items-center justify-center gap-2 cursor-not-allowed">
                                                        <CheckCircle2 className="h-4 w-4" /> Acquistato
                                                    </button>
                                                ) : (
                                                    <button
                                                        onClick={() => handleBuy(item)}
                                                        disabled={!canAfford || processingId === item.id}
                                                        className={`w-full font-medium py-2 text-sm rounded-lg flex items-center justify-center gap-2 transition-colors ${canAfford ? 'bg-gray-900 hover:bg-black text-white' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
                                                    >
                                                        {!canAfford && <Lock className="h-3.5 w-3.5" />}
                                                        Acquista per {item.cost} Coin
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )
                            })
                        )}
                    </div>
                )}

                {activeTab === 'inventory' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                        {inventory.length === 0 ? (
                            <div className="col-span-full py-12 flex flex-col items-center justify-center text-gray-400 bg-white rounded-xl border border-dashed border-gray-200">
                                <Box className="h-12 w-12 mb-3 text-gray-300" />
                                <p className="text-sm font-medium">Il tuo inventario è vuoto.</p>
                                <p className="text-xs mt-1">Completa i Focus Sprint per guadagnare Coin e sbloccare ricompense!</p>
                            </div>
                        ) : (
                            inventory.map(item => {
                                // Since we haven't fetched 'equippedId' robustly yet without a refresh,
                                // we'll treat it gracefully or force a page reload on equip.
                                // A perfect solution would be fetching `users.equippedItemId` accurately on load.

                                return (
                                    <div key={item.id} className="bg-white border text-center border-gray-200 rounded-xl overflow-hidden shadow-sm hover:shadow transition-shadow group">
                                        <div className="h-32 bg-gray-50 border-b border-gray-100 flex items-center justify-center p-6 relative overflow-hidden">
                                            <div className="absolute inset-0 opacity-10 bg-stripes pointer-events-none" />
                                            {item.cssValue.includes('skin-theme') ? (
                                                <div className={`h-20 w-full max-w-[8rem] shadow-md rounded-lg relative z-10 ${item.cssValue} !bg-local`} style={{ backgroundAttachment: 'scroll' }} />
                                            ) : (
                                                <div className={`h-16 w-16 bg-white shadow-md rounded-full relative z-10 flex items-center justify-center text-transparent ${item.cssValue}`} />
                                            )}
                                        </div>
                                        <div className="p-5">
                                            <h3 className="font-bold text-gray-900 mb-1">{item.name}</h3>
                                            <div className="mt-5 flex gap-2">
                                                <button
                                                    onClick={() => handleEquip(item)}
                                                    disabled={processingId === item.id}
                                                    className="w-full bg-brand-orange hover:bg-orange-600 text-white font-medium py-2 text-sm rounded-lg transition-colors flex items-center justify-center gap-2"
                                                >
                                                    Equipaggia
                                                </button>
                                                <button
                                                    onClick={() => handleUnequip(item)}
                                                    disabled={processingId === item.id}
                                                    className="px-3 bg-gray-100 hover:bg-gray-200 text-gray-600 font-medium py-2 text-sm rounded-lg transition-colors flex items-center justify-center"
                                                    title="Rimuovi"
                                                >
                                                    Togli
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )
                            })
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}
