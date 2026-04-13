import { useState, useRef, useCallback, useEffect } from 'react'
import { searchUsers, getUserDetail, getUserTickets, getUserMailboxMemberships, getUserComputers } from '../api/client.js'
import { saveRecentLookup } from './Dashboard.jsx'
import DeviceDetailModal from './DeviceDetailModal.jsx'

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function formatRelativeTime(isoString) {
  if (!isoString) return null
  const date = new Date(isoString)
  if (isNaN(date)) return isoString
  const diff = Date.now() - date.getTime()
  const mins  = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days  = Math.floor(diff / 86400000)
  if (mins < 60)  return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 30)  return `${days}d ago`
  return date.toLocaleDateString()
}

function avatarColor(name = '') {
  const colors = [
    ['#21d4fd','#000'], ['#3fb950','#000'], ['#bc8cff','#000'],
    ['#ff8c00','#000'], ['#f85149','#fff'], ['#5eead4','#000'],
  ]
  const idx = (name.charCodeAt(0) || 0) % colors.length
  return colors[idx]
}

function Avatar({ name, size = 40 }) {
  const initials = name ? name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() : '?'
  const [bg, fg] = avatarColor(name)
  return (
    <div className="avatar" style={{ width: size, height: size, background: bg, color: fg, fontSize: size * 0.35 }}>
      {initials}
    </div>
  )
}

function InfoRow({ icon, label, value, mono }) {
  return (
    <div className="flex" style={{ marginBottom: 8, gap: 8, alignItems: 'flex-start' }}>
      <span style={{ fontSize: '0.85rem', flexShrink: 0, width: 18 }}>{icon}</span>
      <span className="text-muted text-sm" style={{ flexShrink: 0, width: 72 }}>{label}</span>
      <span className={`text-sm${mono ? ' font-mono' : ''}`} style={{ wordBreak: 'break-all' }}>{value}</span>
    </div>
  )
}

/* ── Ticket status / priority colours ───────────────────────────────────── */

const STATUS_CLASS = {
  Open:                  'ticket-status-open',
  Pending:               'ticket-status-pending',
  'Waiting on Customer': 'ticket-status-pending',
  'Waiting on Third Party': 'ticket-status-pending',
  Resolved:              'ticket-status-resolved',
  Closed:                'ticket-status-closed',
}

const PRIORITY_CLASS = {
  Low:    'ticket-priority-low',
  Medium: 'ticket-priority-medium',
  High:   'ticket-priority-high',
  Urgent: 'ticket-priority-urgent',
}

function TicketRow({ ticket }) {
  const statusCls  = STATUS_CLASS[ticket.status]  || 'ticket-status-open'
  const priorityCls = PRIORITY_CLASS[ticket.priority] || 'ticket-priority-low'
  const date = ticket.created_at ? new Date(ticket.created_at).toLocaleDateString() : '—'

  return (
    <a
      href={ticket.url}
      target="_blank"
      rel="noreferrer"
      className="ticket-row"
      title={`Open ticket #${ticket.id} in Freshservice`}
    >
      <div className="ticket-subject" style={{ flex: 1, minWidth: 0 }}>
        <span className="text-sm" style={{ display: 'block', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {ticket.subject}
        </span>
        <span className="text-xs text-muted">#{ticket.id} · {date}</span>
      </div>
      <div className="flex items-center gap-2" style={{ flexShrink: 0 }}>
        <span className={`ticket-badge ${priorityCls}`}>{ticket.priority}</span>
        <span className={`ticket-badge ${statusCls}`}>{ticket.status}</span>
      </div>
    </a>
  )
}

/* ── Account Actions panel ───────────────────────────────────────────────── */

function AccountActionsPanel({ user }) {
  if (!user) return null

  const isDisabled = user.accountEnabled === false

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header">
        <div className="flex items-center gap-2">
          <span style={{ fontSize: '1rem' }}>🔐</span>
          <h3>Account Actions</h3>
        </div>
        <span className="badge badge-yellow">Pending Migration</span>
      </div>
      <div className="card-body">
        <div className="alert alert-warn" style={{ marginBottom: 16, fontSize: '0.8rem', lineHeight: 1.5 }}>
          These actions will be available once account management migrates from Okta to Microsoft 365 (planned November 2026).
        </div>

        {/* Reset Password */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 14px',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          marginBottom: 8,
        }}>
          <div>
            <div style={{ fontSize: '0.88rem', fontWeight: 600 }}>Reset Password</div>
            <div className="text-xs text-muted" style={{ marginTop: 2 }}>
              Force a password reset on next sign-in
            </div>
          </div>
          <button className="btn btn-danger" style={{ fontSize: '0.8rem', opacity: 0.45, cursor: 'not-allowed' }} disabled>
            Reset
          </button>
        </div>

        {/* Unlock Account */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 14px',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
        }}>
          <div>
            <div style={{ fontSize: '0.88rem', fontWeight: 600 }}>Unlock Account</div>
            <div className="text-xs text-muted" style={{ marginTop: 2 }}>
              Clear sign-in block and reset failed attempts
            </div>
          </div>
          <button className="btn btn-primary" style={{ fontSize: '0.8rem', opacity: 0.45, cursor: 'not-allowed' }} disabled>
            Unlock
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Freshservice panel ──────────────────────────────────────────────────── */

function FreshservicePanel({ email }) {
  const [tickets, setTickets]   = useState(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)
  const lastEmail               = useRef(null)

  // Fetch whenever email changes
  if (email && email !== lastEmail.current) {
    lastEmail.current = email
    setLoading(true)
    setTickets(null)
    setError(null)
    getUserTickets(email)
      .then(r => setTickets(r.data.tickets || []))
      .catch(e => setError(e.response?.data?.detail || 'Failed to load tickets'))
      .finally(() => setLoading(false))
  }

  const open   = tickets?.filter(t => !['Resolved','Closed'].includes(t.status)) || []
  const closed = tickets?.filter(t =>  ['Resolved','Closed'].includes(t.status)) || []

  return (
    <div className="card" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="card-header">
        <div className="flex items-center gap-2">
          <span style={{ fontSize: '1rem' }}>🎫</span>
          <h3>Freshservice Tickets</h3>
          {tickets && (
            <span className="badge badge-gray" style={{ marginLeft: 4 }}>{tickets.length}</span>
          )}
        </div>
        <span className="badge badge-cyan">Freshservice</span>
      </div>

      <div className="card-body" style={{ flex: 1, overflowY: 'auto' }}>
        {!email && (
          <div className="fs-empty-state">
            <span style={{ fontSize: '2rem' }}>🔍</span>
            <p className="text-sm text-muted" style={{ marginTop: 8 }}>Select a user to view their tickets</p>
          </div>
        )}

        {email && loading && (
          <div className="flex items-center gap-3" style={{ color: 'var(--text-secondary)', padding: '32px 0' }}>
            <div className="spinner" />
            <span className="text-sm">Loading tickets…</span>
          </div>
        )}

        {error && (
          <div className="alert alert-error">{error}</div>
        )}

        {tickets && !loading && (
          <>
            {tickets.length === 0 && (
              <div className="fs-empty-state">
                <span style={{ fontSize: '2rem' }}>✅</span>
                <p className="text-sm text-muted" style={{ marginTop: 8 }}>No tickets found for this user</p>
              </div>
            )}

            {open.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div className="ticket-section-label">Open / In Progress <span className="badge badge-gray">{open.length}</span></div>
                {open.map(t => <TicketRow key={t.id} ticket={t} />)}
              </div>
            )}

            {closed.length > 0 && (
              <div>
                <div className="ticket-section-label">Resolved / Closed <span className="badge badge-gray">{closed.length}</span></div>
                {closed.map(t => <TicketRow key={t.id} ticket={t} />)}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/* ── User detail card ────────────────────────────────────────────────────── */

function UserDetailCard({ user }) {
  const [mailboxes, setMailboxes]           = useState(null)
  const [mailboxLoading, setMailboxLoading] = useState(true)
  const [computers, setComputers]           = useState(null)
  const [computersLoading, setComputersLoading] = useState(true)
  const [deviceModal, setDeviceModal]       = useState(null) // device name string

  const email = user.mail || user.userPrincipalName

  useEffect(() => {
    setMailboxLoading(true)
    getUserMailboxMemberships(user.id)
      .then(r => setMailboxes(r.data.mailboxes || []))
      .catch(() => setMailboxes([]))
      .finally(() => setMailboxLoading(false))
  }, [user.id])

  useEffect(() => {
    if (!email) { setComputers([]); setComputersLoading(false); return }
    setComputersLoading(true)
    getUserComputers(email)
      .then(r => setComputers(r.data.computers || []))
      .catch(() => setComputers([]))
      .finally(() => setComputersLoading(false))
  }, [email])

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <div className="card-header">
        <div className="flex items-center gap-3">
          <Avatar name={user.displayName} size={52} />
          <div>
            <h2 style={{ fontSize: '1.1rem' }}>{user.displayName}</h2>
            <div className="text-sm text-muted">{user.jobTitle || 'No title'} · {user.department || 'No dept'}</div>
          </div>
        </div>
        <span className={`badge ${user.accountEnabled ? 'badge-green' : 'badge-red'}`}>
          {user.accountEnabled ? '● Active' : '● Disabled'}
        </span>
      </div>
      <div className="card-body">
        <div className="grid-2" style={{ gap: 24 }}>
          <div>
            <h4 style={{ marginBottom: 10, color: 'var(--text-secondary)' }}>Contact</h4>
            <InfoRow icon="📧" label="Email"    value={user.mail || user.userPrincipalName || '—'} mono />
            <InfoRow icon="📱" label="Mobile"   value={user.mobilePhone || '—'} />
            <InfoRow icon="📞" label="Phone"    value={(user.businessPhones || []).join(', ') || '—'} />
            <InfoRow icon="🏢" label="Office"   value={user.officeLocation || '—'} />
            <InfoRow icon="📍" label="Address"  value={[user.streetAddress, user.city, user.state, user.postalCode, user.country].filter(Boolean).join(', ') || '—'} />
            <InfoRow icon="🌍" label="Usage Location" value={user.usageLocation || '—'} />
          </div>
          <div>
            <h4 style={{ marginBottom: 10, color: 'var(--text-secondary)' }}>Account</h4>
            <InfoRow icon="🏷️" label="Employee ID"   value={user.employeeId || '—'} />
            <InfoRow icon="👤" label="Employee Type" value={user.employeeType || '—'} />
            <InfoRow icon="🏦" label="Company"       value={user.companyName || '—'} />
            <InfoRow icon="🔑" label="UPN"           value={user.userPrincipalName || '—'} mono />
            <InfoRow icon="🆔" label="Object ID"     value={user.id?.slice(0, 18) + '…' || '—'} mono />
            {user.signInActivity && (
              <InfoRow icon="🕐" label="Last Sign-In"
                value={user.signInActivity.lastSignInDateTime
                  ? new Date(user.signInActivity.lastSignInDateTime).toLocaleString()
                  : 'Never'} />
            )}
          </div>
        </div>

        {/* Manager & Direct Reports */}
        {(user.manager || user.directReports?.length > 0) && (
          <>
            <div className="divider" />
            <div className="grid-2" style={{ gap: 24 }}>
              {user.manager && (
                <div>
                  <h4 style={{ marginBottom: 10, color: 'var(--text-secondary)' }}>👔 Manager</h4>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 12px', background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                  }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                      background: 'linear-gradient(135deg, var(--cyan), #818cf8)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '0.7rem', fontWeight: 700, color: '#000',
                    }}>
                      {(user.manager.displayName || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{user.manager.displayName}</div>
                      <div className="text-xs text-muted">{user.manager.jobTitle || user.manager.mail}</div>
                    </div>
                  </div>
                </div>
              )}
              {user.directReports?.length > 0 && (
                <div>
                  <h4 style={{ marginBottom: 10, color: 'var(--text-secondary)' }}>
                    👥 Direct Reports <span className="badge badge-gray" style={{ marginLeft: 4 }}>{user.directReports.length}</span>
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {user.directReports.map(r => (
                      <div key={r.id} style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '8px 12px', background: 'var(--bg-elevated)',
                        border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                      }}>
                        <div style={{
                          width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                          background: 'linear-gradient(135deg, var(--purple), #818cf8)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '0.65rem', fontWeight: 700, color: '#fff',
                        }}>
                          {(r.displayName || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 500, fontSize: '0.82rem' }}>{r.displayName}</div>
                          <div className="text-xs text-muted">{r.jobTitle || r.mail}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* Shared Mailboxes */}
        <div className="divider" />
        <h4 style={{ marginBottom: 10, color: 'var(--text-secondary)' }}>
          📬 Shared Mailboxes
          {!mailboxLoading && mailboxes !== null && (
            <span className="badge badge-gray" style={{ marginLeft: 8 }}>{mailboxes.length}</span>
          )}
        </h4>
        {mailboxLoading && (
          <div className="flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
            <div className="spinner" /><span className="text-sm">Loading…</span>
          </div>
        )}
        {!mailboxLoading && mailboxes?.length === 0 && (
          <p className="text-sm text-muted">No shared mailboxes found for this user</p>
        )}
        {!mailboxLoading && mailboxes?.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {mailboxes.map(mb => (
              <div key={mb.id} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '7px 10px',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
              }}>
                <span style={{ fontSize: '1rem' }}>📬</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '0.82rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mb.displayName}</div>
                  <div className="text-xs text-muted">{mb.mail}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ImmyBot Devices */}
        <div className="divider" />
        <h4 style={{ marginBottom: 10, color: 'var(--text-secondary)' }}>
          💻 Devices
          {!computersLoading && computers !== null && (
            <span className="badge badge-gray" style={{ marginLeft: 8 }}>{computers.length}</span>
          )}
        </h4>
        {computersLoading && (
          <div className="flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
            <div className="spinner" /><span className="text-sm">Loading…</span>
          </div>
        )}
        {!computersLoading && computers?.length === 0 && (
          <p className="text-sm text-muted">No devices found in ImmyBot</p>
        )}
        {!computersLoading && computers?.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {computers.map(c => (
              <div key={c.id} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 10px',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                transition: 'var(--transition)',
              }}
              onClick={() => setDeviceModal(c.name)}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--border-accent)'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
              >
                <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>🖥️</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{c.name}</span>
                    <span style={{
                      fontSize: '0.7rem', fontWeight: 600, padding: '1px 6px',
                      borderRadius: 20,
                      background: c.isOnline ? 'rgba(63,185,80,0.15)' : 'rgba(139,148,158,0.15)',
                      color: c.isOnline ? '#3fb950' : '#8b949e',
                    }}>
                      {c.isOnline ? '● Online' : '● Offline'}
                    </span>
                  </div>
                  <div className="text-xs text-muted" style={{ marginTop: 2 }}>
                    {[c.manufacturer, c.model].filter(Boolean).join(' ')}
                    {c.operatingSystem && ` · ${c.operatingSystem}`}
                  </div>
                  {c.serialNumber && <div className="text-xs text-muted">S/N: {c.serialNumber}</div>}
                  {c.lastBootTime && <div className="text-xs text-muted">Last reboot: {formatRelativeTime(c.lastBootTime)}</div>}
                </div>
                {c.immybotUrl && (
                  <a href={c.immybotUrl} target="_blank" rel="noreferrer"
                    className="btn btn-ghost"
                    style={{ fontSize: '0.75rem', padding: '4px 10px', flexShrink: 0, textDecoration: 'none' }}
                    title="Open in ImmyBot">
                    Open in ImmyBot ↗
                  </a>
                )}
              </div>
            ))}
          </div>
        )}

        {user.licenses?.length > 0 && (
          <>
            <div className="divider" />
            <h4 style={{ marginBottom: 10, color: 'var(--text-secondary)' }}>Licenses</h4>
            <div className="flex" style={{ gap: 8, flexWrap: 'wrap' }}>
              {user.licenses.map((l, i) => <span key={i} className="badge badge-purple">{l}</span>)}
            </div>
          </>
        )}

        {user.groups?.length > 0 && (
          <>
            <div className="divider" />
            <h4 style={{ marginBottom: 10, color: 'var(--text-secondary)' }}>
              Groups <span className="badge badge-gray">{user.groups.length}</span>
            </h4>
            <div style={{ maxHeight: 150, overflowY: 'auto', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {user.groups.map((g, i) => <span key={i} className="badge badge-gray">{g}</span>)}
            </div>
          </>
        )}
      </div>

      {deviceModal && (
        <DeviceDetailModal deviceName={deviceModal} onClose={() => setDeviceModal(null)} />
      )}
    </div>
  )
}

/* ── Main component ──────────────────────────────────────────────────────── */

export default function UserLookup({ initialUser = null }) {
  const [query, setQuery]         = useState('')
  const [results, setResults]     = useState([])
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(null)
  const [selected, setSelected]   = useState(null)
  const [detail, setDetail]       = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const debounceRef = useRef(null)

  useEffect(() => {
    if (initialUser) handleSelectUser(initialUser)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = useCallback((val) => {
    setQuery(val)
    setError(null)
    clearTimeout(debounceRef.current)
    if (!val.trim()) { setResults([]); return }
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await searchUsers(val.trim())
        setResults(res.data.users || [])
      } catch (e) {
        setError(e.response?.data?.detail || 'Search failed — check Azure credentials in backend .env')
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 400)
  }, [])

  const handleSelectUser = async (user) => {
    setSelected(user.id)
    setResults([])        // hide other results once a user is chosen
    setDetail(null)
    setDetailLoading(true)
    try {
      const res = await getUserDetail(user.id)
      setDetail(res.data)
      saveRecentLookup(res.data)
    } catch {
      saveRecentLookup(user)
      setDetail(user)
    } finally {
      setDetailLoading(false)
    }
  }

  const selectedEmail = detail?.mail || detail?.userPrincipalName || null

  return (
    <div className={selected ? 'user-lookup-layout' : ''}>
      {/* ── LEFT COLUMN ─────────────────────────────────────────── */}
      <div className="user-lookup-left">
        {/* Search card */}
        <div className="card">
          <div className="card-header">
            <h3>Search Active Directory</h3>
            <span className="badge badge-cyan">Microsoft Graph</span>
          </div>
          <div className="card-body">
            <div className="search-bar">
              <span className="search-icon">🔍</span>
              <input
                id="user-search-input"
                className="input"
                placeholder="Search by name, email, or UPN…"
                value={query}
                onChange={e => handleSearch(e.target.value)}
                autoComplete="off"
              />
            </div>

            {error && (
              <div className="alert alert-error mt-3">⚠️ {error}</div>
            )}

            {loading && (
              <div className="flex items-center gap-3 mt-4" style={{ color: 'var(--text-secondary)' }}>
                <div className="spinner" />
                <span className="text-sm">Searching Active Directory…</span>
              </div>
            )}

            {!loading && results.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div className="text-xs text-muted" style={{ marginBottom: 8 }}>{results.length} result(s)</div>
                {results.map(user => (
                  <div
                    key={user.id}
                    id={`user-result-${user.id}`}
                    className={`user-result-item${selected === user.id ? ' selected' : ''}`}
                    onClick={() => handleSelectUser(user)}
                  >
                    <Avatar name={user.displayName} />
                    <div>
                      <div style={{ fontWeight: 500 }}>{user.displayName}</div>
                      <div className="text-xs text-muted">{user.mail || user.userPrincipalName}</div>
                    </div>
                    <div className="ml-auto text-xs text-muted">{user.jobTitle}</div>
                  </div>
                ))}
              </div>
            )}

            {!loading && query && results.length === 0 && !error && (
              <div className="text-sm text-muted mt-4" style={{ textAlign: 'center', padding: 32 }}>
                No users found for "{query}"
              </div>
            )}
          </div>
        </div>

        {/* User detail card */}
        {detailLoading && (
          <div className="flex items-center gap-3 mt-4" style={{ color: 'var(--text-secondary)' }}>
            <div className="spinner" /> <span className="text-sm">Loading user details…</span>
          </div>
        )}
        {detail && !detailLoading && <UserDetailCard user={detail} />}
      </div>

      {/* ── RIGHT COLUMN — only shown after a user is selected ── */}
      {selected && (
        <div className="user-lookup-right">
          <AccountActionsPanel user={detail} />
          <FreshservicePanel email={selectedEmail} />
        </div>
      )}
    </div>
  )
}
