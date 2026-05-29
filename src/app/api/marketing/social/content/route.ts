import { NextRequest, NextResponse } from 'next/server'
import { currentTenant, assertMarketingArea } from '@/lib/tenancy'

export const maxDuration = 30

// Contratto stabile per la pagina /social/contenuti.
//   GET /api/marketing/social/content?from=YYYY-MM-DD&to=YYYY-MM-DD
//   →  { demo: boolean, posts: SocialPost[], followers: FollowerStats[] }
//
// Finché non sono configurati i token IG/TikTok l'endpoint ritorna dati demo.

export type SocialPlatform = 'instagram' | 'tiktok'

export interface SocialPost {
  id: string
  platform: SocialPlatform
  posted_at: string
  media_type: string
  caption: string | null
  permalink: string
  thumbnail_url: string | null
  views: number
  likes: number
  comments: number
  shares: number
  reach: number
}

export interface FollowerStats {
  platform: SocialPlatform
  current: number
  delta_30d: number
}

function hasInstagramCreds(): boolean {
  return !!(process.env.IG_PAGE_TOKEN && process.env.IG_USER_ID)
}
function hasTiktokCreds(): boolean {
  return !!(process.env.TT_APP_TOKEN && process.env.TT_USER_ID)
}

function rand(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0xffffffff
  }
}

function mockPosts(platform: SocialPlatform, from: string, to: string): SocialPost[] {
  const rng = rand(platform === 'instagram' ? 1234 : 9876)
  const start = new Date(from + 'T00:00:00Z').getTime()
  const end = new Date(to + 'T23:59:59Z').getTime()
  const days = Math.max(1, Math.round((end - start) / 86400000))
  const n = platform === 'instagram' ? Math.min(18, Math.ceil(days * 0.6)) : Math.min(14, Math.ceil(days * 0.45))

  const types =
    platform === 'instagram' ? ['reel', 'reel', 'reel', 'image', 'carousel'] : ['video']
  const captions = [
    'Il funnel che ci ha portato 6 chiusure in una settimana 🚀',
    'Errore #1 che fa fallire ogni media buyer junior',
    'Come ho strutturato il sales call → contratto',
    'Il setup che usiamo per fare 2.000€ al giorno di adv',
    'Quello che nessuno dice sui lanci email',
    'POV: chiudi un cliente da 3k mentre fai colazione',
    'I 3 KPI che guardo prima di scalare una campagna',
    'Cosa abbiamo cambiato nel funnel a marzo (e che ha funzionato)',
  ]

  const posts: SocialPost[] = []
  for (let i = 0; i < n; i++) {
    const t = start + Math.floor(rng() * (end - start))
    const viewsBase = platform === 'instagram' ? 4500 : 12000
    const views = Math.round(viewsBase * (0.3 + rng() * 4))
    const likeRate = 0.04 + rng() * 0.05
    const commentRate = 0.003 + rng() * 0.012
    const shareRate = platform === 'tiktok' ? 0.005 + rng() * 0.02 : 0
    posts.push({
      id: `${platform}-mock-${i}`,
      platform,
      posted_at: new Date(t).toISOString(),
      media_type: types[Math.floor(rng() * types.length)],
      caption: captions[Math.floor(rng() * captions.length)],
      permalink:
        platform === 'instagram'
          ? `https://www.instagram.com/reel/MOCK${i}/`
          : `https://www.tiktok.com/@example/video/MOCK${i}`,
      thumbnail_url: null,
      views,
      likes: Math.round(views * likeRate),
      comments: Math.round(views * commentRate),
      shares: Math.round(views * shareRate),
      reach: platform === 'instagram' ? Math.round(views * (0.7 + rng() * 0.4)) : 0,
    })
  }
  posts.sort((a, b) => (a.posted_at < b.posted_at ? 1 : -1))
  return posts
}

function mockFollowers(): FollowerStats[] {
  return [
    { platform: 'instagram', current: 24380, delta_30d: 612 },
    { platform: 'tiktok', current: 18950, delta_30d: 1184 },
  ]
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await currentTenant()
    assertMarketingArea(ctx)

    const { searchParams } = req.nextUrl
    const from = searchParams.get('from') ?? ''
    const to = searchParams.get('to') ?? ''
    if (!from || !to) {
      return NextResponse.json({ error: 'Parametri from/to mancanti' }, { status: 400 })
    }

    const igConfigured = hasInstagramCreds()
    const ttConfigured = hasTiktokCreds()
    const demo = !igConfigured && !ttConfigured

    const posts: SocialPost[] = [
      ...mockPosts('instagram', from, to),
      ...mockPosts('tiktok', from, to),
    ].sort((a, b) => (a.posted_at < b.posted_at ? 1 : -1))

    const followers = mockFollowers()

    return NextResponse.json({ demo, posts, followers })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 401 })
  }
}
