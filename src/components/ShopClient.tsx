"use client"
import { useAuth } from "@/components/AuthProvider"
import Image from "next/image"
import { useState, useEffect, useMemo } from "react"
import { getActiveShopItems, getUserInventory, buyShopItem, equipShopItem, unequipShopItem } from "@/app/actions/shopActions"
import { getUserWalletCoins } from "@/app/actions/sprintActions"
import { SafeWrapper } from "@/components/SafeWrapper"
import { ShoppingBag, Box, CheckCircle2, Lock, Sparkles, Crown, Star, ArrowUpDown, ArrowUp, ArrowDown, Palette, Wand2, Award, Gem, Flame } from "lucide-react"

type Category = 'all' | 'avatar' | 'theme' | 'effect' | 'title'
type SortOrder = 'none' | 'asc' | 'desc'

type RarityTier = 'comune' | 'raro' | 'epico' | 'leggendario'

const CATEGORIES: { key: Category; label: string; icon: typeof ShoppingBag; color: string; activeColor: string }[] = [
    { key: 'all', label: 'Tutti', icon: ShoppingBag, color: 'bg-white/5 text-[var(--color-gaming-text-muted)] border-[var(--color-gaming-border)]', activeColor: 'bg-gradient-to-r from-fire-500/20 to-brand-orange/20 text-fire-400 border-fire-500/40 shadow-gaming-glow-fire' },
    { key: 'avatar', label: 'Skin Avatar', icon: Star, color: 'bg-purple-500/5 text-[var(--color-gaming-text-muted)] border-[var(--color-gaming-border)]', activeColor: 'bg-gradient-to-r from-purple-500/20 to-purple-600/20 text-purple-300 border-purple-500/40 shadow-[0_0_12px_-4px_rgba(168,85,247,0.3)]' },
    { key: 'theme', label: 'Temi', icon: Palette, color: 'bg-blue-500/5 text-[var(--color-gaming-text-muted)] border-[var(--color-gaming-border)]', activeColor: 'bg-gradient-to-r from-blue-500/20 to-blue-600/20 text-blue-300 border-blue-500/40 shadow-[0_0_12px_-4px_rgba(59,130,246,0.3)]' },
    { key: 'effect', label: 'Effetti', icon: Wand2, color: 'bg-amber-500/5 text-[var(--color-gaming-text-muted)] border-[var(--color-gaming-border)]', activeColor: 'bg-gradient-to-r from-amber-500/20 to-amber-600/20 text-amber-300 border-amber-500/40 shadow-[0_0_12px_-4px_rgba(245,158,11,0.3)]' },
    { key: 'title', label: 'Titoli', icon: Award, color: 'bg-emerald-500/5 text-[var(--color-gaming-text-muted)] border-[var(--color-gaming-border)]', activeColor: 'bg-gradient-to-r from-emerald-500/20 to-emerald-600/20 text-emerald-300 border-emerald-500/40 shadow-[0_0_12px_-4px_rgba(16,185,129,0.3)]' },
]

function getItemCategory(cssValue: string): Category {
    if (cssValue.includes('skin-avatar')) return 'avatar'
    if (cssValue.includes('skin-theme')) return 'theme'
    if (cssValue.includes('skin-effect')) return 'effect'
    return 'title'
}

function getCategoryMeta(cat: Category) {
    return CATEGORIES.find(c => c.key === cat) || CATEGORIES[0]
}

interface RarityStyle {
    tier: RarityTier
    label: string
    border: string
    glow: string
    bg: string
    text: string
    badge: string
    cardClass: string
    iconColor: string
}

function getRarity(cost: number): RarityStyle {
    if (cost >= 3000) return {
        tier: 'leggendario',
        label: 'Leggendario',
        border: 'border-purple-400/60',
        glow: 'shadow-[0_0_30px_-4px_rgba(168,85,247,0.5),0_0_12px_-2px_rgba(168,85,247,0.3)]',
        bg: 'from-purple-500/15 via-purple-900/10 to-[var(--color-gaming-bg-surface)]',
        text: 'text-purple-300',
        badge: 'bg-gradient-to-r from-purple-500 to-purple-600 text-white',
        cardClass: 'shop-card-legendary',
        iconColor: 'text-purple-400',
    }
    if (cost >= 1000) return {
        tier: 'epico',
        label: 'Epico',
        border: 'border-[var(--color-gaming-gold)]/50',
        glow: 'shadow-[0_0_25px_-4px_rgba(255,215,0,0.4),0_0_10px_-2px_rgba(255,215,0,0.25)]',
        bg: 'from-[var(--color-gaming-gold)]/10 via-amber-900/5 to-[var(--color-gaming-bg-surface)]',
        text: 'text-[var(--color-gaming-gold)]',
        badge: 'bg-gradient-to-r from-amber-500 to-[var(--color-gaming-gold)] text-black font-bold',
        cardClass: 'shop-card-epic',
        iconColor: 'text-[var(--color-gaming-gold)]',
    }
    if (cost >= 300) return {
        tier: 'raro',
        label: 'Raro',
        border: 'border-slate-300/40',
        glow: 'shadow-[0_0_20px_-4px_rgba(203,213,225,0.3),0_0_8px_-2px_rgba(203,213,225,0.15)]',
        bg: 'from-slate-300/10 via-slate-500/5 to-[var(--color-gaming-bg-surface)]',
        text: 'text-slate-300',
        badge: 'bg-gradient-to-r from-slate-300 to-slate-400 text-slate-900 font-semibold',
        cardClass: '',
        iconColor: 'text-slate-300',
    }
    return {
        tier: 'comune',
        label: 'Comune',
        border: 'border-amber-700/30',
        glow: 'shadow-[0_0_15px_-4px_rgba(180,130,80,0.25),0_0_6px_-2px_rgba(180,130,80,0.12)]',
        bg: 'from-amber-800/8 to-[var(--color-gaming-bg-surface)]',
        text: 'text-amber-600',
        badge: 'bg-gradient-to-r from-amber-700 to-amber-800 text-amber-200',
        cardClass: '',
        iconColor: 'text-amber-600',
    }
}

function RarityIcon({ tier }: { tier: RarityTier }) {
    switch (tier) {
        case 'leggendario': return <Gem className="h-3 w-3" />
        case 'epico': return <Crown className="h-3 w-3" />
        case 'raro': return <Sparkles className="h-3 w-3" />
        default: return <Flame className="h-3 w-3" />
    }
}

function ShopCardShop({ item, rarity, isOwned, canAfford, wasBought, processingId, onBuy, idx }: {
    item: any
    rarity: RarityStyle
    isOwned: boolean
    canAfford: boolean
    wasBought: boolean
    processingId: string | null
    onBuy: (item: any) => void
    idx: number
}) {
    const catMeta = getCategoryMeta(getItemCategory(item.cssValue))
    const isLegendary = rarity.tier === 'leggendario'

    return (
        <div
            className="shop-card-3d"
            style={{ animationDelay: `${idx * 60}ms`, animationFillMode: 'backwards' }}
        >
            <div
                className={`shop-card-inner bg-[var(--color-gaming-bg-card)] border-2 ${rarity.border} rounded-2xl overflow-hidden relative ${rarity.cardClass} animate-fade-in ${wasBought ? 'ring-2 ring-[var(--color-gaming-gold)] ring-offset-2 ring-offset-[var(--color-gaming-bg)]' : ''}`}
            >
                {/* Holographic overlay for legendary */}
                {isLegendary && <div className="shop-holographic-overlay" />}

                {/* Preview Area */}
                <div className={`h-40 bg-gradient-to-br ${rarity.bg} border-b border-[var(--color-gaming-border)] flex items-center justify-center p-6 relative overflow-hidden`}>
                    {/* Corner sparkles for epic+ */}
                    {(rarity.tier === 'epico' || isLegendary) && (
                        <>
                            <div className="absolute top-3 right-3 opacity-30" style={{ animation: 'shop-sparkle 2.5s ease-in-out infinite' }}>
                                <Sparkles className={`h-4 w-4 ${rarity.iconColor}`} />
                            </div>
                            <div className="absolute bottom-3 right-3 opacity-20" style={{ animation: 'shop-sparkle 2.5s ease-in-out infinite 1.2s' }}>
                                <Sparkles className={`h-3 w-3 ${rarity.iconColor}`} />
                            </div>
                        </>
                    )}

                    {item.cssValue.includes('skin-theme') ? (
                        <div className={`h-28 w-full max-w-[10rem] shadow-card rounded-xl relative z-10 ${item.cssValue} !bg-local transition-transform duration-300 group-hover:scale-105`} style={{ backgroundAttachment: 'scroll' }} />
                    ) : (
                        <div className={`h-22 w-22 bg-white shadow-card rounded-full relative z-10 flex items-center justify-center text-transparent ${item.cssValue} transition-transform duration-300 group-hover:scale-110`} />
                    )}

                    {isOwned && (
                        <div className="absolute top-3 right-3 bg-emerald-500/20 text-emerald-400 p-1.5 rounded-full shadow-gaming-card border border-emerald-500/30 z-10">
                            <CheckCircle2 className="h-4 w-4" />
                        </div>
                    )}

                    {/* Rarity badge top-left */}
                    <div className={`absolute top-3 left-3 ${rarity.badge} text-[10px] px-2.5 py-1 rounded-full shadow-soft uppercase tracking-wider flex items-center gap-1 z-10`}>
                        <RarityIcon tier={rarity.tier} />
                        {rarity.label}
                    </div>

                    {/* Category badge bottom-left */}
                    <div className={`absolute bottom-3 left-3 ${catMeta.activeColor} text-[10px] font-semibold px-2 py-0.5 rounded-full border flex items-center gap-1 z-10`}>
                        <catMeta.icon className="h-3 w-3" />
                        {catMeta.label}
                    </div>
                </div>

                {/* Info section */}
                <div className="p-5 relative z-10">
                    <h3 className="font-bold text-[var(--color-gaming-text)] text-base mb-1 truncate">{item.name}</h3>
                    <div className="text-xs text-[var(--color-gaming-text-muted)] line-clamp-2 h-8">{item.description}</div>

                    {/* Price with animated coin */}
                    <div className="mt-4 flex items-center gap-2.5 mb-4">
                        <div className="shop-coin-animated">
                            <Image src="/assets/store/icon_fenice_coin.png" alt="coin" width={18} height={18} className="drop-shadow-sm" />
                        </div>
                        <div className={`text-sm font-bold ${rarity.tier === 'leggendario' ? 'text-purple-300' : rarity.tier === 'epico' ? 'text-[var(--color-gaming-gold)]' : 'text-[var(--color-gaming-gold)]'}`}>
                            {item.cost}
                            <span className="text-[var(--color-gaming-gold-dim)] ml-1 font-normal">Coin</span>
                        </div>
                    </div>

                    {/* Action */}
                    <div>
                        {isOwned ? (
                            <div className="w-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 font-semibold py-2.5 rounded-xl text-sm flex items-center justify-center gap-2">
                                <CheckCircle2 className="h-4 w-4" /> Acquistato
                            </div>
                        ) : (
                            <button
                                onClick={() => onBuy(item)}
                                disabled={!canAfford || processingId === item.id}
                                className={`w-full font-semibold py-2.5 text-sm rounded-xl flex items-center justify-center gap-2 transition-all duration-200 ${canAfford
                                    ? 'bg-gradient-to-r from-fire-500 to-brand-orange hover:from-brand-orange hover:to-fire-500 text-white shadow-gaming-glow-fire hover:shadow-gaming-glow-amber active:scale-[0.97]'
                                    : 'bg-[var(--color-gaming-bg-surface)] text-[var(--color-gaming-text-muted)] cursor-not-allowed border border-[var(--color-gaming-border)]'}`}
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
        </div>
    )
}

function ShopCardInventory({ item, rarity, processingId, onEquip, onUnequip, idx }: {
    item: any
    rarity: RarityStyle
    processingId: string | null
    onEquip: (item: any) => void
    onUnequip: (item: any) => void
    idx: number
}) {
    const isLegendary = rarity.tier === 'leggendario'

    return (
        <div
            className="shop-card-3d"
            style={{ animationDelay: `${idx * 60}ms`, animationFillMode: 'backwards' }}
        >
            <div
                className={`shop-card-inner bg-[var(--color-gaming-bg-card)] border-2 ${rarity.border} rounded-2xl overflow-hidden relative ${rarity.cardClass} animate-fade-in`}
            >
                {isLegendary && <div className="shop-holographic-overlay" />}

                <div className={`h-40 bg-gradient-to-br ${rarity.bg} border-b border-[var(--color-gaming-border)] flex items-center justify-center p-6 relative overflow-hidden`}>
                    <div className={`absolute top-3 left-3 ${rarity.badge} text-[10px] px-2.5 py-1 rounded-full shadow-soft uppercase tracking-wider flex items-center gap-1 z-10`}>
                        <RarityIcon tier={rarity.tier} />
                        {rarity.label}
                    </div>

                    {(rarity.tier === 'epico' || isLegendary) && (
                        <div className="absolute top-3 right-3 opacity-30" style={{ animation: 'shop-sparkle 2.5s ease-in-out infinite' }}>
                            <Sparkles className={`h-4 w-4 ${rarity.iconColor}`} />
                        </div>
                    )}

                    {item.cssValue.includes('skin-theme') ? (
                        <div className={`h-28 w-full max-w-[10rem] shadow-card rounded-xl relative z-10 ${item.cssValue} !bg-local transition-transform duration-300 group-hover:scale-105`} style={{ backgroundAttachment: 'scroll' }} />
                    ) : (
                        <div className={`h-22 w-22 bg-white shadow-card rounded-full relative z-10 flex items-center justify-center text-transparent ${item.cssValue} transition-transform duration-300 group-hover:scale-110`} />
                    )}
                </div>

                <div className="p-5 relative z-10">
                    <h3 className="font-bold text-[var(--color-gaming-text)] text-base mb-4 truncate">{item.name}</h3>
                    <div className="flex gap-2">
                        <button
                            onClick={() => onEquip(item)}
                            disabled={processingId === item.id}
                            className="flex-1 bg-gradient-to-r from-fire-500 to-brand-orange hover:from-brand-orange hover:to-fire-500 text-white font-semibold py-2.5 text-sm rounded-xl transition-all duration-200 flex items-center justify-center gap-2 shadow-gaming-glow-fire hover:shadow-gaming-glow-amber active:scale-[0.97]"
                        >
                            <Star className="h-3.5 w-3.5" /> Equipaggia
                        </button>
                        <button
                            onClick={() => onUnequip(item)}
                            disabled={processingId === item.id}
                            className="px-4 bg-[var(--color-gaming-bg-surface)] hover:bg-[var(--color-gaming-bg-card-hover)] text-[var(--color-gaming-text-muted)] font-semibold py-2.5 text-sm rounded-xl transition-all duration-200 flex items-center justify-center border border-[var(--color-gaming-border)]"
                            title="Rimuovi"
                        >
                            Togli
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}

export function ShopClient({ userId }: { userId: string }) {
    const [activeTab, setActiveTab] = useState<'shop' | 'inventory'>('shop')
    const [items, setItems] = useState<any[]>([])
    const [inventory, setInventory] = useState<any[]>([])
    const [wallet, setWallet] = useState(0)
    const [isLoading, setIsLoading] = useState(true)
    const [equippedId, setEquippedId] = useState<string | null>(null)
    const [processingId, setProcessingId] = useState<string | null>(null)
    const [justBought, setJustBought] = useState<string | null>(null)
    const [activeCategory, setActiveCategory] = useState<Category>('all')
    const [sortOrder, setSortOrder] = useState<SortOrder>('none')

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

    const filteredItems = useMemo(() => {
        let filtered = activeCategory === 'all' ? items : items.filter(item => getItemCategory(item.cssValue) === activeCategory)
        if (sortOrder === 'asc') filtered = [...filtered].sort((a, b) => a.cost - b.cost)
        else if (sortOrder === 'desc') filtered = [...filtered].sort((a, b) => b.cost - a.cost)
        return filtered
    }, [items, activeCategory, sortOrder])

    const cycleSortOrder = () => {
        setSortOrder(prev => prev === 'none' ? 'asc' : prev === 'asc' ? 'desc' : 'none')
    }

    const categoryCounts = useMemo(() => {
        const counts: Record<Category, number> = { all: items.length, avatar: 0, theme: 0, effect: 0, title: 0 }
        items.forEach(item => { counts[getItemCategory(item.cssValue)]++ })
        return counts
    }, [items])

    if (isLoading) return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1,2,3].map(i => (
                <div key={i} className="skeleton-card h-72" />
            ))}
        </div>
    )

    const myItemIds = new Set(inventory.map(i => i.id))

    return (
        <SafeWrapper>
            <div className="bg-[var(--color-gaming-bg)] rounded-2xl shadow-gaming-elevated border border-[var(--color-gaming-border)] overflow-hidden">
                {/* Header / Tabs */}
                <div className="border-b border-[var(--color-gaming-border)] bg-gradient-to-r from-[var(--color-gaming-bg-deep)] to-[var(--color-gaming-bg-card)] flex items-center justify-between px-6">
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => setActiveTab('shop')}
                            className={`py-4 px-4 font-semibold text-sm flex items-center gap-2 border-b-2 transition-all duration-200 ${activeTab === 'shop' ? 'border-fire-400 text-fire-400' : 'border-transparent text-[var(--color-gaming-text-muted)] hover:text-white'}`}
                        >
                            <ShoppingBag className="h-4 w-4" /> Vetrina
                        </button>
                        <button
                            onClick={() => setActiveTab('inventory')}
                            className={`py-4 px-4 font-semibold text-sm flex items-center gap-2 border-b-2 transition-all duration-200 ${activeTab === 'inventory' ? 'border-fire-400 text-fire-400' : 'border-transparent text-[var(--color-gaming-text-muted)] hover:text-white'}`}
                        >
                            <Box className="h-4 w-4" /> Il mio Inventario
                        </button>
                    </div>

                    {/* Coin Balance Badge */}
                    <div className="flex items-center gap-2.5 bg-gradient-to-r from-[var(--color-gaming-bg-card)] to-[var(--color-gaming-bg-surface)] border border-[var(--color-gaming-border-hover)] px-5 py-2 rounded-full shadow-gaming-glow-gold">
                        <div className="relative shop-coin-animated">
                            <Image src="/assets/store/icon_fenice_coin.png" alt="Fenice Coin" width={20} height={20} className="object-contain drop-shadow-sm" />
                            <div className="absolute inset-0 animate-glow-pulse rounded-full" />
                        </div>
                        <div className="text-sm font-bold text-[var(--color-gaming-gold)]">{wallet} <span className="text-[var(--color-gaming-gold-dim)]">Coin</span></div>
                    </div>
                </div>

                {/* Content Body */}
                <div className="p-6 bg-gradient-to-b from-[var(--color-gaming-bg)] to-[var(--color-gaming-bg-deep)] min-h-[400px]">
                    {activeTab === 'shop' && (
                        <div>
                            {/* Category Filters + Sort */}
                            <div className="flex flex-wrap items-center gap-2 mb-6">
                                <div className="flex flex-wrap items-center gap-2 flex-1">
                                    {CATEGORIES.map(cat => {
                                        const count = categoryCounts[cat.key]
                                        const isActive = activeCategory === cat.key
                                        const Icon = cat.icon
                                        if (cat.key !== 'all' && count === 0) return null
                                        return (
                                            <button
                                                key={cat.key}
                                                onClick={() => setActiveCategory(cat.key)}
                                                className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold border transition-all duration-300 ${
                                                    isActive
                                                        ? cat.activeColor
                                                        : `${cat.color} hover:bg-[var(--color-gaming-bg-card-hover)] hover:text-white hover:border-[var(--color-gaming-border-hover)]`
                                                }`}
                                            >
                                                <Icon className="h-3.5 w-3.5" />
                                                {cat.label}
                                                <span className={`ml-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${isActive ? 'bg-white/20' : 'bg-white/5'}`}>
                                                    {count}
                                                </span>
                                            </button>
                                        )
                                    })}
                                </div>
                                <button
                                    onClick={cycleSortOrder}
                                    className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold border transition-all duration-300 ${
                                        sortOrder !== 'none'
                                            ? 'bg-gradient-to-r from-fire-500/20 to-brand-orange/20 text-fire-400 border-fire-500/40 shadow-gaming-glow-fire'
                                            : 'bg-white/5 text-[var(--color-gaming-text-muted)] border-[var(--color-gaming-border)] hover:bg-[var(--color-gaming-bg-card-hover)] hover:text-white hover:border-[var(--color-gaming-border-hover)]'
                                    }`}
                                    title={sortOrder === 'none' ? 'Ordina per prezzo' : sortOrder === 'asc' ? 'Prezzo crescente' : 'Prezzo decrescente'}
                                >
                                    {sortOrder === 'asc' ? <ArrowUp className="h-3.5 w-3.5" /> : sortOrder === 'desc' ? <ArrowDown className="h-3.5 w-3.5" /> : <ArrowUpDown className="h-3.5 w-3.5" />}
                                    Prezzo
                                </button>
                            </div>

                            {/* Items Grid */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                                {filteredItems.length === 0 ? (
                                    <div className="col-span-full py-16 flex flex-col items-center justify-center text-[var(--color-gaming-text-muted)] animate-fade-in">
                                        <div className="w-16 h-16 rounded-2xl bg-[var(--color-gaming-bg-card)] flex items-center justify-center mb-4 border border-[var(--color-gaming-border)]">
                                            <ShoppingBag className="h-8 w-8 text-[var(--color-gaming-text-muted)]" />
                                        </div>
                                        <div className="text-sm font-medium">
                                            {activeCategory === 'all' ? 'Nessun oggetto disponibile nello store.' : `Nessun oggetto nella categoria "${getCategoryMeta(activeCategory).label}".`}
                                        </div>
                                    </div>
                                ) : (
                                    filteredItems.map((item, idx) => {
                                        const isOwned = myItemIds.has(item.id)
                                        const canAfford = wallet >= item.cost
                                        const rarity = getRarity(item.cost)
                                        const wasBought = justBought === item.id

                                        return (
                                            <ShopCardShop
                                                key={item.id}
                                                item={item}
                                                rarity={rarity}
                                                isOwned={isOwned}
                                                canAfford={canAfford}
                                                wasBought={wasBought}
                                                processingId={processingId}
                                                onBuy={handleBuy}
                                                idx={idx}
                                            />
                                        )
                                    })
                                )}
                            </div>
                        </div>
                    )}

                    {activeTab === 'inventory' && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                            {inventory.length === 0 ? (
                                <div className="col-span-full py-16 flex flex-col items-center justify-center text-[var(--color-gaming-text-muted)] bg-[var(--color-gaming-bg-card)] rounded-2xl border-2 border-dashed border-[var(--color-gaming-border)] animate-fade-in">
                                    <div className="w-16 h-16 rounded-2xl bg-[var(--color-gaming-bg-surface)] flex items-center justify-center mb-4 border border-[var(--color-gaming-border)]">
                                        <Box className="h-8 w-8 text-[var(--color-gaming-text-muted)]" />
                                    </div>
                                    <div className="text-sm font-semibold text-[var(--color-gaming-text)]">Il tuo inventario è vuoto.</div>
                                    <div className="text-xs mt-1.5 text-[var(--color-gaming-text-muted)]">Completa i Focus Sprint per guadagnare Coin e sbloccare ricompense!</div>
                                </div>
                            ) : (
                                inventory.map((item, idx) => {
                                    const rarity = getRarity(item.cost || 0)
                                    return (
                                        <ShopCardInventory
                                            key={item.id}
                                            item={item}
                                            rarity={rarity}
                                            processingId={processingId}
                                            onEquip={handleEquip}
                                            onUnequip={handleUnequip}
                                            idx={idx}
                                        />
                                    )
                                })
                            )}
                        </div>
                    )}
                </div>
            </div>
        </SafeWrapper>
    )
}
