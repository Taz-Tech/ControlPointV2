import { useState, createContext, useContext, useEffect, useRef, useCallback } from 'react'
import { subscribe as sseSubscribe } from './sse.js'
import { useMsal } from '@azure/msal-react'
import { api, getMyRCPresence, updateMyRCPresence, getAssetCustomers, getPortalUsers, getAllClientPortalUsers, getNotificationCount, markNotificationRead } from './api/client.js'
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
import Network from './components/Network.jsx'
import RCEmbeddable from './components/RCEmbeddable.jsx'
import TicketingWorkspace from './components/Ticketing/TicketingWorkspace.jsx'
import NewTicketModal from './components/Ticketing/NewTicketModal.jsx'
import ClientsWorkspace from './components/Clients/ClientsWorkspace.jsx'
import UserPortalView from './components/UserPortalView.jsx'
import NotificationPanel from './components/NotificationPanel.jsx'
import ProcurementWorkspace from './components/Procurement/ProcurementWorkspace.jsx'
import AssetWorkspace from './components/Assets/AssetWorkspace.jsx'

import { ClientContext } from './ClientContext.js'
export { ClientContext }

export const CredentialsContext = createContext(null)
export const UserContext = createContext({ role: 'user', isAdmin: false, rcPresenceAccess: false, permissions: [], hasPermission: () => false })

// ── Workspace + nav definitions ───────────────────────────────────────────────

const WORKSPACES = [
  {
    id: 'it', label: 'IT', icon: '⚙️', defaultPage: 'dashboard',
    groups: [
      { label: 'Overview', items: [
        { id: 'dashboard',  icon: '📊', label: 'Dashboard',       perm: null },
      ]},
      { label: 'People', items: [
        { id: 'users',      icon: '👤', label: 'User Lookup',      perm: 'nav.users'     },
        { id: 'mailboxes',  icon: '📬', label: 'Shared Mailboxes', perm: 'nav.mailboxes'  },
      ]},
      { label: 'Devices', items: [
        { id: 'devices',    icon: '💻', label: 'Device Search',    perm: 'nav.devices'    },
        { id: 'deployment', icon: '🛠️', label: 'Deployment',       perm: 'nav.deployment' },
      ]},
      { label: 'Comms', items: [
        { id: 'ringcentral', icon: '📞', label: 'RC Presence', perm: 'nav.ringcentral' },
      ]},
    ],
  },
  {
    id: 'network', label: 'Network', icon: '📡', defaultPage: 'network',
    groups: [
      { label: 'Network', items: [
        { id: 'network', icon: '🌐', label: 'Overview', perm: 'nav.network' },
      ]},
    ],
  },
  {
    id: 'facility', label: 'Facility', icon: '🏢', defaultPage: 'locations',
    groups: [
      { label: 'Facility', items: [
        { id: 'locations',        icon: '📍', label: 'Floor Maps',       perm: 'nav.locations'        },
        { id: 'conference_rooms', icon: '🗓️', label: 'Conference Rooms', perm: 'nav.conference_rooms' },
      ]},
    ],
  },
  {
    id: 'assets', label: 'Assets', icon: '📦', defaultPage: 'asset_inventory',
    groups: [
      { label: 'Inventory', items: [
        { id: 'asset_inventory',   icon: '📦', label: 'Asset Inventory',      perm: 'nav.assets' },
        { id: 'asset_integration', icon: '🔒', label: 'Integration Devices',  perm: 'nav.devices' },
      ]},
    ],
  },
  {
    id: 'ticketing', label: 'Ticketing', icon: '🎫', defaultPage: 'tkt_dashboard',
    groups: [
      { label: 'Overview', items: [
        { id: 'tkt_dashboard', icon: '📊', label: 'Dashboard'         },
      ]},
      { label: 'Work', items: [
        { id: 'tkt_tickets',   icon: '🎫', label: 'Tickets'           },
        { id: 'tkt_tasks',     icon: '✅', label: 'Tasks'             },
        { id: 'tkt_change',    icon: '🔄', label: 'Changes'           },
        { id: 'tkt_problems',  icon: '⚠️', label: 'Problems'          },
        { id: 'tkt_projects',  icon: '📁', label: 'Projects'          },
      ]},
      { label: 'Resources', items: [
        { id: 'tkt_kb',        icon: '📖', label: 'Knowledge Base'    },
      ]},
    ],
  },
  {
    id: 'procurement', label: 'Procurement', icon: '🛒', defaultPage: 'proc_contracts',
    groups: [
      { label: 'Procurement', items: [
        { id: 'proc_contracts',      icon: '📄', label: 'Contracts'       },
        { id: 'proc_purchase_orders', icon: '🛒', label: 'Purchase Orders' },
      ]},
    ],
  },
  {
    id: 'security', label: 'Security', icon: '🛡️', defaultPage: 'security',
    groups: [],
  },
]

// Which workspace owns each page (first match wins if page appears in multiple)
const PAGE_TO_WORKSPACE = {
  dashboard: 'it', users: 'it', mailboxes: 'it', devices: 'it', deployment: 'it', ringcentral: 'it',
  asset_inventory: 'assets', asset_integration: 'assets',
  network: 'network',
  locations: 'facility', conference_rooms: 'facility',
  tkt_dashboard: 'ticketing', tkt_tickets: 'ticketing', tkt_tasks: 'ticketing',
  tkt_change: 'ticketing', tkt_problems: 'ticketing', tkt_projects: 'ticketing', tkt_kb: 'ticketing',
  settings: 'it',
  proc_contracts: 'procurement', proc_purchase_orders: 'procurement',
  security: 'security',
}

// ── RC presence selector ──────────────────────────────────────────────────────

const RC_STATUS_OPTIONS = [
  { value: 'Available', label: 'Available',      dot: '#22c55e', body: { dnd_status: 'TakeAllCalls',        user_status: 'Available', label: 'Available' } },
  { value: 'Busy',      label: 'Busy',           dot: '#f59e0b', body: { dnd_status: 'TakeAllCalls',        user_status: 'Busy',      label: 'Busy'      } },
  { value: 'DND',       label: 'Do Not Disturb', dot: '#ef4444', body: { dnd_status: 'DoNotAcceptAnyCalls',                           label: 'DND'       } },
  { value: 'Lunch',     label: 'Lunch',          dot: '#ef4444', body: { dnd_status: 'DoNotAcceptAnyCalls',                           label: 'Lunch'     } },
  { value: 'Break',     label: 'Break',          dot: '#ef4444', body: { dnd_status: 'DoNotAcceptAnyCalls',                           label: 'Break'     } },
]

function RCStatusSelector({ hasExtension }) {
  const [status,   setStatus]   = useState(null)
  const [open,     setOpen]     = useState(false)
  const [updating, setUpdating] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!hasExtension) return
    getMyRCPresence().then(r => setStatus(r.data.status)).catch(() => setStatus('Offline'))
  }, [hasExtension])

  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  if (!hasExtension) return null

  const current = RC_STATUS_OPTIONS.find(o => o.value === status)
  const dot   = current?.dot || '#6b7280'
  const label = status === null ? '…' : (current?.label || status)

  const handleSelect = async (option) => {
    setOpen(false)
    const prev = status
    setUpdating(true)
    setStatus(option.value)
    try { await updateMyRCPresence(option.body) }
    catch { setStatus(prev) }
    finally { setUpdating(false) }
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        disabled={updating || status === null}
        className="ws-rc-btn"
      >
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flexShrink: 0,
          boxShadow: status && status !== 'Offline' ? `0 0 0 2px ${dot}33` : 'none' }} />
        {label}
        <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>▾</span>
      </button>

      {open && (
        <div className="ws-dropdown">
          <div className="ws-dropdown-header">RC Status</div>
          {RC_STATUS_OPTIONS.map(opt => (
            <button key={opt.value} onClick={() => handleSelect(opt)} className="ws-dropdown-item">
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: opt.dot, flexShrink: 0 }} />
              {opt.label}
              {status === opt.value && <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: 'var(--text-muted)' }}>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ClientSelector() {
  const { selectedClient, setSelectedClient } = useContext(ClientContext)
  const [clients, setClients] = useState([])
  const [open, setOpen]       = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    getAssetCustomers().then(r => setClients(r.data || [])).catch(() => {})
  }, [])

  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  if (clients.length === 0) return null

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="ws-rc-btn"
        style={selectedClient ? { background: 'var(--cyan)22', borderColor: 'var(--cyan)44', color: 'var(--cyan)' } : {}}
      >
        <span style={{ fontSize: '0.85rem' }}>🏢</span>
        <span style={{ maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selectedClient ? selectedClient.name : 'All Companies'}
        </span>
        {selectedClient && (
          <span
            style={{ fontSize: '0.65rem', color: 'var(--cyan)', background: 'var(--cyan)22', borderRadius: 4, padding: '1px 4px' }}
            onClick={e => { e.stopPropagation(); setSelectedClient(null) }}
            title="Clear filter"
          >✕</span>
        )}
        <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>▾</span>
      </button>

      {open && (
        <div className="ws-dropdown" style={{ right: 0, minWidth: 200 }}>
          <div className="ws-dropdown-header">Company Filter</div>
          <button
            className="ws-dropdown-item"
            onClick={() => { setSelectedClient(null); setOpen(false) }}
          >
            <span style={{ fontSize: '0.85rem' }}>🌐</span>
            View All
            {!selectedClient && <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: 'var(--text-muted)' }}>✓</span>}
          </button>
          <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
          {clients.map(c => (
            <button
              key={c.id}
              className="ws-dropdown-item"
              onClick={() => { setSelectedClient(c); setOpen(false) }}
            >
              <span style={{ fontSize: '0.85rem' }}>🏢</span>
              {c.name}
              {selectedClient?.id === c.id && <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: 'var(--text-muted)' }}>✓</span>}
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

const ROLE_LABELS = {
  admin: 'Admin', net_inf_team: 'Net/INF Team', service_desk: 'Service Desk',
  applications_team: 'Applications Team', network_viewer: 'Network Viewer', user: 'User',
}

function AssumeIdentityModal({ currentEmail, onAssume, onClose }) {
  const [staffUsers,  setStaffUsers]  = useState([])
  const [clientUsers, setClientUsers] = useState([])
  const [search,      setSearch]      = useState('')
  const [tab,         setTab]         = useState('staff')
  const [loading,     setLoading]     = useState(true)

  useEffect(() => {
    Promise.all([
      getPortalUsers().catch(() => ({ data: [] })),
      getAllClientPortalUsers().catch(() => ({ data: [] })),
    ]).then(([staffRes, clientRes]) => {
      setStaffUsers(staffRes.data || [])
      setClientUsers(clientRes.data || [])
    }).finally(() => setLoading(false))
  }, [])

  const q = search.trim().toLowerCase()
  const filteredStaff = staffUsers.filter(u =>
    u.email !== currentEmail &&
    (!q || u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q))
  )
  const filteredClients = clientUsers.filter(u =>
    !q || u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q) || u.customer_name?.toLowerCase().includes(q)
  )

  const list = tab === 'staff' ? filteredStaff : filteredClients

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 3000,
      background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        width: 500, maxHeight: '72vh', display: 'flex', flexDirection: 'column',
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)', overflow: 'hidden',
        boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
      }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>🎭 Assume Identity</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>View the system as another user</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: 'var(--text-muted)' }}>×</button>
        </div>

        {/* Tabs + search */}
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center' }}>
          {[['staff', 'Staff'], ['client', 'Client Users']].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} style={{
              padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600,
              background: tab === id ? 'var(--cyan-dim)' : 'transparent',
              color: tab === id ? 'var(--cyan)' : 'var(--text-muted)',
            }}>{label}</button>
          ))}
          <input
            className="input" autoFocus
            style={{ flex: 1, fontSize: '0.83rem', marginLeft: 4 }}
            placeholder="Search by name, email or company…"
            value={search} onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 16, color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              <div className="spinner" /> Loading users…
            </div>
          ) : list.length === 0 ? (
            <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: '0.85rem' }}>No users found.</div>
          ) : list.map(u => (
            <button key={u.id}
              onClick={() => onAssume({ name: u.name, email: u.email, role: u.role || 'user', customer_name: u.customer_name })}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                width: '100%', padding: '10px 12px', borderRadius: 8,
                background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <span style={{
                width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                background: 'var(--cyan-dim)', color: 'var(--cyan)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.75rem', fontWeight: 700,
              }}>
                {userInitials(u.name)}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name}</div>
                <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>
                  {u.email}
                  {u.customer_name && <span style={{ marginLeft: 6, color: 'var(--cyan)' }}>· {u.customer_name}</span>}
                </div>
              </div>
              <span style={{
                fontSize: '0.68rem', fontWeight: 600, padding: '2px 8px', borderRadius: 8, flexShrink: 0,
                background: u.role === 'admin' ? 'rgba(251,191,36,0.15)' : 'var(--bg-elevated)',
                color: u.role === 'admin' ? '#f59e0b' : 'var(--text-muted)',
              }}>
                {ROLE_LABELS[u.role] || (tab === 'client' ? (u.is_admin ? 'Client Admin' : 'Client User') : u.role)}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  const { instance, accounts } = useMsal()
  const msalAccount = accounts[0]

  const [branding,         setBranding]         = useState({ logoUrl: '', faviconUrl: '', iconUrl: '' })
  const [active,           setActive]           = useState(() => {
    const hash    = window.location.hash.replace('#', '').split('/')[0]
    const valid   = Object.keys(PAGE_TO_WORKSPACE).concat(['settings'])
    return valid.includes(hash) ? hash : 'dashboard'
  })
  const [activeDetailId,   setActiveDetailId]   = useState(() => {
    const parts = window.location.hash.replace('#', '').split('/')
    return parts.length > 1 ? parts.slice(1).join('/') : null
  })
  const [navData,          setNavData]          = useState(null)
  const [userRole,         setUserRole]         = useState('user')
  const [userType,         setUserType]         = useState(null)
  const [userProfile,      setUserProfile]      = useState({ name: '', email: '' })
  const [permissions,      setPermissions]      = useState([])
  const [rcExtensionId,    setRcExtensionId]    = useState('')
  const [rcPresenceAccess, setRcPresenceAccess] = useState(false)
  const [credentials,      setCredentials]      = useState(null)
  const [showCredModal,    setShowCredModal]    = useState(false)
  const [theme,            setTheme]            = useState(() => localStorage.getItem('theme') || 'dark')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [userMenuOpen,     setUserMenuOpen]     = useState(false)
  const [newTicketType,    setNewTicketType]    = useState(null)
  const [newTicketRefresh, setNewTicketRefresh] = useState(0)
  const [selectedClient,   setSelectedClient]   = useState(null)
  const [viewAsPortal,       setViewAsPortal]       = useState(false)
  const [assumedUser,        setAssumedUser]        = useState(null)
  const [showAssumeModal,    setShowAssumeModal]    = useState(false)
  const [appearancePos,      setAppearancePos]      = useState(null)
  const [notifCount,         setNotifCount]         = useState(0)
  const [showNotifPanel,     setShowNotifPanel]     = useState(false)
  const [notifOpenTicketId,  setNotifOpenTicketId]  = useState(null)
  const userMenuRef         = useRef(null)
  const appearanceRef       = useRef(null)
  const appearanceCloseTimer = useRef(null)

  const activeWorkspace = PAGE_TO_WORKSPACE[active] || null

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  useEffect(() => {
    api.get('/api/settings/config').then(r => {
      setBranding({ logoUrl: r.data.logoUrl || '', faviconUrl: r.data.faviconUrl || '', iconUrl: r.data.iconUrl || '' })
      if (r.data.faviconUrl) {
        let link = document.querySelector("link[rel~='icon']")
        if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link) }
        link.href = r.data.faviconUrl
      }
    }).catch(() => {})
  }, [])

  useEffect(() => {
    api.get('/api/settings/me').then(r => {
      setUserRole(r.data.role || 'user')
      setUserType(r.data.user_type || 'staff')
      setRcExtensionId(r.data.rc_extension_id || '')
      setRcPresenceAccess(!!r.data.rc_presence_access)
      setPermissions(r.data.permissions || [])
      const firstName = r.data.first_name || ''
      const lastName  = r.data.last_name  || ''
      setUserProfile({
        name:  (firstName + ' ' + lastName).trim() || r.data.email || 'User',
        email: r.data.email || '',
      })
    }).catch(() => {})
  }, [])

  // Close user menu on outside click
  useEffect(() => {
    if (!userMenuOpen) return
    const handler = (e) => { if (userMenuRef.current && !userMenuRef.current.contains(e.target)) setUserMenuOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [userMenuOpen])

  // Initial notification count fetch + fallback poll every 5 minutes
  useEffect(() => {
    if (!userProfile.email) return
    const poll = () => getNotificationCount().then(r => setNotifCount(r.data.unread || 0)).catch(() => {})
    poll()
    const id = setInterval(poll, 300000)
    return () => clearInterval(id)
  }, [userProfile.email])

  // Real-time SSE updates
  const [realtimeRefresh, setRealtimeRefresh] = useState(0)
  useEffect(() => {
    if (!userProfile.email) return
    return sseSubscribe((event) => {
      if (event.type === 'notification') {
        getNotificationCount().then(r => setNotifCount(r.data.unread || 0)).catch(() => {})
      }
      if (['ticket_created', 'ticket_updated', 'ticket_commented'].includes(event.type)) {
        setRealtimeRefresh(r => r + 1)
      }
    })
  }, [userProfile.email])

  // Sync state with browser back/forward button
  useEffect(() => {
    const onHashChange = () => {
      const raw   = window.location.hash.replace('#', '')
      const slash = raw.indexOf('/')
      const section  = slash === -1 ? raw : raw.slice(0, slash)
      const detailId = slash === -1 ? null : raw.slice(slash + 1)
      const valid = Object.keys(PAGE_TO_WORKSPACE).concat(['settings'])
      if (valid.includes(section)) {
        setActive(section)
        setActiveDetailId(detailId || null)
      }
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const navigate = (page, data = null) => {
    setNavData(data)
    setActive(page)
    setActiveDetailId(null)
    window.location.hash = page
  }

  const navigateDetail = (id) => {
    const idStr = id != null ? String(id) : null
    setActiveDetailId(idStr)
    window.location.hash = idStr ? `${active}/${idStr}` : active
  }

  const STAFF_ROLES_LIST = ['admin', 'net_inf_team', 'service_desk', 'applications_team', 'network_viewer']
  const effectiveRole    = assumedUser?.role ?? userRole
  const isAdmin      = effectiveRole === 'admin'
  const hasPermission = (perm) => isAdmin || permissions.includes(perm)

  const canSeeItem = (item) => {
    if (item.id === 'ringcentral') return isAdmin || rcPresenceAccess || permissions.includes('nav.ringcentral')
    if (!item.perm) return true
    return hasPermission(item.perm)
  }

  // Switch to a workspace — go to its default page
  const switchWorkspace = (ws) => {
    navigate(ws.defaultPage)
  }

  const currentWs = WORKSPACES.find(w => w.id === activeWorkspace)

  // Sidebar nav for the active workspace
  const sidebarGroups = currentWs
    ? currentWs.groups.map(g => ({ ...g, items: g.items.filter(canSeeItem) })).filter(g => g.items.length > 0)
    : []

  // Route real non-staff users to portal (never triggers when assuming)
  if (!assumedUser && !viewAsPortal && userType !== null && (userType === 'portal' || !STAFF_ROLES_LIST.includes(userRole))) {
    const signOut = () => { sessionStorage.removeItem('portal_token'); window.location.reload() }
    return <UserPortalView userProfile={userProfile} userType={userType} onSignOut={signOut} />
  }

  return (
    <ClientContext.Provider value={{ selectedClient, setSelectedClient }}>
    <UserContext.Provider value={{ role: effectiveRole, isAdmin, rcPresenceAccess, permissions, hasPermission }}>
    <CredentialsContext.Provider value={{ credentials, setCredentials, showCredModal, setShowCredModal }}>
      <div className="app-shell">

        {/* ── Portal overlay: View Portal OR assuming a non-staff (client) user ── */}
        {(viewAsPortal || (assumedUser && !STAFF_ROLES_LIST.includes(assumedUser.role || ''))) ? (
          <>
            <div style={{
              flexShrink: 0, background: 'linear-gradient(90deg, #7c3aed, #2563eb)',
              color: '#fff', display: 'flex', alignItems: 'center', gap: 10,
              padding: '6px 16px', fontSize: '0.8rem', fontWeight: 500,
            }}>
              <span>
                {assumedUser
                  ? <>🎭 Viewing as <strong>{assumedUser.name}</strong>{assumedUser.customer_name ? ` · ${assumedUser.customer_name}` : ''}</>
                  : '👤 Portal preview mode'}
              </span>
              <button onClick={() => { setViewAsPortal(false); setAssumedUser(null) }}
                style={{ marginLeft: 'auto', background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer', padding: '3px 12px', fontWeight: 600 }}>
                Exit
              </button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              <UserPortalView
                userProfile={assumedUser ? { name: assumedUser.name, email: assumedUser.email } : userProfile}
                userType="portal"
                onSignOut={() => { setViewAsPortal(false); setAssumedUser(null) }}
              />
            </div>
          </>
        ) : (
        /* ── Normal admin view (assumed staff user gets a banner) ── */
        <>
        {assumedUser && (
          <div style={{
            flexShrink: 0, background: 'linear-gradient(90deg, #7c3aed, #2563eb)',
            color: '#fff', display: 'flex', alignItems: 'center', gap: 10,
            padding: '5px 16px', fontSize: '0.78rem', fontWeight: 500,
          }}>
            <span>🎭 Viewing as <strong>{assumedUser.name}</strong> ({ROLE_LABELS[assumedUser.role] || assumedUser.role})</span>
            <button onClick={() => setAssumedUser(null)}
              style={{ marginLeft: 'auto', background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer', padding: '2px 10px', fontWeight: 600 }}>
              Exit
            </button>
          </div>
        )}

        {/* ── Workspace header ── */}
        <header className="workspace-header">
          {/* Logo — width matches sidebar so nav items below line up */}
          <div
            className={`ws-logo${sidebarCollapsed ? ' collapsed' : ''}`}
            onClick={() => setSidebarCollapsed(c => !c)}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {(branding.iconUrl || branding.logoUrl)
              ? <img src={branding.iconUrl || branding.logoUrl} alt="Logo" style={{ width: 22, height: 22, objectFit: 'contain', borderRadius: 3, flexShrink: 0 }} />
              : <span className="ws-logo-icon">⚡</span>}
            {!sidebarCollapsed && (
              <span className="ws-logo-text">Control<span style={{ color: 'var(--cyan)' }}>Point</span></span>
            )}
          </div>

          {/* Workspace tabs */}
          <nav className="ws-tabs">
            {WORKSPACES.map(ws => (
              <button
                key={ws.id}
                className={`ws-tab${activeWorkspace === ws.id ? ' active' : ''}`}
                onClick={() => switchWorkspace(ws)}
              >
                <span className="ws-tab-icon">{ws.icon}</span>
                <span className="ws-tab-label">{ws.label}</span>
              </button>
            ))}
          </nav>

          {/* Right controls */}
          <div className="ws-right">
            <ClientSelector />
            <RCStatusSelector hasExtension={!!rcExtensionId} />

            {/* Notification bell */}
            <button
              style={{
                position: 'relative', background: 'none', border: '1px solid var(--border)',
                borderRadius: 'var(--radius)', cursor: 'pointer', padding: '5px 10px',
                color: 'var(--text-muted)', fontSize: '1rem', lineHeight: 1,
                display: 'flex', alignItems: 'center',
              }}
              onClick={() => setShowNotifPanel(p => !p)}
              title="Notifications"
            >
              🔔
              {notifCount > 0 && (
                <span style={{
                  position: 'absolute', top: -4, right: -4,
                  background: 'var(--cyan)', color: '#000',
                  borderRadius: 8, padding: '1px 5px',
                  fontSize: '0.6rem', fontWeight: 700, lineHeight: 1.4,
                  minWidth: 16, textAlign: 'center',
                }}>
                  {notifCount > 99 ? '99+' : notifCount}
                </span>
              )}
            </button>

            {/* New button — opens type picker */}
            <button
              className="btn btn-primary"
              style={{ fontSize: '0.8rem', padding: '5px 14px' }}
              onClick={() => setNewTicketType(true)}
            >
              + New
            </button>

          </div>
        </header>

        {/* ── Body: sidebar + content ── */}
        <div className="app-body">

          {/* Sidebar */}
          {currentWs && (
            <aside className={`sidebar${sidebarCollapsed ? ' collapsed' : ''}`}>
              {/* Workspace label */}
              <div className="sidebar-ws-label">
                <span className="sidebar-ws-icon">{currentWs.icon}</span>
                <span className="sidebar-ws-name">{currentWs.label}</span>
              </div>

              <nav className="sidebar-nav">
                {sidebarGroups.map(group => (
                  <div key={group.label}>
                    <div className="nav-label">{group.label}</div>
                    {group.items.map(item => (
                      <div
                        key={item.id}
                        className={`nav-item${active === item.id ? ' active' : ''}`}
                        onClick={() => navigate(item.id)}
                      >
                        <span className="nav-item-dot" />
                        <span className="nav-item-label">{item.label}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </nav>

              {/* User profile — bottom of sidebar */}
              <div ref={userMenuRef} className="sidebar-user">
                <button
                  className={`sidebar-user-btn${sidebarCollapsed ? ' collapsed' : ''}`}
                  onClick={() => { setUserMenuOpen(o => !o); setAppearancePos(null) }}
                  title={userProfile.name}
                >
                  <span className="sidebar-user-avatar">{userInitials(userProfile.name)}</span>
                  {!sidebarCollapsed && (
                    <span className="sidebar-user-info">
                      <span className="sidebar-user-name">{userProfile.name || 'User'}</span>
                      <span className="sidebar-user-email">{userProfile.email}</span>
                    </span>
                  )}
                </button>
                {userMenuOpen && (
                  <div className="sidebar-user-menu">
                    <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)' }}>{userProfile.name || 'User'}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>{userProfile.email}</div>
                    </div>

                    <button className="ws-dropdown-item" onClick={() => { setUserMenuOpen(false); navigate('settings') }}>
                      ⚙️ Settings
                    </button>

                    {/* Appearance — fixed flyout to escape sidebar overflow:hidden */}
                    <button ref={appearanceRef} className="ws-dropdown-item"
                      style={{ justifyContent: 'space-between' }}
                      onMouseEnter={() => {
                        clearTimeout(appearanceCloseTimer.current)
                        const r = appearanceRef.current?.getBoundingClientRect()
                        if (r) setAppearancePos({ top: r.top, left: r.right + 6 })
                      }}
                      onMouseLeave={() => {
                        appearanceCloseTimer.current = setTimeout(() => setAppearancePos(null), 200)
                      }}>
                      <span>🎨 Appearance</span>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: 8 }}>›</span>
                    </button>

                    <button className="ws-dropdown-item"
                      onClick={() => { setUserMenuOpen(false); setViewAsPortal(true) }}>
                      👤 View Portal
                    </button>

                    {isAdmin && (
                      <button className="ws-dropdown-item"
                        onClick={() => { setUserMenuOpen(false); setShowAssumeModal(true) }}>
                        🎭 Assume Identity
                      </button>
                    )}

                    <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />

                    <button className="ws-dropdown-item" style={{ color: 'var(--red)' }}
                      onClick={() => {
                        sessionStorage.removeItem('portal_token')
                        if (msalAccount) instance.logoutRedirect({ postLogoutRedirectUri: window.location.origin })
                        else window.location.reload()
                      }}>
                      ⇥ Sign out
                    </button>
                  </div>
                )}
              </div>
            </aside>
          )}

          {/* Main content */}
          <div className="main-content" style={(active === 'locations' || active === 'settings' || activeWorkspace === 'ticketing' || activeWorkspace === 'procurement' || activeWorkspace === 'assets') ? { overflow: 'hidden' } : {}}>

            {active === 'locations' && <Locations />}

            {active === 'settings' && <Settings theme={theme} setTheme={setTheme} />}

            {activeWorkspace === 'ticketing' && <TicketingWorkspace section={active.replace('tkt_', '')} onNavigate={navigate} externalRefresh={newTicketRefresh + realtimeRefresh} openTicketId={notifOpenTicketId} activeDetailId={activeDetailId} onNavigateDetail={navigateDetail} />}

            {activeWorkspace === 'procurement' && <ProcurementWorkspace section={active.replace('proc_', '')} onNavigate={navigate} activeDetailId={activeDetailId} onNavigateDetail={navigateDetail} />}

            {activeWorkspace === 'assets' && <AssetWorkspace section={active} activeDetailId={activeDetailId} onNavigateDetail={navigateDetail} />}

            {active !== 'locations' && active !== 'settings' && activeWorkspace !== 'ticketing' && activeWorkspace !== 'procurement' && activeWorkspace !== 'assets' && (
              <div className="page-body">
                {active === 'dashboard'        && <Dashboard navigateTo={navigate} />}
                {active === 'users'            && <UserLookup initialUser={navData} activeDetailId={activeDetailId} onNavigateDetail={navigateDetail} />}
                {active === 'devices'          && <DeviceSearch />}
                {active === 'network'          && <Network />}
                {active === 'conference_rooms' && <ConferenceRooms />}
                {active === 'mailboxes'        && <SharedMailboxLookup />}
                {active === 'deployment'       && <DeploymentTools />}
                {active === 'ringcentral'      && (isAdmin || rcPresenceAccess) && <RingCentral />}
                {active === 'security'         && (
                  <div style={{ color: 'var(--text-secondary)', padding: 40 }}>Security workspace — coming soon</div>
                )}
              </div>
            )}
          </div>
        </div>

        {newTicketType && (
          <NewTicketModal
            defaultType={typeof newTicketType === 'string' ? newTicketType : undefined}
            onClose={() => setNewTicketType(null)}
            onCreated={() => { setNewTicketType(null); setNewTicketRefresh(r => r + 1) }}
          />
        )}

        {showAssumeModal && (
          <AssumeIdentityModal
            currentEmail={userProfile.email}
            onAssume={(u) => { setAssumedUser(u); setShowAssumeModal(false) }}
            onClose={() => setShowAssumeModal(false)}
          />
        )}

        {showCredModal && (
          <SwitchCredentialsModal
            onClose={() => setShowCredModal(false)}
            onSave={(creds) => { setCredentials(creds); setShowCredModal(false) }}
          />
        )}

        {showNotifPanel && (
          <NotificationPanel
            onClose={() => setShowNotifPanel(false)}
            onNavigateTicket={(ticketId) => { navigate('tkt_tickets'); setNotifOpenTicketId(ticketId); setShowNotifPanel(false); setTimeout(() => { window.location.hash = `tkt_tickets/${ticketId}` }, 0) }}
          />
        )}

        <RCEmbeddable />

        {/* Appearance flyout — fixed to escape sidebar overflow:hidden */}
        {appearancePos && (
          <div
            style={{
              position: 'fixed', top: appearancePos.top, left: appearancePos.left,
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
              padding: 8, zIndex: 2000, minWidth: 190,
            }}
            onMouseEnter={() => {
              clearTimeout(appearanceCloseTimer.current)
            }}
            onMouseLeave={() => {
              appearanceCloseTimer.current = setTimeout(() => setAppearancePos(null), 200)
            }}>
            <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '2px 8px 8px' }}>
              Theme
            </div>
            {[
              { id: 'dark',       label: 'Dark',       bg: '#0d1117', accent: '#21d4fd' },
              { id: 'light',      label: 'Light',      bg: '#f0f2f5', accent: '#0891b2' },
              { id: 'cyberpunk',  label: 'Cyberpunk',  bg: '#08000f', accent: '#ff006e' },
              { id: 'night-city', label: 'Night City', bg: '#080808', accent: '#ffe600' },
            ].map(t => (
              <button key={t.id}
                onClick={() => { setTheme(t.id); setAppearancePos(null); setUserMenuOpen(false) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '7px 10px', width: '100%', borderRadius: 6,
                  background: theme === t.id ? 'var(--cyan-dim)' : 'transparent',
                  border: 'none', cursor: 'pointer', color: 'var(--text-primary)',
                  fontSize: '0.82rem', textAlign: 'left',
                }}>
                <span style={{
                  width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                  background: t.bg, border: `2px solid ${t.accent}`,
                }} />
                {t.label}
                {theme === t.id && <span style={{ marginLeft: 'auto', color: 'var(--cyan)', fontSize: '0.72rem' }}>✓</span>}
              </button>
            ))}
          </div>
        )}
        </>
        )}
      </div>
    </CredentialsContext.Provider>
    </UserContext.Provider>
    </ClientContext.Provider>
  )
}
