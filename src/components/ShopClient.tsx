"use client"
import { useAuth } from "@/components/AuthProvider"
import Image from "next/image"
import { useState, useEffect, useMemo } from "react"
import { getActiveShopItems, getUserInventory, buyShopItem, equipShopItem, unequipShopItem } from "@/app/actions/shopActions"
import { getUserWalletCoins } from "@/app/actions/sprintActions"
import { ShoppingBag, Box, CheckCircle2, Lock, Sparkles, Crown, Star, ArrowUpDown, ArrowUp, ArrowDown, Palette, Wand2, Award } from "lucide-react"

type Category = 'all' | 'avatar' | 'theme' | 'effect' | 'title'
type SortOrder = 'none' | 'asc' | 'desc'

const CATEGORIES: { key: Category; label: string; icon: typeof ShoppingBag; color: string }[] = [
    { key: 'all', label: 'Tutti', icon: ShoppingBag, color: 'bg-white/10 text-white border-white/20' },
    { key: 'avatar', label: 'Skin Avatar', icon: Star, color: 'bg-purple-500/15 text-purple-300 border-purple-500/30' },
    { key: 'theme', label: 'Temi', icon: Palette, color: 'bg-blue-500/15 text-blue-300 border-blue-500/30' },
    { key: 'effect', label: 'Effetti', icon: Wand2, color: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
    { key: 'title', label: 'Titoli', icon: Award, color: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
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

    // Rarity helper based on cost (rebalanced for new economy: base 50-200, rare 500-1000, premium 2000-5000)
    const getRarity = (cost: number) => {
        if (cost >= 3000) return { label: 'Leggendario', border: 'border-[var(--color-gaming-gold)]/50', glow: 'shadow-gaming-glow-gold', bg: 'from-[var(--color-gaming-gold)]/10 to-[var(--color-gaming-bg-surface)]', text: 'text-[var(--color-gaming-gold)]', badge: 'bg-gradient-to-r from-gold-400 to-gold-500 text-white' }
        if (cost >= 1000) return { label: 'Epico', border: 'border-ember-400/50', glow: 'shadow-gaming-glow-fire', bg: 'from-ember-500/10 to-[var(--color-gaming-bg-surface)]', text: 'text-ember-400', badge: 'bg-gradient-to-r from-ember-400 to-ember-500 text-white' }
        if (cost >= 300) return { label: 'Raro', border: 'border-brand-orange/40', glow: 'shadow-gaming-glow-amber', bg: 'from-brand-orange/10 to-[var(--color-gaming-bg-surface)]', text: 'text-brand-orange', badge: 'bg-gradient-to-r from-brand-orange to-brand-orange-500 text-brand-charcoal' }
        return { label: 'Comune', border: 'border-[var(--color-gaming-border-hover)]', glow: 'shadow-gaming-card', bg: 'from-[var(--color-gaming-bg-card)] to-[var(--color-gaming-bg-surface)]', text: 'text-[var(--color-gaming-text-muted)]', badge: 'bg-white/10 text-white/70' }
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
                    <div className="relative">
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
                                            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border transition-all duration-200 ${
                                                isActive
                                                    ? `${cat.color} shadow-gaming-card`
                                                    : 'bg-[var(--color-gaming-bg-card)] text-[var(--color-gaming-text-muted)] border-[var(--color-gaming-border)] hover:bg-[var(--color-gaming-bg-card-hover)] hover:text-white'
                                            }`}
                                        >
                                            <Icon className="h-3.5 w-3.5" />
                                            {cat.label}
                                            <span className={`ml-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${isActive ? 'bg-white/40' : 'bg-ash-100'}`}>
                                                {count}
                                            </span>
                                        </button>
                                    )
                                })}
                            </div>
                            <button
                                onClick={cycleSortOrder}
                                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border transition-all duration-200 ${
                                    sortOrder !== 'none'
                                        ? 'bg-fire-500/15 text-fire-400 border-fire-500/30 shadow-gaming-glow-fire'
                                        : 'bg-[var(--color-gaming-bg-card)] text-[var(--color-gaming-text-muted)] border-[var(--color-gaming-border)] hover:bg-[var(--color-gaming-bg-card-hover)] hover:text-white'
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
                                    const catMeta = getCategoryMeta(getItemCategory(item.cssValue))

                                    return (
                                        <div
                                            key={item.id}
                                            className={`bg-[var(--color-gaming-bg-card)] border-2 ${rarity.border} rounded-2xl overflow-hidden transition-all duration-300 hover:${rarity.glow} hover:-translate-y-1 group animate-fade-in ${wasBought ? 'ring-2 ring-[var(--color-gaming-gold)] ring-offset-2 ring-offset-[var(--color-gaming-bg)]' : ''}`}
                                            style={{ animationDelay: `${idx * 60}ms`, animationFillMode: 'backwards' }}
                                        >
                                            {/* Preview Area */}
                                            <div className={`h-36 bg-gradient-to-br ${rarity.bg} border-b border-[var(--color-gaming-border)] flex items-center justify-center p-6 relative overflow-hidden`}>
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
                                                    <div className="absolute top-3 right-3 bg-emerald-500/15 text-emerald-400 p-1.5 rounded-full shadow-gaming-card border border-emerald-500/30">
                                                        <CheckCircle2 className="h-4 w-4" />
                                                    </div>
                                                )}
                                                {/* Rarity badge */}
                                                <div className={`absolute top-3 left-3 ${rarity.badge} text-[10px] font-bold px-2.5 py-1 rounded-full shadow-soft uppercase tracking-wider`}>
                                                    {rarity.label}
                                                </div>
                                                {/* Category badge */}
                                                <div className={`absolute bottom-3 left-3 ${catMeta.color} text-[10px] font-semibold px-2 py-0.5 rounded-full border flex items-center gap-1`}>
                                                    <catMeta.icon className="h-3 w-3" />
                                                    {catMeta.label}
                                                </div>
                                            </div>

                                            {/* Info */}
                                            <div className="p-5">
                                                <h3 className="font-bold text-[var(--color-gaming-text)] text-base mb-1">{item.name}</h3>
                                                <div className="text-xs text-[var(--color-gaming-text-muted)] line-clamp-2 h-8">{item.description}</div>

                                                {/* Price */}
                                                <div className="mt-4 flex items-center gap-2 mb-4">
                                                    <Image src="/assets/store/icon_fenice_coin.png" alt="coin" width={16} height={16} />
                                                    <div className="text-sm font-bold text-[var(--color-gaming-gold)]">{item.cost} Coin</div>
                                                </div>

                                                {/* Action */}
                                                <div>
                                                    {isOwned ? (
                                                        <div className="w-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 font-semibold py-2.5 rounded-xl text-sm flex items-center justify-center gap-2">
                                                            <CheckCircle2 className="h-4 w-4" /> Acquistato
                                                        </div>
                                                    ) : (
                                                        <button
                                                            onClick={() => handleBuy(item)}
                                                            disabled={!canAfford || processingId === item.id}
                                                            className={`w-full font-semibold py-2.5 text-sm rounded-xl flex items-center justify-center gap-2 transition-all duration-200 ${canAfford
                                                                ? 'bg-gradient-to-r from-fire-500 to-brand-orange hover:from-brand-orange hover:to-fire-500 text-white shadow-gaming-glow-fire hover:shadow-gaming-glow-amber'
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
                                    <div
                                        key={item.id}
                                        className={`bg-[var(--color-gaming-bg-card)] border-2 ${rarity.border} rounded-2xl overflow-hidden transition-all duration-300 hover:${rarity.glow} hover:-translate-y-1 group animate-fade-in`}
                                        style={{ animationDelay: `${idx * 60}ms`, animationFillMode: 'backwards' }}
                                    >
                                        <div className={`h-36 bg-gradient-to-br ${rarity.bg} border-b border-[var(--color-gaming-border)] flex items-center justify-center p-6 relative overflow-hidden`}>
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
                                            <h3 className="font-bold text-[var(--color-gaming-text)] text-base mb-4">{item.name}</h3>
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => handleEquip(item)}
                                                    disabled={processingId === item.id}
                                                    className="flex-1 bg-gradient-to-r from-fire-500 to-brand-orange hover:from-brand-orange hover:to-fire-500 text-white font-semibold py-2.5 text-sm rounded-xl transition-all duration-200 flex items-center justify-center gap-2 shadow-gaming-glow-fire hover:shadow-gaming-glow-amber"
                                                >
                                                    <Star className="h-3.5 w-3.5" /> Equipaggia
                                                </button>
                                                <button
                                                    onClick={() => handleUnequip(item)}
                                                    disabled={processingId === item.id}
                                                    className="px-4 bg-[var(--color-gaming-bg-surface)] hover:bg-[var(--color-gaming-bg-card-hover)] text-[var(--color-gaming-text-muted)] font-semibold py-2.5 text-sm rounded-xl transition-all duration-200 flex items-center justify-center border border-[var(--color-gaming-border)]"
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
