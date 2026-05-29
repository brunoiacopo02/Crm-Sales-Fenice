'use client'

import { useState, useRef, useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
import NotificationBell from './NotificationBell'
import { CompanySwitcher } from './CompanySwitcher'
import { useAuth } from '@/components/AuthProvider'

const TITLES: Record<string, string> = {
  '/marketing/dashboard': 'Dashboard',
  '/marketing/creative': 'Creatività',
  '/marketing/manager': 'Panoramica',
  '/marketing/vendite': 'Vendite',
  '/marketing/target': 'Target',
  '/marketing/alert': 'Alert',
  '/marketing/select-company': 'Seleziona azienda',
}

const ROLE_LABEL: Record<string, string> = {
  manager: 'Manager',
  admin: 'Manager',
  media_buyer: 'Media Buyer',
  copywriter: 'Copywriter',
  social: 'Social Media Manager',
}

function titleForPath(pathname: string): string {
  const keys = Object.keys(TITLES).sort((a, b) => b.length - a.length)
  for (const key of keys) {
    if (pathname === key || pathname.startsWith(key + '/')) return TITLES[key]
  }
  return 'Fenice Marketing'
}

export default function Topbar({
  role,
  email,
  currentCompany,
  canSwitchCompany,
}: {
  role: string
  email: string
  currentCompany?: string
  canSwitchCompany: boolean
}) {
  const pathname = usePathname()
  const router = useRouter()
  const { signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  async function handleLogout() {
    await signOut()
    router.push('/login')
  }

  const label = ROLE_LABEL[role] ?? 'Utente'
  const initial = (email || label).trim().charAt(0).toUpperCase() || 'U'
  const canSeeNotifications = role === 'manager' || role === 'admin'

  return (
    <header className="topbar">
      <div className="topbar-left">
        <h1 className="topbar-title">{titleForPath(pathname)}</h1>
      </div>
      <div className="topbar-right" ref={ref}>
        <CompanySwitcher current={currentCompany} canSwitch={canSwitchCompany} />
        {canSeeNotifications && <NotificationBell />}
        <button className="user-pill" onClick={() => setOpen((o) => !o)}>
          <span className="user-name">{label}</span>
          <div className="user-avatar">{initial}</div>
        </button>
        {open && (
          <div className="user-menu">
            {email && (
              <div
                className="user-menu-item"
                style={{ cursor: 'default', opacity: 0.7, fontSize: 12 }}
              >
                {email}
              </div>
            )}
            <button className="user-menu-item" onClick={handleLogout}>
              <LogOut size={14} /> Esci
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
