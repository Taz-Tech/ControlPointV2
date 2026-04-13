import { useState, useEffect, useRef, useContext } from 'react'
import {
  getFreshserviceStats, getFreshserviceAlerts, getFreshserviceProblems,
  getMyTickets, getUnassignedTickets,
  getImmybotStats,
  getShortcuts, getBookmarks, createBookmark, deleteBookmark,
} from '../api/client.js'
import { UserContext } from '../App.jsx'

const RECENT_LOOKUPS_KEY = 'it_portal_recent_lookups'
const MAX_RECENT = 6

export function saveRecentLookup(user) {
  try {
    const existing = JSON.parse(localStorage.getItem(RECENT_LOOKUPS_KEY) || '[]')
    const filtered = existing.filter(u => u.id !== user.id)
    const updated  = [user, ...filtered].slice(0, MAX_RECENT)
    localStorage.setItem(RECENT_LOOKUPS_KEY, JSON.stringify(updated))
  } catch { /* ignore */ }
}

/* ── Stat Card ───────────────────────────────────────────────────────────── */

function StatCard({ icon, label, value, sub, color = 'var(--cyan)', loading, error, onClick }) {
  return (
    <div
      className="card dash-stat-card"
      onClick={onClick}
      style={{ cursor: onClick ? 'pointer' : undefined, transition: 'var(--transition)' }}
      onMouseEnter={e => { if (onClick) e.currentTarget.style.borderColor = color }}
      onMouseLeave={e => { if (onClick) e.currentTarget.style.borderColor = '' }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 'var(--radius-sm)',
          background: `${color}22`, border: `1px solid ${color}44`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '1.2rem', flexShrink: 0,
        }}>
          {icon}
        </div>
        {error && <span style={{ fontSize: '0.65rem', color: 'var(--red)' }}>error</span>}
        {onClick && !loading && !error && <span style={{ fontSize: '0.65rem', color }}>View →</span>}
      </div>
      {loading ? (
        <div className="spinner" style={{ marginBottom: 8 }} />
      ) : (
        <div style={{ fontSize: '2rem', fontWeight: 700, color, lineHeight: 1 }}>{value ?? '—'}</div>
      )}
      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 6 }}>{label}</div>
      {sub && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

/* ── My Tickets Drawer ───────────────────────────────────────────────────── */

const STATUS_CLASS = {
  'Open':                   'ticket-status-open',
  'Pending':                'ticket-status-pending',
  'Waiting on Customer':    'ticket-status-pending',
  'Waiting on Third Party': 'ticket-status-pending',
  'Resolved':               'ticket-status-resolved',
  'Closed':                 'ticket-status-closed',
}

const PRIORITY_CLASS = {
  'Low':    'ticket-priority-low',
  'Medium': 'ticket-priority-medium',
  'High':   'ticket-priority-high',
  'Urgent': 'ticket-priority-high',
}

function MyTicketsDrawer({ onClose, mode = 'mine' }) {
  const [tickets,  setTickets]  = useState([])
  const [loading,  setLoading]  = useState(true)
  const [err,      setErr]      = useState(null)

  const isMine = mode === 'mine'

  useEffect(() => {
    const fetch = isMine ? getMyTickets : getUnassignedTickets
    fetch()
      .then(r => setTickets(r.data.tickets || []))
      .catch(() => setErr('Failed to load tickets'))
      .finally(() => setLoading(false))
  }, [])

  const fmt = (iso) => {
    if (!iso) return '—'
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 1500,
          background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)',
          animation: 'fadeIn 0.15s ease',
        }}
      />
      {/* Drawer */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 1600,
        width: 520, maxWidth: '95vw',
        background: 'var(--bg-surface)',
        borderLeft: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column',
        boxShadow: '-8px 0 40px rgba(0,0,0,0.3)',
        animation: 'slideInRight 0.2s ease',
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 24px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: '1.1rem' }}>{isMine ? '🎫' : '⏳'}</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: '1rem' }}>{isMine ? 'My Open Tickets' : 'Unassigned Tickets'}</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{isMine ? 'Assigned to me · not resolved or closed' : 'No agent assigned · not resolved or closed'}</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.2rem', padding: 4 }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
          {loading && (
            <div className="flex items-center gap-2" style={{ color: 'var(--text-secondary)', padding: '32px 0' }}>
              <div className="spinner" /><span className="text-sm">Loading tickets…</span>
            </div>
          )}
          {err && <div className="alert alert-error">{err}</div>}
          {!loading && !err && tickets.length === 0 && (
            <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>{isMine ? '🎉' : '✅'}</div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>{isMine ? 'No open tickets' : 'No unassigned tickets'}</div>
              <div style={{ fontSize: '0.82rem' }}>{isMine ? "You're all caught up!" : 'All tickets have been assigned.'}</div>
            </div>
          )}
          {!loading && tickets.map(t => (
            <a
              key={t.id}
              href={t.url}
              target="_blank"
              rel="noreferrer"
              style={{ textDecoration: 'none', display: 'block', marginBottom: 10 }}
            >
              <div style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                padding: '14px 16px',
                transition: 'var(--transition)',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--cyan)'; e.currentTarget.style.background = 'rgba(33,212,253,0.04)' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--bg-elevated)' }}
              >
                {/* Subject + ID */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-primary)', lineHeight: 1.4, flex: 1 }}>
                    {t.subject}
                  </div>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
                    #{t.id}
                  </span>
                </div>

                {/* Badges + meta */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span className={`ticket-badge ${STATUS_CLASS[t.status] || 'ticket-status-open'}`}>{t.status}</span>
                  <span className={`ticket-badge ${PRIORITY_CLASS[t.priority] || 'ticket-priority-low'}`}>{t.priority}</span>
                  {t.requester_name && (
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      👤 {t.requester_name}
                    </span>
                  )}
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                    Updated {fmt(t.updated_at)}
                  </span>
                </div>
              </div>
            </a>
          ))}
        </div>

        {/* Footer */}
        {!loading && tickets.length > 0 && (
          <div style={{ padding: '12px 24px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center' }}>
              {tickets.length} {isMine ? 'open ticket' : 'unassigned ticket'}{tickets.length !== 1 ? 's' : ''}
              {isMine ? ' assigned to you' : ''}
            </div>
          </div>
        )}
      </div>
    </>
  )
}

/* ── Drag-to-reorder helpers ─────────────────────────────────────────────── */

function loadOrder(key) {
  try { return JSON.parse(localStorage.getItem(key) || '[]') } catch { return [] }
}

function saveOrder(items, key) {
  localStorage.setItem(key, JSON.stringify(items.map(i => i.id)))
}

function applyOrder(items, key) {
  const order = loadOrder(key)
  if (!order.length) return items
  const map = new Map(order.map((id, i) => [String(id), i]))
  return [...items].sort((a, b) => {
    const ai = map.has(String(a.id)) ? map.get(String(a.id)) : 9999
    const bi = map.has(String(b.id)) ? map.get(String(b.id)) : 9999
    return ai - bi
  })
}

function DraggableLinksGrid({ items, onReorder, renderTile }) {
  const dragIdx = useRef(null)
  const [overIdx, setOverIdx] = useState(null)

  const onDragStart = (e, idx) => {
    dragIdx.current = idx
    e.dataTransfer.effectAllowed = 'move'
  }
  const onDragOver = (e, idx) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setOverIdx(idx)
  }
  const onDrop = (e, idx) => {
    e.preventDefault()
    const from = dragIdx.current
    if (from === null || from === idx) { setOverIdx(null); return }
    const next = [...items]
    const [moved] = next.splice(from, 1)
    next.splice(idx, 0, moved)
    dragIdx.current = null
    setOverIdx(null)
    onReorder(next)
  }
  const onDragEnd = () => { dragIdx.current = null; setOverIdx(null) }

  return (
    <div className="dash-links-grid">
      {items.map((item, idx) => (
        <div
          key={item.id}
          draggable
          onDragStart={e => onDragStart(e, idx)}
          onDragOver={e => onDragOver(e, idx)}
          onDrop={e => onDrop(e, idx)}
          onDragEnd={onDragEnd}
          style={{
            opacity:      dragIdx.current === idx ? 0.35 : 1,
            outline:      overIdx === idx && dragIdx.current !== idx ? '2px dashed var(--cyan)' : 'none',
            outlineOffset: 2,
            borderRadius: 'var(--radius-md)',
            cursor:       'grab',
            transition:   'opacity 0.15s',
          }}
        >
          {renderTile(item)}
        </div>
      ))}
    </div>
  )
}

/* ── Link tile (shortcuts + bookmarks) ───────────────────────────────────── */

function LinkIcon({ icon }) {
  if (icon && (icon.startsWith('/') || icon.startsWith('http'))) {
    return <img src={icon} alt="" style={{ width: 28, height: 28, objectFit: 'contain', borderRadius: 4 }} />
  }
  return <span style={{ fontSize: '1.4rem', lineHeight: 1 }}>{icon || '🔗'}</span>
}

function LinkTile({ icon, name, url, description, onDelete }) {
  return (
    <div className="dash-link-tile">
      <a href={url} target="_blank" rel="noreferrer" className="dash-link-tile-inner" title={description || name}>
        <LinkIcon icon={icon} />
        <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {name}
        </span>
      </a>
      {onDelete && (
        <button className="dash-link-delete" onClick={onDelete} title="Remove bookmark">✕</button>
      )}
    </div>
  )
}

/* ── Add bookmark modal ──────────────────────────────────────────────────── */

function AddBookmarkModal({ onClose, onSave }) {
  const [form, setForm] = useState({ name: '', url: '', icon: '🔖', description: '' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  const handleSave = async () => {
    if (!form.name.trim() || !form.url.trim()) { setErr('Name and URL are required'); return }
    let url = form.url.trim()
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url
    setSaving(true)
    try {
      await onSave({ ...form, url })
      onClose()
    } catch {
      setErr('Failed to save bookmark')
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2 style={{ marginBottom: 4 }}>Add Bookmark</h2>
        <p>Save a site to your personal dashboard.</p>
        {err && <div className="alert alert-error" style={{ marginBottom: 12 }}>{err}</div>}
        <div className="form-row">
          <div className="form-group" style={{ flex: '0 0 64px' }}>
            <label>Icon</label>
            <input className="input" value={form.icon} maxLength={2} style={{ textAlign: 'center', fontSize: '1.2rem' }}
              onChange={e => setForm(f => ({ ...f, icon: e.target.value }))} />
          </div>
          <div className="form-group" style={{ flex: 1 }}>
            <label>Name</label>
            <input className="input" placeholder="Azure Portal" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
        </div>
        <div className="form-group">
          <label>URL</label>
          <input className="input" placeholder="https://portal.azure.com" value={form.url}
            onChange={e => setForm(f => ({ ...f, url: e.target.value }))} />
        </div>
        <div className="form-group">
          <label>Description <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span></label>
          <input className="input" placeholder="Short description" value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
        </div>
        <div className="flex gap-3 mt-4" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save Bookmark'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Problems Drawer ─────────────────────────────────────────────────────── */

const SEVERITY_COLOR = {
  'Critical': 'var(--red)',
  'Error':    'var(--orange, #f97316)',
  'Warning':  'var(--yellow)',
  'OK':       'var(--green)',
}

function AlertsDrawer({ alerts, onClose }) {
  const fmt = (iso) => {
    if (!iso) return '—'
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 1500,
          background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)',
          animation: 'fadeIn 0.15s ease',
        }}
      />
      {/* Drawer */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 1600,
        width: 520, maxWidth: '95vw',
        background: 'var(--bg-surface)',
        borderLeft: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column',
        boxShadow: '-8px 0 40px rgba(0,0,0,0.3)',
        animation: 'slideInRight 0.2s ease',
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 24px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: '1.1rem' }}>🔔</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: '1rem' }}>Freshservice Alerts</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Open · not resolved</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.2rem', padding: 4 }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
          {alerts.length === 0 && (
            <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>✅</div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>No open alerts</div>
              <div style={{ fontSize: '0.82rem' }}>All alerts have been resolved.</div>
            </div>
          )}
          {alerts.map(a => (
            <a
              key={a.id}
              href={a.url}
              target="_blank"
              rel="noreferrer"
              style={{ textDecoration: 'none', display: 'block', marginBottom: 10 }}
            >
              <div style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderLeft: `3px solid ${SEVERITY_COLOR[a.severity] || 'var(--border)'}`,
                borderRadius: 'var(--radius-md)',
                padding: '14px 16px',
                transition: 'var(--transition)',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--cyan)'; e.currentTarget.style.background = 'rgba(33,212,253,0.04)' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--bg-elevated)' }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-primary)', lineHeight: 1.4, flex: 1 }}>
                    {a.title}
                  </div>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
                    #{a.id}
                  </span>
                </div>
                {a.resource && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 6 }}>
                    Resource: {a.resource}
                  </div>
                )}
                {a.description && (
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {a.description}
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span className="ticket-badge ticket-status-open">{a.state}</span>
                  {a.severity && (
                    <span style={{ fontSize: '0.72rem', fontWeight: 600, color: SEVERITY_COLOR[a.severity] || 'var(--text-muted)' }}>
                      {a.severity}
                    </span>
                  )}
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                    Updated {fmt(a.updated_at)}
                  </span>
                </div>
              </div>
            </a>
          ))}
        </div>

        {/* Footer */}
        {alerts.length > 0 && (
          <div style={{ padding: '12px 24px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center' }}>
              {alerts.length} open alert{alerts.length !== 1 ? 's' : ''}
            </div>
          </div>
        )}
      </div>
    </>
  )
}

const PRIORITY_COLOR = {
  'Urgent': 'var(--red)',
  'High':   'var(--orange, #f97316)',
  'Medium': 'var(--yellow)',
  'Low':    'var(--text-secondary)',
}

/* ── Problems Drawer ─────────────────────────────────────────────────────── */

function ProblemsDrawer({ fsProblems, onClose }) {
  const fmt = (iso) => {
    if (!iso) return '—'
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  }

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 1500,
          background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)',
          animation: 'fadeIn 0.15s ease',
        }}
      />
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 1600,
        width: 520, maxWidth: '95vw',
        background: 'var(--bg-surface)',
        borderLeft: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column',
        boxShadow: '-8px 0 40px rgba(0,0,0,0.3)',
        animation: 'slideInRight 0.2s ease',
      }}>
        <div style={{
          padding: '20px 24px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: '1.1rem' }}>🔴</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: '1rem' }}>Open Problems</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Open · not resolved or closed</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.2rem', padding: 4 }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
          {fsProblems.length === 0 && (
            <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>✅</div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>No open problems</div>
              <div style={{ fontSize: '0.82rem' }}>All problems have been closed.</div>
            </div>
          )}
          {fsProblems.map(p => (
            <a
              key={p.id}
              href={p.url}
              target="_blank"
              rel="noreferrer"
              style={{ textDecoration: 'none', display: 'block', marginBottom: 10 }}
            >
              <div style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderLeft: `3px solid ${PRIORITY_COLOR[p.priority] || 'var(--border)'}`,
                borderRadius: 'var(--radius-md)',
                padding: '14px 16px',
                transition: 'var(--transition)',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--cyan)'; e.currentTarget.style.background = 'rgba(33,212,253,0.04)' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--bg-elevated)' }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-primary)', lineHeight: 1.4, flex: 1 }}>
                    {p.title}
                  </div>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
                    #{p.id}
                  </span>
                </div>
                {p.description && (
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.description}
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span className="ticket-badge ticket-status-open">{p.status}</span>
                  {p.priority && (
                    <span style={{ fontSize: '0.72rem', fontWeight: 600, color: PRIORITY_COLOR[p.priority] || 'var(--text-muted)' }}>
                      {p.priority}
                    </span>
                  )}
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                    Updated {fmt(p.updated_at)}
                  </span>
                </div>
              </div>
            </a>
          ))}
        </div>

        {fsProblems.length > 0 && (
          <div style={{ padding: '12px 24px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center' }}>
              {fsProblems.length} open problem{fsProblems.length !== 1 ? 's' : ''}
            </div>
          </div>
        )}
      </div>
    </>
  )
}


const ALERTS_ROLES = new Set(['admin', 'service_desk', 'net_inf_team'])

/* ── Main Dashboard ──────────────────────────────────────────────────────── */

export default function Dashboard({ navigateTo }) {
  const { role } = useContext(UserContext)
  const showAlerts = ALERTS_ROLES.has(role)

  const [fsStats,  setFsStats]  = useState(null)
  const [fsErr,    setFsErr]    = useState(false)
  const [fsLoad,   setFsLoad]   = useState(true)

  const [imStats,  setImStats]  = useState(null)
  const [imErr,    setImErr]    = useState(false)
  const [imLoad,   setImLoad]   = useState(true)

  const [problems,    setProblems]    = useState([])
  const [probErr,     setProbErr]     = useState(false)
  const [probLoad,    setProbLoad]    = useState(true)

  const [fsProblems,  setFsProblems]  = useState([])
  const [fsProbErr,   setFsProbErr]   = useState(false)
  const [fsProbLoad,  setFsProbLoad]  = useState(true)

  const [shortcuts,    setShortcuts]    = useState([])
  const [bookmarks,    setBookmarks]    = useState([])
  const [orderedShortcuts, setOrderedShortcuts] = useState([])
  const [orderedBookmarks, setOrderedBookmarks] = useState([])
  const [recentUsers,  setRecentUsers]  = useState([])
  const [showAddBM,       setShowAddBM]       = useState(false)
  const [showTickets,     setShowTickets]     = useState(false)
  const [showUnassigned,  setShowUnassigned]  = useState(false)
  const [showProblems,    setShowProblems]    = useState(false)
  const [showFsProblems,  setShowFsProblems]  = useState(false)


  useEffect(() => {
    getFreshserviceStats()
      .then(r => setFsStats(r.data))
      .catch(() => setFsErr(true))
      .finally(() => setFsLoad(false))

    getImmybotStats()
      .then(r => setImStats(r.data))
      .catch(() => setImErr(true))
      .finally(() => setImLoad(false))

    getShortcuts().then(r => { setShortcuts(r.data); setOrderedShortcuts(applyOrder(r.data, 'shortcut_order')) }).catch(() => {})
    getBookmarks().then(r => { setBookmarks(r.data); setOrderedBookmarks(applyOrder(r.data, 'bookmark_order')) }).catch(() => {})

    try {
      setRecentUsers(JSON.parse(localStorage.getItem('it_portal_recent_lookups') || '[]'))
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    if (!showAlerts) return
    getFreshserviceAlerts()
      .then(r => setProblems(r.data.alerts || []))
      .catch(() => setProbErr(true))
      .finally(() => setProbLoad(false))
    getFreshserviceProblems()
      .then(r => setFsProblems(r.data.problems || []))
      .catch(() => setFsProbErr(true))
      .finally(() => setFsProbLoad(false))
  }, [showAlerts])

  const handleAddBookmark = async (body) => {
    const r = await createBookmark(body)
    setBookmarks(bm => [...bm, r.data])
    setOrderedBookmarks(bm => [...bm, r.data])
  }

  const handleDeleteBookmark = async (id) => {
    await deleteBookmark(id)
    setBookmarks(bm => bm.filter(b => b.id !== id))
    setOrderedBookmarks(bm => bm.filter(b => b.id !== id))
  }

  const handleReorderShortcuts = (next) => {
    setOrderedShortcuts(next)
    saveOrder(next, 'shortcut_order')
  }

  const handleReorderBookmarks = (next) => {
    setOrderedBookmarks(next)
    saveOrder(next, 'bookmark_order')
  }

  return (
    <div style={{ maxWidth: 1200 }}>

      {/* ── Stats row ── */}
      <div className="dash-stats-grid">
        <StatCard
          icon="🎫" label="My Open Tickets"   color="var(--cyan)"
          value={fsStats?.open}  sub="assigned to me"
          loading={fsLoad} error={fsErr}
          onClick={!fsLoad && !fsErr ? () => setShowTickets(true) : undefined}
        />
        <StatCard
          icon="⏳" label="Unassigned Tickets" color="var(--yellow)"
          value={fsStats?.pending} sub="no agent assigned"
          loading={fsLoad} error={fsErr}
          onClick={!fsLoad && !fsErr ? () => setShowUnassigned(true) : undefined}
        />
        {showAlerts && (
          <StatCard
            icon="🔔" label="Alerts" color="var(--orange, #f97316)"
            value={probLoad ? undefined : problems.length} sub="open · not resolved"
            loading={probLoad} error={probErr}
            onClick={!probLoad && !probErr ? () => setShowProblems(true) : undefined}
          />
        )}
        {showAlerts && (
          <StatCard
            icon="🔴" label="Open Problems" color="var(--red)"
            value={fsProbLoad ? undefined : fsProblems.length} sub="open · not closed"
            loading={fsProbLoad} error={fsProbErr}
            onClick={!fsProbLoad && !fsProbErr ? () => setShowFsProblems(true) : undefined}
          />
        )}
        <StatCard
          icon="💻" label="Total Devices"  color="var(--purple)"
          value={imStats?.total} sub={imStats ? `${imStats.online} online` : null}
          loading={imLoad} error={imErr}
        />
        <StatCard
          icon="🟢" label="Devices Online" color="var(--green)"
          value={imStats?.online} sub={imStats ? `${imStats.offline} offline` : null}
          loading={imLoad} error={imErr}
        />
      </div>

      <div className="dash-main-grid">

        {/* ── Left column ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Quick Links (global) */}
          <div className="card">
            <div className="card-header">
              <div className="flex items-center gap-2">
                <span>🔗</span>
                <h3>Quick Links</h3>
                <span className="badge badge-gray">{shortcuts.length}</span>
              </div>
              <span className="badge badge-cyan">All Users</span>
            </div>
            <div className="card-body">
              {orderedShortcuts.length === 0 ? (
                <p className="text-sm text-muted">No quick links configured. Admins can add them in Settings → Quick Links.</p>
              ) : (
                <DraggableLinksGrid
                  items={orderedShortcuts}
                  onReorder={handleReorderShortcuts}
                  renderTile={s => <LinkTile {...s} />}
                />
              )}
            </div>
          </div>

          {/* Recent Lookups */}
          <div className="card">
            <div className="card-header">
              <div className="flex items-center gap-2">
                <span>🕐</span>
                <h3>Recent Lookups</h3>
              </div>
            </div>
            <div className="card-body">
              {recentUsers.length === 0 ? (
                <p className="text-sm text-muted">Users you look up will appear here.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {recentUsers.map(u => (
                    <div key={u.id} onClick={() => navigateTo('users', u)} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '8px 10px',
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                      transition: 'var(--transition)',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-accent)'; e.currentTarget.style.background = 'rgba(33,212,253,0.05)' }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--bg-elevated)' }}
                    >
                      <div style={{
                        width: 32, height: 32, borderRadius: '50%',
                        background: 'linear-gradient(135deg, var(--cyan), #818cf8)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.7rem', fontWeight: 700, color: '#000', flexShrink: 0,
                      }}>
                        {(u.displayName || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '0.85rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.displayName}</div>
                        <div className="text-xs text-muted">{u.mail || u.userPrincipalName}</div>
                      </div>
                      {u.jobTitle && <div className="text-xs text-muted" style={{ marginLeft: 'auto', flexShrink: 0 }}>{u.jobTitle}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Right column — My Bookmarks ── */}
        <div className="card" style={{ alignSelf: 'start' }}>
          <div className="card-header">
            <div className="flex items-center gap-2">
              <span>🔖</span>
              <h3>My Bookmarks</h3>
              <span className="badge badge-gray">{bookmarks.length}</span>
            </div>
            <button className="btn btn-primary" style={{ fontSize: '0.78rem', padding: '5px 12px' }} onClick={() => setShowAddBM(true)}>
              + Add
            </button>
          </div>
          <div className="card-body">
            {bookmarks.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '32px 0' }}>
                <div style={{ fontSize: '2rem', marginBottom: 8 }}>🔖</div>
                <p className="text-sm text-muted">Your personal bookmarks appear here.</p>
                <button className="btn btn-ghost" style={{ marginTop: 12, fontSize: '0.82rem' }} onClick={() => setShowAddBM(true)}>
                  Add your first bookmark
                </button>
              </div>
            ) : (
              <DraggableLinksGrid
                items={orderedBookmarks}
                onReorder={handleReorderBookmarks}
                renderTile={b => <LinkTile {...b} onDelete={() => handleDeleteBookmark(b.id)} />}
              />
            )}
          </div>
        </div>
      </div>

      {showAddBM && (
        <AddBookmarkModal onClose={() => setShowAddBM(false)} onSave={handleAddBookmark} />
      )}
      {showTickets && (
        <MyTicketsDrawer onClose={() => setShowTickets(false)} mode="mine" />
      )}
      {showUnassigned && (
        <MyTicketsDrawer onClose={() => setShowUnassigned(false)} mode="unassigned" />
      )}
      {showProblems && (
        <AlertsDrawer alerts={problems} onClose={() => setShowProblems(false)} />
      )}
      {showFsProblems && (
        <ProblemsDrawer fsProblems={fsProblems} onClose={() => setShowFsProblems(false)} />
      )}
    </div>
  )
}
