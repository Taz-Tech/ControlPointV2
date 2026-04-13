import { useState, createContext, useEffect, useCallback, useRef } from 'react'
import { useMsal } from '@azure/msal-react'
import { api, getBranding, getMyRCPresence, updateMyRCPresence } from './api/client.js'
import Dashboard from './components/Dashboard.jsx'
import UserLookup from './components/UserLookup.jsx'
import DeploymentTools from './components/DeploymentTools.jsx'
import DeviceSearch from './components/DeviceSearch.jsx'
import SwitchCredentialsModal from './components/SwitchCredentialsModal.jsx'
import Settings from './components/Settings.jsx'
import ConferenceRooms from './components/ConferenceRooms.jsx'
import SharedMailboxLookup from './components/SharedMailboxLookup.jsx'
import RingCentral from './components/RingCentral.jsx'
import Locations from './components/Locations.jsx'

export const CredentialsContext = createContext(null)
export const UserContext = createContext({ role: 'user', isAdmin: false, rcPresenceAccess: false })

const NAV_ITEMS = [
  { id: 'dashboard',        icon: '📊', label: 'Dashboard',         group: 'Overview' },
  { id: 'users',            icon: '👤', label: 'User Lookup',       group: 'Tools' },
  { id: 'devices',          icon: '💻', label: 'Device Search',     group: 'Tools' },
  { id: 'conference_rooms', icon: '🏢', label: 'Conference Rooms',  group: 'Tools' },
  { id: 'locations',        icon: '📍', label: 'Locations',         group: 'Tools' },
  { id: 'mailboxes',        icon: '📬', label: 'Shared Mailboxes',  group: 'Tools' },
  { id: 'deployment',       icon: '🛠️', label: 'Deployment Tools',  group: 'Tools'  },
  { id: 'ringcentral',      icon: '📞', label: 'RC Presence',        group: 'Comms'  },
]

// ── RC presence status selector ───────────────────────────────────────────────

const RC_STATUS_OPTIONS = [
  { value: 'Available', label: 'Available',      dot: '#22c55e', body: { dnd_status: 'TakeAllCalls',          user_status: 'Available' } },
  { value: 'Busy',      label: 'Busy',           dot: '#f59e0b', body: { dnd_status: 'TakeAllCalls',          user_status: 'Busy'      } },
  { value: 'DND',       label: 'Do Not Disturb', dot: '#ef4444', body: { dnd_status: 'DoNotAcceptAnyCalls'                             } },
]

function RCStatusSelector({ hasExtension }) {
  const [status,   setStatus]   = useState(null)   // null = loading / not fetched
  const [open,     setOpen]     = useState(false)
  const [updating, setUpdating] = useState(false)
  const [err,      setErr]      = useState(null)
  const ref = useRef(null)

  useEffect(() => {
    if (!hasExtension) return
    getMyRCPresence()
      .then(r => setStatus(r.data.status))
      .catch(() => setStatus('Offline'))
  }, [hasExtension])

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  if (!hasExtension) return null

  const current = RC_STATUS_OPTIONS.find(o => o.value === status)
  const dot  = current?.dot  || '#6b7280'
  const label = status === null ? 'Loading…' : (current?.label || status)

  const handleSelect = async (option) => {
    setOpen(false)
    setErr(null)
    setUpdating(true)
    const prev = status
    setStatus(option.value)   // optimistic
    try {
      await updateMyRCPresence(option.body)
    } catch {
      setStatus(prev)
      setErr('Failed to update')
    } finally {
      setUpdating(false)
    }
  }

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={() => setOpen(o => !o)}
        disabled={updating || status === null}
        style={{
          display: 'flex', alignItems: 'center', gap: 7,
          padding: '5px 12px', borderRadius: 'var(--radius-sm)',
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          cursor: updating || status === null ? 'default' : 'pointer',
          fontSize: '0.78rem', fontWeight: 500, color: 'var(--text-primary)',
          opacity: updating ? 0.7 : 1,
        }}
        title="Change your RingCentral availability"
      >
        <span style={{ width: 9, height: 9, borderRadius: '50%', background: dot, flexShrink: 0,
          boxShadow: status && status !== 'Offline' ? `0 0 0 2px ${dot}33` : 'none' }} />
        <span>📞 {label}</span>
        <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginLeft: 2 }}>▾</span>
      </button>

      {err && (
        <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 4px)',
          background: 'var(--danger, #ef4444)', color: '#fff',
          fontSize: '0.7rem', padding: '3px 8px', borderRadius: 4, whiteSpace: 'nowrap', zIndex: 200 }}>
          {err}
        </div>
      )}

      {open && (
        <div style={{
          position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 200,
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)', boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
          minWidth: 170, overflow: 'hidden',
        }}>
          <div style={{ padding: '6px 10px 4px', fontSize: '0.65rem', fontWeight: 600,
            color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Your RC Status
          </div>
          {RC_STATUS_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => handleSelect(opt)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 12px', background: status === opt.value ? 'var(--bg-surface)' : 'none',
                border: 'none', cursor: 'pointer', fontSize: '0.82rem',
                color: 'var(--text-primary)', textAlign: 'left',
              }}
            >
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: opt.dot, flexShrink: 0 }} />
              {opt.label}
              {status === opt.value && <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: 'var(--text-muted)' }}>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function userInitials(name = '') {
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?'
}

export default function App() {
  const { instance, accounts } = useMsal()
  const account = accounts[0]

  const [branding, setBranding] = useState({ logoUrl: '', faviconUrl: '', iconUrl: '' })

  useEffect(() => {
    // Use config (authenticated) so all three branding fields come back together
    api.get('/api/settings/config').then(r => {
      setBranding({ logoUrl: r.data.logoUrl || '', faviconUrl: r.data.faviconUrl || '', iconUrl: r.data.iconUrl || '' })
      if (r.data.faviconUrl) {
        let link = document.querySelector("link[rel~='icon']")
        if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link) }
        link.href = r.data.faviconUrl
      }
    }).catch(() => {})
  }, [])

  const [active, setActive]               = useState(() => {
    const hash = window.location.hash.replace('#', '')
    const valid = NAV_ITEMS.map(n => n.id).concat(['settings', 'ringcentral'])
    return valid.includes(hash) ? hash : 'dashboard'
  })
  const [navData, setNavData]             = useState(null)
  const [userRole, setUserRole]               = useState('user')
  const [rcExtensionId, setRcExtensionId]     = useState('')
  const [rcPresenceAccess, setRcPresenceAccess] = useState(false)
  const [credentials, setCredentials]     = useState(null)
  const [showCredModal, setShowCredModal] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  const toggleTheme = useCallback(() => setTheme(t => t === 'dark' ? 'light' : 'dark'), [])

  useEffect(() => {
    api.get('/api/settings/me').then(r => {
      setUserRole(r.data.role || 'user')
      setRcExtensionId(r.data.rc_extension_id || '')
      setRcPresenceAccess(!!r.data.rc_presence_access)
    }).catch(() => {})
  }, [])

  const navigate = (page, data = null) => {
    setNavData(data)
    setActive(page)
    window.location.hash = page
  }

  const handleSignOut = () => {
    instance.logoutRedirect({ postLogoutRedirectUri: window.location.origin })
  }

  const isAdmin = userRole === 'admin'

  return (
    <UserContext.Provider value={{ role: userRole, isAdmin, rcPresenceAccess }}>
    <CredentialsContext.Provider value={{ credentials, setCredentials, showCredModal, setShowCredModal }}>
      <div className="app-shell">
        {/* ── Sidebar ── */}
        <aside className={`sidebar${sidebarCollapsed ? ' collapsed' : ''}`}>
          <div className="sidebar-logo">
            <div className="logo-badge">
              {(branding.iconUrl || branding.logoUrl)
                ? <img src={branding.iconUrl || branding.logoUrl} alt="Logo" style={{ width: 32, height: 32, objectFit: 'contain', borderRadius: 4, flexShrink: 0 }} />
                : <div className="logo-icon">⚡</div>}
              <div className="logo-text-wrap">
                <div className="logo-text">Control<br/>Point</div>
              </div>
            </div>
            <button
              className="sidebar-collapse-btn"
              onClick={() => setSidebarCollapsed(c => !c)}
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {sidebarCollapsed ? '›' : '‹'}
            </button>
          </div>

          <nav className="sidebar-nav">
            {['Overview', 'Tools', 'Comms'].map(group => {
              const canSee = (item) => {
                if (item.id === 'ringcentral') return isAdmin || rcPresenceAccess
                return true
              }
              const items = NAV_ITEMS.filter(n => n.group === group && canSee(n))
              if (items.length === 0) return null
              return (
                <div key={group}>
                  <div className="nav-label">{group}</div>
                  {items.map(item => (
                    <div
                      key={item.id}
                      id={`nav-${item.id}`}
                      className={`nav-item${active === item.id ? ' active' : ''}`}
                      onClick={() => navigate(item.id)}
                    >
                      <span className="nav-icon">{item.icon}</span>
                      <span className="nav-item-label">{item.label}</span>
                    </div>
                  ))}
                </div>
              )
            })}
          </nav>

          {/* ── Settings + User footer ── */}
          <div style={{ marginTop: 'auto' }}>
            {/* Theme toggle + Settings */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '0 8px 4px' }}>
              <div
                className={`nav-item${active === 'settings' ? ' active' : ''}`}
                style={{ flex: 1, margin: 0 }}
                onClick={() => navigate('settings')}
              >
                <span className="nav-icon">⚙️</span>
                <span className="nav-item-label">Settings</span>
              </div>
              {!sidebarCollapsed && (
                <button className="theme-toggle" onClick={toggleTheme} title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
                  {theme === 'dark' ? '☀️' : '🌙'}
                </button>
              )}
            </div>
            {sidebarCollapsed && (
              <div style={{ display: 'flex', justifyContent: 'center', margin: '0 0 4px' }}>
                <button className="theme-toggle" onClick={toggleTheme} title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
                  {theme === 'dark' ? '☀️' : '🌙'}
                </button>
              </div>
            )}

            {/* Signed-in user */}
            {account && (
              <div style={{
                padding: '12px 16px',
                borderTop: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}>
                <div style={{
                  width: 32, height: 32, borderRadius: '50%',
                  background: 'linear-gradient(135deg, var(--cyan), #818cf8)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.7rem', fontWeight: 700, color: '#000',
                  flexShrink: 0,
                }}>
                  {userInitials(account.name)}
                </div>
                {!sidebarCollapsed && (
                  <>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {account.name}
                      </div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {account.username}
                      </div>
                    </div>
                    <button
                      title="Sign out"
                      onClick={handleSignOut}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: 'var(--text-muted)', fontSize: '0.85rem', padding: 4,
                        flexShrink: 0,
                      }}
                    >
                      ⇥
                    </button>
                  </>
                )}
              </div>
            )}

            <div className="sidebar-footer">ControlPoint v1.0</div>
          </div>
        </aside>

        {/* ── Main ── */}
        <div className="main-content" style={active === 'locations' ? { overflow: 'hidden' } : {}}>
          <header className="main-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h1>
              {active === 'settings'
                ? '⚙️ Settings'
                : `${NAV_ITEMS.find(n => n.id === active)?.icon} ${NAV_ITEMS.find(n => n.id === active)?.label}`}
            </h1>
            <RCStatusSelector hasExtension={!!rcExtensionId} />
          </header>

          {/* Locations gets its own full-height layout — no page-body padding */}
          {active === 'locations' && <Locations />}

          {active !== 'locations' && (
            <div className="page-body">
              {active === 'dashboard'        && <Dashboard navigateTo={navigate} />}
              {active === 'users'            && <UserLookup initialUser={navData} />}
              {active === 'devices'          && <DeviceSearch />}
              {active === 'conference_rooms' && <ConferenceRooms />}
              {active === 'mailboxes'        && <SharedMailboxLookup />}
              {active === 'deployment'       && <DeploymentTools />}
              {active === 'ringcentral'      && (isAdmin || rcPresenceAccess) && <RingCentral />}
              {active === 'settings'         && <Settings />}
            </div>
          )}
        </div>

        {showCredModal && (
          <SwitchCredentialsModal
            onClose={() => setShowCredModal(false)}
            onSave={(creds) => { setCredentials(creds); setShowCredModal(false) }}
          />
        )}

      </div>
    </CredentialsContext.Provider>
    </UserContext.Provider>
  )
}
