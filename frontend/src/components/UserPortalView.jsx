import { useState, useEffect } from 'react'
import { api } from '../api/client.js'

const STATUS_LABEL = {
  open: 'Open', assigned: 'Assigned', in_progress: 'In Progress',
  waiting_on_customer: 'Waiting on You', waiting_on_third_party: 'Waiting on Third Party',
  pending: 'Pending', escalated: 'Escalated', scheduled: 'Scheduled',
  resolved: 'Resolved', closed: 'Closed', canceled: 'Canceled',
}

const STATUS_COLOR = {
  open: '#3b82f6', assigned: '#8b5cf6', in_progress: '#f59e0b',
  waiting_on_customer: '#f97316', waiting_on_third_party: '#06b6d4',
  pending: '#6b7280', escalated: '#ef4444', scheduled: '#10b981',
  resolved: '#22c55e', closed: '#6b7280', canceled: '#9ca3af',
}

const ACTIVE_STATUSES = 'open,assigned,in_progress,waiting_on_customer,waiting_on_third_party,pending,escalated,scheduled'

export default function UserPortalView({ userProfile, userType, onSignOut }) {
  const [tickets, setTickets]       = useState([])
  const [loading, setLoading]       = useState(true)
  const [tab, setTab]               = useState('active')
  const [selected, setSelected]     = useState(null)
  const [showNew, setShowNew]       = useState(false)
  const [theme, setTheme]           = useState(() => localStorage.getItem('theme') || 'dark')
  const [branding, setBranding]     = useState({ logoUrl: '' })
  const [tktMode, setTktMode]       = useState(null)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  useEffect(() => {
    api.get('/api/settings/config').then(r => setBranding({ logoUrl: r.data.logoUrl || '' })).catch(() => {})
    api.get('/api/portal/ticketing-mode').then(r => setTktMode(r.data)).catch(() => {})
  }, [])

  const fetchTickets = () => {
    setLoading(true)
    const isPortal = userType === 'portal'
    const base = isPortal ? '/api/portal/tickets' : '/api/tickets'
    const params = isPortal
      ? {}
      : { requester_email: userProfile.email, status: tab === 'active' ? ACTIVE_STATUSES : 'resolved,closed,canceled' }

    api.get(base, { params }).then(r => {
      const data = r.data.tickets || r.data || []
      if (isPortal && tab === 'resolved') {
        setTickets(data.filter(t => ['resolved', 'closed', 'canceled'].includes(t.status)))
      } else if (isPortal) {
        setTickets(data.filter(t => !['resolved', 'closed', 'canceled'].includes(t.status)))
      } else {
        setTickets(data)
      }
    }).catch(() => setTickets([])).finally(() => setLoading(false))
  }

  useEffect(() => { fetchTickets() }, [tab, userProfile.email])

  const isDark = theme === 'dark'

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', fontFamily: 'var(--font-sans)', color: 'var(--text-primary)' }}>

      {/* Header */}
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 24px', height: 56, borderBottom: '1px solid var(--border)',
        background: 'var(--bg-surface)', position: 'sticky', top: 0, zIndex: 100,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {branding.logoUrl
            ? <img src={branding.logoUrl} alt="logo" style={{ height: 28, objectFit: 'contain' }} />
            : <span style={{ fontWeight: 800, fontSize: '1.1rem' }}>Control<span style={{ color: 'var(--cyan)' }}>Point</span></span>
          }
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', borderLeft: '1px solid var(--border)', paddingLeft: 12 }}>
            IT Support Portal
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button
            onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1rem', padding: 4 }}
            title="Toggle theme"
          >{isDark ? '☀️' : '🌙'}</button>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{userProfile.name || userProfile.email}</span>
          <button
            onClick={onSignOut}
            style={{
              padding: '6px 14px', background: 'none', border: '1px solid var(--border)',
              borderRadius: 6, cursor: 'pointer', color: 'var(--text-secondary)',
              fontSize: '0.8rem', fontFamily: 'var(--font-sans)',
            }}
          >Sign out</button>
        </div>
      </header>

      {/* Main content */}
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '32px 24px' }}>

        {/* Page title + new ticket button */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
          <div>
            <h1 style={{ fontSize: '1.4rem', fontWeight: 700, margin: 0 }}>My Tickets</h1>
            <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              View and manage your IT support requests
            </p>
          </div>
          <button
            onClick={() => setShowNew(true)}
            style={{
              padding: '9px 18px', background: 'var(--cyan)', border: 'none',
              borderRadius: 7, cursor: 'pointer', color: '#fff',
              fontSize: '0.875rem', fontWeight: 600, fontFamily: 'var(--font-sans)',
            }}
          >+ New Ticket</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
          {[['active', 'Active'], ['resolved', 'Resolved']].map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)} style={{
              padding: '8px 18px', background: 'none', border: 'none', cursor: 'pointer',
              fontFamily: 'var(--font-sans)', fontSize: '0.875rem', fontWeight: tab === key ? 600 : 400,
              color: tab === key ? 'var(--cyan)' : 'var(--text-secondary)',
              borderBottom: tab === key ? '2px solid var(--cyan)' : '2px solid transparent',
              marginBottom: -1, transition: 'all 0.15s',
            }}>{label}</button>
          ))}
        </div>

        {/* Ticket list */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-muted)' }}>Loading…</div>
        ) : tickets.length === 0 ? (
          <div style={{
            textAlign: 'center', padding: '64px 0', color: 'var(--text-muted)',
            border: '1px dashed var(--border)', borderRadius: 10,
          }}>
            <div style={{ fontSize: '2rem', marginBottom: 12 }}>🎫</div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>No {tab} tickets</div>
            <div style={{ fontSize: '0.82rem' }}>
              {tab === 'active' ? 'Click "New Ticket" to submit a support request.' : 'No resolved tickets yet.'}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {tickets.map(t => (
              <div
                key={t.id}
                onClick={() => setSelected(t)}
                style={{
                  padding: '14px 18px', background: 'var(--bg-surface)', border: '1px solid var(--border)',
                  borderRadius: 8, cursor: 'pointer', transition: 'border-color 0.15s',
                  display: 'flex', alignItems: 'center', gap: 14,
                }}
                onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--cyan)'}
                onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
              >
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', minWidth: 40 }}>#{t.id}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, fontSize: '0.9rem', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.subject || t.title || 'Untitled'}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {t.created_at ? new Date(t.created_at).toLocaleDateString() : ''}
                    {t.category ? ` · ${t.category}` : ''}
                  </div>
                </div>
                <span style={{
                  padding: '3px 10px', borderRadius: 20, fontSize: '0.72rem', fontWeight: 600, whiteSpace: 'nowrap',
                  background: (STATUS_COLOR[t.status] || '#6b7280') + '22',
                  color: STATUS_COLOR[t.status] || '#6b7280',
                }}>
                  {STATUS_LABEL[t.status] || t.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Ticket detail modal */}
      {selected && (
        <TicketDetailModal ticket={selected} userType={userType} onClose={() => { setSelected(null); fetchTickets() }} />
      )}

      {/* New ticket modal */}
      {showNew && (
        <NewTicketModal userProfile={userProfile} userType={userType} tktMode={tktMode} onClose={() => { setShowNew(false); fetchTickets() }} />
      )}
    </div>
  )
}

function TicketDetailModal({ ticket, userType, onClose }) {
  const [comments, setComments] = useState([])
  const [reply, setReply]       = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const base = userType === 'portal' ? '/api/portal/tickets' : '/api/tickets'
    api.get(`${base}/${ticket.id}`).then(r => {
      setComments((r.data.comments || []).filter(c => !c.is_internal))
    }).catch(() => {})
  }, [ticket.id])

  const sendReply = async () => {
    if (!reply.trim() || submitting) return
    setSubmitting(true)
    try {
      const base = userType === 'portal' ? '/api/portal/tickets' : '/api/tickets'
      await api.post(`${base}/${ticket.id}/comments`, { body: reply, is_internal: false })
      setReply('')
      const r = await api.get(`${base}/${ticket.id}`)
      setComments((r.data.comments || []).filter(c => !c.is_internal))
    } catch {}
    setSubmitting(false)
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: 'var(--bg-surface)', borderRadius: 10, width: '100%', maxWidth: 640,
        maxHeight: '85vh', display: 'flex', flexDirection: 'column', border: '1px solid var(--border)',
      }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>Ticket #{ticket.id}</div>
            <div style={{ fontWeight: 600, fontSize: '1rem' }}>{ticket.subject || ticket.title}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              padding: '3px 10px', borderRadius: 20, fontSize: '0.72rem', fontWeight: 600,
              background: (STATUS_COLOR[ticket.status] || '#6b7280') + '22',
              color: STATUS_COLOR[ticket.status] || '#6b7280',
            }}>{STATUS_LABEL[ticket.status] || ticket.status}</span>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1.2rem', lineHeight: 1, padding: 2 }}>×</button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {ticket.description && (
            <div style={{ padding: 12, background: 'var(--bg-base)', borderRadius: 7, fontSize: '0.875rem', lineHeight: 1.6, color: 'var(--text-secondary)' }}>
              {ticket.description}
            </div>
          )}
          {comments.map((c, i) => (
            <div key={i} style={{
              padding: 12, borderRadius: 7, fontSize: '0.875rem', lineHeight: 1.6,
              background: c.author_portal_id ? 'var(--bg-base)' : 'rgba(6,182,212,0.07)',
              border: c.author_portal_id ? '1px solid var(--border)' : '1px solid rgba(6,182,212,0.2)',
            }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 6, fontWeight: 500 }}>
                {c.author_portal_id ? 'You' : (c.author_name || 'Support')} · {new Date(c.created_at).toLocaleString()}
              </div>
              {c.body}
            </div>
          ))}
        </div>

        {!['resolved', 'closed', 'canceled'].includes(ticket.status) && (
          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
            <textarea
              value={reply}
              onChange={e => setReply(e.target.value)}
              placeholder="Add a reply…"
              rows={2}
              style={{
                flex: 1, padding: '8px 10px', background: 'var(--bg-base)', border: '1px solid var(--border)',
                borderRadius: 6, color: 'var(--text-primary)', fontFamily: 'var(--font-sans)',
                fontSize: '0.875rem', resize: 'none',
              }}
            />
            <button
              onClick={sendReply}
              disabled={!reply.trim() || submitting}
              style={{
                padding: '8px 16px', background: 'var(--cyan)', border: 'none', borderRadius: 6,
                cursor: reply.trim() && !submitting ? 'pointer' : 'default',
                color: '#fff', fontWeight: 600, fontSize: '0.85rem', fontFamily: 'var(--font-sans)',
                opacity: reply.trim() && !submitting ? 1 : 0.4,
              }}
            >Send</button>
          </div>
        )}
      </div>
    </div>
  )
}

function NewTicketModal({ userProfile, userType, tktMode, onClose }) {
  const [form, setForm]         = useState({ subject: '', description: '', category: '', priority: 'medium' })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]       = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submit = async () => {
    if (!form.subject.trim()) { setError('Subject is required'); return }
    setSubmitting(true)
    setError('')
    try {
      const base = userType === 'portal' ? '/api/portal/tickets' : '/api/tickets'
      await api.post(base, {
        subject:      form.subject,
        description:  form.description,
        category:     form.category || undefined,
        priority:     form.priority,
        source:       'portal',
        requester_name:  userProfile.name,
        requester_email: userProfile.email,
      })
      onClose()
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to submit ticket')
    }
    setSubmitting(false)
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: 'var(--bg-surface)', borderRadius: 10, width: '100%', maxWidth: 520,
        border: '1px solid var(--border)', overflow: 'hidden',
      }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <span style={{ fontWeight: 600, fontSize: '1rem' }}>New Support Ticket</span>
            {tktMode?.provider_label && (
              <span style={{ marginLeft: 8, fontSize: '0.72rem', fontWeight: 700, color: 'var(--cyan)', background: 'var(--cyan-dim)', padding: '2px 8px', borderRadius: 20 }}>
                via {tktMode.provider_label}
              </span>
            )}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1.2rem', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Subject *</label>
            <input
              className="input"
              value={form.subject}
              onChange={e => set('subject', e.target.value)}
              placeholder="Brief description of the issue"
              style={{ width: '100%', boxSizing: 'border-box' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Description</label>
            <textarea
              className="input"
              value={form.description}
              onChange={e => set('description', e.target.value)}
              placeholder="Provide details about the issue…"
              rows={4}
              style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical' }}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Category</label>
              <select className="input" value={form.category} onChange={e => set('category', e.target.value)} style={{ width: '100%' }}>
                <option value="">Select…</option>
                {['Hardware', 'Software', 'Network', 'Data', 'Employee Status', 'Other'].map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Priority</label>
              <select className="input" value={form.priority} onChange={e => set('priority', e.target.value)} style={{ width: '100%' }}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>
          {error && <div style={{ fontSize: '0.8rem', color: '#ef4444', padding: '6px 10px', background: 'rgba(239,68,68,0.08)', borderRadius: 6 }}>{error}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <button onClick={onClose} style={{ padding: '8px 16px', background: 'none', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', color: 'var(--text-secondary)', fontFamily: 'var(--font-sans)', fontSize: '0.875rem' }}>Cancel</button>
            <button onClick={submit} disabled={submitting || !form.subject.trim()} style={{
              padding: '8px 18px', background: 'var(--cyan)', border: 'none', borderRadius: 6,
              cursor: submitting || !form.subject.trim() ? 'default' : 'pointer',
              color: '#fff', fontWeight: 600, fontSize: '0.875rem', fontFamily: 'var(--font-sans)',
              opacity: submitting || !form.subject.trim() ? 0.5 : 1,
            }}>{submitting ? 'Submitting…' : 'Submit Ticket'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
