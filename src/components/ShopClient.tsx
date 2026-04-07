"use client"
import { useAuth } from "@/components/AuthProvider"
import Image from "next/image"
import { useState, useEffect } from "react"
import { getActiveShopItems, getUserInventory, buyShopItem, equipShopItem, unequipShopItem } from "@/app/actions/shopActions"
import { getUserWalletCoins } from "@/app/actions/sprintActions"
import { ShoppingBag, Box, CheckCircle2, Lock, Sparkles, Crown, Star } from "lucide-react"
export function ShopClient({ userId }: { userId: string }) {
    // Removed useSession hooks
    const [activeTab, setActiveTab] = useState<'shop' | 'inventory'>('shop')
    const [items, setItems] = useState<any[]>([])
    const [inventory, setInventory] = useState<any[]>([])
    const [wallet, setWallet] = useState(0)
    const [isLoading, setIsLoading] = useState(true)
    const [equippedId, setEquippedId] = useState<string | null>(null)
    const [processingId, setProcessingId] = useState<string | null>(null)
    const [justBought, setJustBought] = useState<string | null>(null)

    // Load Data
    const loadData = async () => {
        setIsLoading(true)
        try {
            const [shopData, invData, coins] = await Promise.all([
                getActiveShopItems(),
                getUserInventory(userId),
                getUserWalletCoins(userId)
            ])
            setItems(shopData)
            setInventory(invData)
            setWallet(coins)
        } catch (e) {
            console.error(e)
        }
        setIsLoading(false)
    }

    useEffect(() => {
        loadData()

        fetch('/api/user/profile').then(res => res.json()).then(data => {
        }).catch(() => { })

    }, [userId])

    useEffect(() => {
        import('@/app/actions/shopActions').then(({ getEquippedSkinCss }) => {
            getEquippedSkinCss(userId).then(css => {
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
            setJustBought(item.id)
            setTimeout(() => setJustBought(null), 2000)
            await loadData()
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

    // Rarity helper based on cost (rebalanced for new economy: base 50-200, rare 500-1000, premium 2000-5000)
    const getRarity = (cost: number) => {
        if (cost >= 3000) return { label: 'Leggendario', border: 'border-gold-400', glow: 'shadow-glow-gold', bg: 'from-gold-50 to-gold-100/50', text: 'text-gold-600', badge: 'bg-gradient-to-r from-gold-400 to-gold-500 text-white' }
        if (cost >= 1000) return { label: 'Epico', border: 'border-ember-400', glow: 'shadow-glow-ember', bg: 'from-ember-50 to-ember-100/50', text: 'text-ember-600', badge: 'bg-gradient-to-r from-ember-400 to-ember-500 text-white' }
        if (cost >= 300) return { label: 'Raro', border: 'border-brand-orange-400', glow: 'shadow-glow-orange', bg: 'from-brand-orange-50 to-brand-orange-100/50', text: 'text-brand-orange-600', badge: 'bg-gradient-to-r from-brand-orange to-brand-orange-500 text-brand-charcoal' }
        return { label: 'Comune', border: 'border-ash-300', glow: 'shadow-soft', bg: 'from-ash-50 to-ash-100/50', text: 'text-ash-500', badge: 'bg-ash-200 text-ash-700' }
    }

    if (isLoading) return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1,2,3].map(i => (
                <div key={i} className="skeleton-card h-72" />
            ))}
        </div>
    )

    const myItemIds = new Set(inventory.map(i => i.id))

    return (
        <div className="bg-white rounded-2xl shadow-card border border-ash-200/60 overflow-hidden">
            {/* Header / Tabs */}
            <div className="border-b border-ash-200/60 bg-gradient-to-r from-ash-50 to-ash-100/50 flex items-center justify-between px-6">
                <div className="flex items-center gap-1">
                    <button
                        onClick={() => setActiveTab('shop')}
                        className={`py-4 px-4 font-semibold text-sm flex items-center gap-2 border-b-2 transition-all duration-200 ${activeTab === 'shop' ? 'border-brand-orange text-brand-orange-700' : 'border-transparent text-ash-500 hover:text-ash-800'}`}
                    >
                        <ShoppingBag className="h-4 w-4" /> Vetrina
                    </button>
                    <button
                        onClick={() => setActiveTab('inventory')}
                        className={`py-4 px-4 font-semibold text-sm flex items-center gap-2 border-b-2 transition-all duration-200 ${activeTab === 'inventory' ? 'border-brand-orange text-brand-orange-700' : 'border-transparent text-ash-500 hover:text-ash-800'}`}
                    >
                        <Box className="h-4 w-4" /> Il mio Inventario
                    </button>
                </div>

                {/* Coin Balance Badge */}
                <div className="flex items-center gap-2.5 bg-gradient-to-r from-gold-50 to-brand-orange-50 border border-gold-200 px-5 py-2 rounded-full shadow-soft">
                    <div className="relative">
                        <Image src="/assets/store/icon_fenice_coin.png" alt="Fenice Coin" width={20} height={20} className="object-contain drop-shadow-sm" />
                        <div className="absolute inset-0 animate-glow-pulse rounded-full" />
                    </div>
                    <div className="text-sm font-bold text-gold-700">{wallet} <span className="text-gold-500">Coin</span></div>
                </div>
            </div>

            {/* Content Body */}
            <div className="p-6 bg-gradient-to-b from-ash-50/50 to-white min-h-[400px]">
                {activeTab === 'shop' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                        {items.length === 0 ? (
                            <div className="col-span-full py-16 flex flex-col items-center justify-center text-ash-400 animate-fade-in">
                                <div className="w-16 h-16 rounded-2xl bg-ash-100 flex items-center justify-center mb-4">
                                    <ShoppingBag className="h-8 w-8 text-ash-300" />
                                </div>
                                <div className="text-sm font-medium">Nessun oggetto disponibile nello store.</div>
                            </div>
                        ) : (
                            items.map((item, idx) => {
                                const isOwned = myItemIds.has(item.id)
                                const canAfford = wallet >= item.cost
                                const rarity = getRarity(item.cost)
                                const wasBought = justBought === item.id

                                return (
                                    <div
                                        key={item.id}
                                        className={`bg-white border-2 ${rarity.border} rounded-2xl overflow-hidden transition-all duration-300 hover:shadow-elevated hover:-translate-y-1 group animate-fade-in ${wasBought ? 'ring-2 ring-gold-400 ring-offset-2' : ''}`}
                                        style={{ animationDelay: `${idx * 60}ms`, animationFillMode: 'backwards' }}
                                    >
                                        {/* Preview Area */}
                                        <div className={`h-36 bg-gradient-to-br ${rarity.bg} border-b border-ash-100 flex items-center justify-center p-6 relative overflow-hidden`}>
                                            {/* Decorative particles */}
                                            <div className="absolute top-2 right-2 opacity-20">
                                                <Sparkles className={`h-5 w-5 ${rarity.text}`} />
                                            </div>

                                            {item.cssValue.includes('skin-theme') ? (
                                                <div className={`h-24 w-full max-w-[9rem] shadow-card rounded-xl relative z-10 ${item.cssValue} !bg-local transition-transform duration-300 group-hover:scale-105`} style={{ backgroundAttachment: 'scroll' }} />
                                            ) : (
                                                <div className={`h-20 w-20 bg-white shadow-card rounded-full relative z-10 flex items-center justify-center text-transparent ${item.cssValue} transition-transform duration-300 group-hover:scale-110`} />
                                            )}
                                            {isOwned && (
                                                <div className="absolute top-3 right-3 bg-emerald-100 text-emerald-600 p-1.5 rounded-full shadow-soft border border-emerald-200">
                                                    <CheckCircle2 className="h-4 w-4" />
                                                </div>
                                            )}
                                            {/* Rarity badge */}
                                            <div className={`absolute top-3 left-3 ${rarity.badge} text-[10px] font-bold px-2.5 py-1 rounded-full shadow-soft uppercase tracking-wider`}>
                                                {rarity.label}
                                            </div>
                                        </div>

                                        {/* Info */}
                                        <div className="p-5">
                                            <h3 className="font-bold text-ash-800 text-base mb-1">{item.name}</h3>
                                            <div className="text-xs text-ash-500 line-clamp-2 h-8">{item.description}</div>

                                            {/* Price */}
                                            <div className="mt-4 flex items-center gap-2 mb-4">
                                                <Image src="/assets/store/icon_fenice_coin.png" alt="coin" width={16} height={16} />
                                                <div className="text-sm font-bold text-gold-700">{item.cost} Coin</div>
                                            </div>

                                            {/* Action */}
                                            <div>
                                                {isOwned ? (
                                                    <div className="w-full bg-emerald-50 text-emerald-600 border border-emerald-200 font-semibold py-2.5 rounded-xl text-sm flex items-center justify-center gap-2">
                                                        <CheckCircle2 className="h-4 w-4" /> Acquistato
                                                    </div>
                                                ) : (
                                                    <button
                                                        onClick={() => handleBuy(item)}
                                                        disabled={!canAfford || processingId === item.id}
                                                        className={`w-full font-semibold py-2.5 text-sm rounded-xl flex items-center justify-center gap-2 transition-all duration-200 ${canAfford
                                                            ? 'bg-gradient-to-r from-brand-charcoal to-ash-800 hover:from-ash-800 hover:to-brand-charcoal text-white shadow-soft hover:shadow-card'
                                                            : 'bg-ash-100 text-ash-400 cursor-not-allowed border border-ash-200'}`}
                                                    >
                                                        {!canAfford && <Lock className="h-3.5 w-3.5" />}
                                                        {processingId === item.id ? (
                                                            <div className="skeleton-line w-20 h-4" />
                                                        ) : (
                                                            <>Acquista per {item.cost} Coin</>
                                                        )}
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
                            <div className="col-span-full py-16 flex flex-col items-center justify-center text-ash-400 bg-white rounded-2xl border-2 border-dashed border-ash-200 animate-fade-in">
                                <div className="w-16 h-16 rounded-2xl bg-ash-100 flex items-center justify-center mb-4">
                                    <Box className="h-8 w-8 text-ash-300" />
                                </div>
                                <div className="text-sm font-semibold text-ash-500">Il tuo inventario è vuoto.</div>
                                <div className="text-xs mt-1.5 text-ash-400">Completa i Focus Sprint per guadagnare Coin e sbloccare ricompense!</div>
                            </div>
                        ) : (
                            inventory.map((item, idx) => {
                                const rarity = getRarity(item.cost || 0)

                                return (
                                    <div
                                        key={item.id}
                                        className={`bg-white border-2 ${rarity.border} rounded-2xl overflow-hidden transition-all duration-300 hover:shadow-elevated hover:-translate-y-1 group animate-fade-in`}
                                        style={{ animationDelay: `${idx * 60}ms`, animationFillMode: 'backwards' }}
                                    >
                                        <div className={`h-36 bg-gradient-to-br ${rarity.bg} border-b border-ash-100 flex items-center justify-center p-6 relative overflow-hidden`}>
                                            <div className="absolute top-3 left-3">
                                                <div className={`${rarity.badge} text-[10px] font-bold px-2.5 py-1 rounded-full shadow-soft uppercase tracking-wider`}>
                                                    {rarity.label}
                                                </div>
                                            </div>
                                            {item.cssValue.includes('skin-theme') ? (
                                                <div className={`h-24 w-full max-w-[9rem] shadow-card rounded-xl relative z-10 ${item.cssValue} !bg-local transition-transform duration-300 group-hover:scale-105`} style={{ backgroundAttachment: 'scroll' }} />
                                            ) : (
                                                <div className={`h-20 w-20 bg-white shadow-card rounded-full relative z-10 flex items-center justify-center text-transparent ${item.cssValue} transition-transform duration-300 group-hover:scale-110`} />
                                            )}
                                        </div>
                                        <div className="p-5">
                                            <h3 className="font-bold text-ash-800 text-base mb-4">{item.name}</h3>
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => handleEquip(item)}
                                                    disabled={processingId === item.id}
                                                    className="flex-1 bg-gradient-to-r from-brand-orange to-brand-orange-500 hover:from-brand-orange-500 hover:to-brand-orange text-brand-charcoal font-semibold py-2.5 text-sm rounded-xl transition-all duration-200 flex items-center justify-center gap-2 shadow-soft hover:shadow-glow-orange"
                                                >
                                                    <Star className="h-3.5 w-3.5" /> Equipaggia
                                                </button>
                                                <button
                                                    onClick={() => handleUnequip(item)}
                                                    disabled={processingId === item.id}
                                                    className="px-4 bg-ash-100 hover:bg-ash-200 text-ash-600 font-semibold py-2.5 text-sm rounded-xl transition-all duration-200 flex items-center justify-center border border-ash-200"
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
