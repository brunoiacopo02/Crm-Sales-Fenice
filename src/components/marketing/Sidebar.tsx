'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  ImagePlay,
  Target,
  Receipt,
  Crown,
  BarChart3,
  AlertTriangle,
} from 'lucide-react'

const GROUPS = [
  {
    label: 'MANAGER',
    items: [
      { href: '/marketing/manager', label: 'Panoramica', Icon: Crown },
      { href: '/marketing/vendite', label: 'Vendite', Icon: Receipt },
      { href: '/marketing/alert', label: 'Alert', Icon: AlertTriangle },
      { href: '/marketing/target', label: 'Target', Icon: Target },
    ],
  },
  {
    label: 'MEDIA BUYER',
    items: [
      { href: '/marketing/dashboard', label: 'Dashboard', Icon: LayoutDashboard },
      { href: '/marketing/creative', label: 'Creatività', Icon: ImagePlay },
    ],
  },
] as const

// Mappa ruoli marketing → gruppi visibili.
const ROLE_GROUPS: Record<string, string[]> = {
  manager: ['MANAGER', 'MEDIA BUYER'],
  media_buyer: ['MEDIA BUYER'],
  copywriter: ['MEDIA BUYER'],
  social: ['MANAGER'],
  // Super-admin (area='both') / ADMIN vede tutto.
  admin: ['MANAGER', 'MEDIA BUYER'],
}

export default function Sidebar({ role }: { role: string }) {
  const pathname = usePathname()
  const allowedGroups = new Set(ROLE_GROUPS[role] ?? ['MANAGER', 'MEDIA BUYER'])
  const groups = GROUPS.filter((g) => allowedGroups.has(g.label))

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-logo-circle">FE</div>
        <div className="sidebar-brand">
          <div className="sidebar-brand-title">Fenice Marketing</div>
          <div className="sidebar-brand-sub">Analytics & Performance</div>
        </div>
      </div>

      <nav className="sidebar-nav scrollbar-thin">
        {groups.map((group) => (
          <div className="sidebar-group" key={group.label}>
            <div className="sidebar-group-label">{group.label}</div>
            {group.items.map(({ href, label, Icon }) => {
              const active = pathname === href || pathname.startsWith(href + '/')
              return (
                <Link key={href} href={href} className={`nav-item ${active ? 'active' : ''}`}>
                  <Icon size={16} className="nav-icon" />
                  <span>{label}</span>
                </Link>
              )
            })}
          </div>
        ))}
      </nav>
    </aside>
  )
}
