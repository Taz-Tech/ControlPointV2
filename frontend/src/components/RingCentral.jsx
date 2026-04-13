import { useState, useEffect, useContext, useCallback } from 'react'
import { UserContext } from '../App.jsx'
import { getRCPresence, updateRCPresence } from '../api/client.js'

// ── Status helpers ────────────────────────────────────────────────────────────

const STATUS_META = {
  Available: { dot: '#22c55e', bg: 'rgba(34,197,94,0.12)',  label: 'Available' },
  Busy:      { dot: '#f59e0b', bg: 'rgba(245,158,11,0.12)', label: 'Busy'      },
  'On Call': { dot: '#3b82f6', bg: 'rgba(59,130,246,0.12)', label: 'On Call'   },
  DND:       { dot: '#ef4444', bg: 'rgba(239,68,68,0.12)',  label: 'DND'       },
  Offline:   { dot: '#6b7280', bg: 'rgba(107,114,128,0.1)', label: 'Offline'   },
}

const STATUS_ORDER = ['Available', 'Busy', 'On Call', 'DND', 'Offline']

function StatusDot({ status, size = 10 }) {
  const meta = STATUS_META[status] || STATUS_META.Offline
  return (
    <span style={{
      display: 'inline-block',
      width: size, height: size,
      borderRadius: '50%',
      background: meta.dot,
      flexShrink: 0,
      boxShadow: status !== 'Offline' ? `0 0 0 2px ${meta.dot}33` : 'none',
    }} />
  )
}

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.Offline
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '2px 8px', borderRadius: 20,
      background: meta.bg,
      fontSize: '0.72rem', fontWeight: 600,
      color: meta.dot, whiteSpace: 'nowrap',
    }}>
      <StatusDot status={status} size={7} />
      {meta.label}
    </span>
  )
}

// ── User row ──────────────────────────────────────────────────────────────────

function UserRow({ user, canManage, onStatusChange }) {
  const [updating, setUpdating] = useState(false)
  const [err, setErr] = useState(null)

  const isDND = user.dnd_status === 'DoNotAcceptAnyCalls'

  const handleToggle = async () => {
    setErr(null)
    setUpdating(true)
    try {
      const newDnd = isDND ? 'TakeAllCalls' : 'DoNotAcceptAnyCalls'
      const newUser = isDND ? 'Available' : undefined
      await updateRCPresence(user.id, { dnd_status: newDnd, user_status: newUser })
      onStatusChange(user.id, {
        dnd_status: newDnd,
        status: isDND ? 'Available' : 'DND',
        status_color: isDND ? 'green' : 'red',
      })
    } catch (e) {
      setErr(e.response?.data?.detail || 'Failed to update')
    } finally {
      setUpdating(false)
    }
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '8px 12px',
      borderBottom: '1px solid var(--border)',
    }}>
      {/* Avatar */}
      <div style={{
        width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
        background: 'linear-gradient(135deg, var(--cyan), #818cf8)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '0.65rem', fontWeight: 700, color: '#000', position: 'relative',
      }}>
        {user.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?'}
        <span style={{
          position: 'absolute', bottom: -1, right: -1,
          width: 10, height: 10, borderRadius: '50%',
          background: STATUS_META[user.status]?.dot || '#6b7280',
          border: '1.5px solid var(--bg-elevated)',
        }} />
      </div>

      {/* Name + extension */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {user.name}
        </div>
        {user.extension && (
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>ext. {user.extension}</div>
        )}
      </div>

      {/* Status badge */}
      <StatusBadge status={user.status} />

      {/* Admin DND toggle */}
      {canManage && user.status !== 'Offline' && (
        <div style={{ flexShrink: 0 }}>
          {err && <span style={{ fontSize: '0.65rem', color: 'var(--danger)', marginRight: 6 }}>{err}</span>}
          <button
            className={isDND ? 'btn btn-ghost' : 'btn btn-danger'}
            style={{ fontSize: '0.7rem', padding: '3px 10px', opacity: updating ? 0.6 : 1 }}
            onClick={handleToggle}
            disabled={updating}
            title={isDND ? 'Clear DND — restore availability' : 'Set DND — block incoming calls'}
          >
            {updating ? '…' : isDND ? 'Clear DND' : 'Set DND'}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Department card ───────────────────────────────────────────────────────────

function DepartmentCard({ dept, canManage, onStatusChange, searchTerm, filterStatus }) {
  const [open, setOpen] = useState(true)

  const filtered = dept.users.filter(u => {
    const matchSearch = !searchTerm || u.name.toLowerCase().includes(searchTerm) || u.extension.includes(searchTerm)
    const matchStatus = !filterStatus || u.status === filterStatus
    return matchSearch && matchStatus
  })

  if (filtered.length === 0) return null

  const counts = filtered.reduce((acc, u) => {
    acc[u.status] = (acc[u.status] || 0) + 1
    return acc
  }, {})

  return (
    <div style={{
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
      marginBottom: 12,
    }}>
      {/* Department header */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 14px', background: 'none', border: 'none',
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginRight: 2 }}>
          {open ? '▾' : '▸'}
        </span>
        <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)', flex: 1 }}>
          {dept.name}
        </span>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginRight: 8 }}>
          {filtered.length} {filtered.length === 1 ? 'user' : 'users'}
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          {STATUS_ORDER.filter(s => counts[s]).map(s => (
            <span key={s} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: '0.68rem', color: STATUS_META[s].dot }}>
              <StatusDot status={s} size={7} />{counts[s]}
            </span>
          ))}
        </div>
      </button>

      {open && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          {filtered.map(user => (
            <UserRow
              key={user.id}
              user={user}
              canManage={canManage}
              onStatusChange={onStatusChange}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Stats bar ─────────────────────────────────────────────────────────────────

function StatsBar({ totals }) {
  const items = [
    { key: 'total',     label: 'Total',     color: 'var(--text-secondary)', dot: false },
    { key: 'available', label: 'Available', ...STATUS_META.Available,       dot: true  },
    { key: 'busy',      label: 'Busy',      ...STATUS_META.Busy,            dot: true  },
    { key: 'on_call',   label: 'On Call',   ...STATUS_META['On Call'],      dot: true  },
    { key: 'dnd',       label: 'DND',       ...STATUS_META.DND,             dot: true  },
    { key: 'offline',   label: 'Offline',   ...STATUS_META.Offline,         dot: true  },
  ]

  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: 12,
      padding: '12px 16px',
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)',
      marginBottom: 16,
    }}>
      {items.map(item => (
        <div key={item.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {item.dot && <StatusDot status={item.label} size={9} />}
          <span style={{ fontSize: '1rem', fontWeight: 700, color: item.dot ? item.dot : 'var(--text-primary)' }}>
            {totals[item.key] ?? 0}
          </span>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{item.label}</span>
        </div>
      ))}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function RingCentral() {
  const { isAdmin, rcPresenceAccess } = useContext(UserContext)
  const canManage = isAdmin || rcPresenceAccess

  const [data, setData]           = useState(null)       // { departments, totals }
  const [loading, setLoading]     = useState(true)
  const [err, setErr]             = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [searchTerm, setSearchTerm]   = useState('')
  const [filterStatus, setFilterStatus] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const r = await getRCPresence()
      setData(r.data)
      setLastUpdated(new Date())
    } catch (e) {
      const msg = e.response?.data?.detail || e.message || 'Failed to load presence data'
      setErr(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Auto-refresh every 30 seconds, paused when the tab is not visible
  useEffect(() => {
    let id = null

    const start = () => { if (!id) id = setInterval(load, 60_000) }
    const stop  = () => { clearInterval(id); id = null }

    const onVisibility = () => document.hidden ? stop() : start()

    if (!document.hidden) start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility) }
  }, [load])

  // Patch a single user's status in local state (after DND toggle)
  const handleStatusChange = useCallback((userId, patch) => {
    setData(prev => {
      if (!prev) return prev
      const departments = prev.departments.map(dept => ({
        ...dept,
        users: dept.users.map(u => u.id === userId ? { ...u, ...patch } : u),
      }))

      // Recompute totals
      const all = departments.flatMap(d => d.users)
      const totals = {
        total:     all.length,
        available: all.filter(u => u.status === 'Available').length,
        busy:      all.filter(u => u.status === 'Busy').length,
        on_call:   all.filter(u => u.status === 'On Call').length,
        dnd:       all.filter(u => u.status === 'DND').length,
        offline:   all.filter(u => u.status === 'Offline').length,
      }
      return { departments, totals }
    })
  }, [])

  const search = searchTerm.toLowerCase().trim()

  // ── Not configured ─────────────────────────────────────────────────────────
  if (!loading && err && err.includes('not configured')) {
    return (
      <div style={{ maxWidth: 520, margin: '60px auto', textAlign: 'center' }}>
        <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>📞</div>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: 8 }}>RingCentral Not Configured</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: 1.6 }}>
          Connect your RingCentral account in{' '}
          <strong>Settings → Integrations → RingCentral</strong> to enable presence monitoring.
        </p>
      </div>
    )
  }

  // ── No users linked ─────────────────────────────────────────────────────────
  if (!loading && data?.no_users_configured) {
    return (
      <div style={{ maxWidth: 520, margin: '60px auto', textAlign: 'center' }}>
        <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>📞</div>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: 8 }}>No RC Extensions Linked</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: 1.6 }}>
          No portal users have a RingCentral Extension ID assigned yet.
          Go to <strong>Settings → Users</strong>, edit a user, and enter their RC Extension ID.
        </p>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>

      {/* ── Toolbar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          className="input"
          placeholder="Search by name or extension…"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          style={{ flex: '1 1 200px', maxWidth: 280 }}
        />
        <select
          className="input"
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          style={{ width: 'auto' }}
        >
          <option value="">All statuses</option>
          {STATUS_ORDER.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <div style={{ flex: 1 }} />

        {lastUpdated && (
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            Updated {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
        <button
          className="btn btn-ghost"
          style={{ fontSize: '0.78rem' }}
          onClick={load}
          disabled={loading}
        >
          {loading ? '↻ Loading…' : '↻ Refresh'}
        </button>
      </div>

      {/* ── Error ── */}
      {err && !err.includes('not configured') && (
        <div className="alert alert-error" style={{ marginBottom: 16 }}>{err}</div>
      )}

      {/* ── Loading skeleton ── */}
      {loading && !data && (
        <div className="flex items-center gap-2" style={{ color: 'var(--text-secondary)', padding: '40px 0' }}>
          <div className="spinner" />
          <span className="text-sm">Loading presence data…</span>
        </div>
      )}

      {/* ── Data ── */}
      {data && (
        <>
          <StatsBar totals={data.totals} />

          {data.departments.length === 0 ? (
            <p className="text-sm text-muted">No users found.</p>
          ) : (
            data.departments.map(dept => (
              <DepartmentCard
                key={dept.name}
                dept={dept}
                canManage={canManage}
                onStatusChange={handleStatusChange}
                searchTerm={search}
                filterStatus={filterStatus}
              />
            ))
          )}
        </>
      )}
    </div>
  )
}
