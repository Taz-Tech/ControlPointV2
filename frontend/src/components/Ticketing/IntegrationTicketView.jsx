import { useState, useEffect, useCallback } from 'react'
import { api } from '../../api/client.js'

const PROVIDER_LABEL = {
  freshservice: 'Freshservice',
  jira:         'Jira',
  servicenow:   'ServiceNow',
  zendesk:      'Zendesk',
}

const PROVIDER_COLOR = {
  freshservice: '#22c55e',
  jira:         '#0052cc',
  servicenow:   '#81b5a1',
  zendesk:      '#03363d',
}

const STATUS_LABEL = {
  open:                   'Open',
  in_progress:            'In Progress',
  pending:                'Pending',
  waiting_on_customer:    'Waiting on Customer',
  waiting_on_third_party: 'Waiting on 3rd Party',
  resolved:               'Resolved',
  closed:                 'Closed',
}

const STATUS_COLOR = {
  open:                   '#3b82f6',
  in_progress:            '#8b5cf6',
  pending:                '#f59e0b',
  waiting_on_customer:    '#f97316',
  waiting_on_third_party: '#6b7280',
  resolved:               '#22c55e',
  closed:                 '#6b7280',
}

const PRI_COLOR = { low: '#6b7280', medium: '#3b82f6', high: '#f59e0b', urgent: '#ef4444' }

const STATUSES = ['all', 'open', 'in_progress', 'pending', 'waiting_on_customer', 'resolved', 'closed']

function Badge({ label, color, small }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: small ? '1px 7px' : '2px 10px',
      borderRadius: 20,
      fontSize: small ? '0.68rem' : '0.72rem',
      fontWeight: 600,
      background: color + '22',
      color: color,
      border: `1px solid ${color}44`,
      whiteSpace: 'nowrap',
    }}>{label}</span>
  )
}

function ProviderBadge({ provider }) {
  const label = PROVIDER_LABEL[provider] || provider
  const color = PROVIDER_COLOR[provider] || '#6b7280'
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 10px', borderRadius: 20,
      fontSize: '0.72rem', fontWeight: 700,
      background: color + '18', color: color, border: `1px solid ${color}44`,
    }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, display: 'inline-block' }} />
      {label}
    </span>
  )
}

function TicketRow({ ticket, onSelect }) {
  return (
    <div
      onClick={() => onSelect(ticket)}
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 110px 90px 130px 130px',
        gap: 12,
        alignItems: 'center',
        padding: '10px 20px',
        borderBottom: '1px solid var(--border)',
        cursor: 'pointer',
        transition: 'background 0.12s',
      }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {ticket.subject}
        </div>
        {ticket.requester_name && (
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
            {ticket.requester_name}{ticket.requester_email ? ` — ${ticket.requester_email}` : ''}
          </div>
        )}
      </div>
      <Badge label={STATUS_LABEL[ticket.status] || ticket.status} color={STATUS_COLOR[ticket.status] || '#6b7280'} small />
      <Badge label={ticket.priority} color={PRI_COLOR[ticket.priority] || '#6b7280'} small />
      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
        {ticket.assignee_name || <span style={{ opacity: 0.5 }}>Unassigned</span>}
      </div>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
        {ticket.updated_at ? new Date(ticket.updated_at).toLocaleDateString() : '—'}
      </div>
    </div>
  )
}

function CreateTicketModal({ provider, onClose, onCreated }) {
  const [form, setForm]     = useState({ subject: '', description: '', priority: 'medium', type: 'incident', requester_email: '' })
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState(null)

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  const submit = async () => {
    if (!form.subject.trim()) { setErr('Subject is required'); return }
    setSaving(true); setErr(null)
    try {
      const { data } = await api.post('/api/ticket-integration/tickets', form)
      onCreated(data)
    } catch (e) {
      setErr(e.response?.data?.detail || 'Failed to create ticket')
    } finally {
      setSaving(false)
    }
  }

  const inputStyle = {
    width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)',
    background: 'var(--bg-elevated)', color: 'var(--text)', fontSize: '0.88rem', boxSizing: 'border-box',
  }
  const labelStyle = { display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 4, fontWeight: 600 }

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#00000080', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'var(--bg-surface)', borderRadius: 12, padding: 28, width: 520, maxWidth: '95vw', boxShadow: 'var(--shadow-card)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: '1rem' }}>New Ticket</div>
            <ProviderBadge provider={provider} />
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer', color: 'var(--text-muted)' }}>✕</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={labelStyle}>Subject *</label>
            <input style={inputStyle} value={form.subject} onChange={set('subject')} placeholder="Brief summary of the issue" />
          </div>
          <div>
            <label style={labelStyle}>Description</label>
            <textarea style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }} value={form.description} onChange={set('description')} placeholder="Describe the issue in detail…" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>Priority</label>
              <select style={inputStyle} value={form.priority} onChange={set('priority')}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Type</label>
              <select style={inputStyle} value={form.type} onChange={set('type')}>
                <option value="incident">Incident</option>
                <option value="service_request">Service Request</option>
                <option value="problem">Problem</option>
                <option value="change">Change</option>
              </select>
            </div>
          </div>
          <div>
            <label style={labelStyle}>Requester Email</label>
            <input style={inputStyle} type="email" value={form.requester_email} onChange={set('requester_email')} placeholder="requester@company.com" />
          </div>
          {err && <div style={{ color: 'var(--red)', fontSize: '0.82rem' }}>{err}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
            <button onClick={onClose} style={{ padding: '7px 18px', borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', color: 'var(--text)' }}>Cancel</button>
            <button onClick={submit} disabled={saving} style={{ padding: '7px 18px', borderRadius: 7, border: 'none', background: 'var(--cyan)', color: '#fff', fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Creating…' : 'Create Ticket'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function TicketDetailPanel({ ticket: initial, provider, onBack, onUpdated }) {
  const [ticket,       setTicket]       = useState(initial)
  const [loading,      setLoading]      = useState(true)
  const [saving,       setSaving]       = useState(false)
  const [commentBody,  setCommentBody]  = useState('')
  const [commentPriv,  setCommentPriv]  = useState(false)
  const [postingCmt,   setPostingCmt]   = useState(false)
  const [editStatus,   setEditStatus]   = useState(initial.status)
  const [editPriority, setEditPriority] = useState(initial.priority)
  const [err,          setErr]          = useState(null)

  useEffect(() => {
    api.get(`/api/ticket-integration/tickets/${initial.id}`)
      .then(r => { setTicket(r.data); setEditStatus(r.data.status); setEditPriority(r.data.priority) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [initial.id])

  const save = async () => {
    setSaving(true); setErr(null)
    try {
      const updated = await api.patch(`/api/ticket-integration/tickets/${ticket.id}`, { status: editStatus, priority: editPriority })
      setTicket(updated.data)
      onUpdated?.()
    } catch (e) {
      setErr(e.response?.data?.detail || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const postComment = async () => {
    if (!commentBody.trim()) return
    setPostingCmt(true); setErr(null)
    try {
      const { data: c } = await api.post(`/api/ticket-integration/tickets/${ticket.id}/comments`, { body: commentBody, private: commentPriv })
      setTicket(t => ({ ...t, comments: [...(t.comments || []), c] }))
      setCommentBody('')
    } catch (e) {
      setErr(e.response?.data?.detail || 'Failed to post comment')
    } finally {
      setPostingCmt(false)
    }
  }

  const selectStyle = { padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text)', fontSize: '0.83rem', cursor: 'pointer' }
  const dirty = editStatus !== ticket.status || editPriority !== ticket.priority

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1.1rem', padding: 0 }}>←</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: '0.95rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ticket.subject}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 4, alignItems: 'center', flexWrap: 'wrap' }}>
            <ProviderBadge provider={provider} />
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>#{ticket.id}</span>
            {ticket.url && <a href={ticket.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.75rem', color: 'var(--cyan)' }}>Open in {PROVIDER_LABEL[provider]} ↗</a>}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 20, display: 'flex', gap: 20 }}>
        {/* Main content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {loading ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>Loading…</div>
          ) : (
            <>
              {ticket.description && (
                <div style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: 16, marginBottom: 20 }}>
                  <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>DESCRIPTION</div>
                  <div style={{ fontSize: '0.88rem', color: 'var(--text)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{ticket.description}</div>
                </div>
              )}

              {/* Comments */}
              <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10 }}>
                COMMENTS {ticket.comments?.length ? `(${ticket.comments.length})` : ''}
              </div>
              {(ticket.comments || []).map((c, i) => (
                <div key={c.id || i} style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: 14, marginBottom: 10, borderLeft: c.private ? '3px solid var(--yellow)' : '3px solid transparent' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontWeight: 600, fontSize: '0.82rem' }}>{c.author}</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{c.created_at ? new Date(c.created_at).toLocaleString() : ''}</span>
                  </div>
                  {c.private && <span style={{ fontSize: '0.7rem', color: 'var(--yellow)', marginBottom: 4, display: 'block' }}>Internal Note</span>}
                  <div style={{ fontSize: '0.85rem', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{c.body}</div>
                </div>
              ))}
              {(!ticket.comments || ticket.comments.length === 0) && !loading && (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.83rem' }}>No comments yet.</div>
              )}

              {/* Add comment */}
              <div style={{ marginTop: 16, background: 'var(--bg-elevated)', borderRadius: 8, padding: 14 }}>
                <textarea
                  value={commentBody}
                  onChange={e => setCommentBody(e.target.value)}
                  placeholder="Add a comment or reply…"
                  style={{ width: '100%', minHeight: 72, padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text)', fontSize: '0.85rem', resize: 'vertical', boxSizing: 'border-box' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={commentPriv} onChange={e => setCommentPriv(e.target.checked)} />
                    Internal note (private)
                  </label>
                  <button onClick={postComment} disabled={postingCmt || !commentBody.trim()} style={{ padding: '6px 16px', borderRadius: 6, border: 'none', background: 'var(--cyan)', color: '#fff', fontWeight: 600, fontSize: '0.82rem', cursor: postingCmt || !commentBody.trim() ? 'not-allowed' : 'pointer', opacity: postingCmt || !commentBody.trim() ? 0.6 : 1 }}>
                    {postingCmt ? 'Posting…' : 'Post Comment'}
                  </button>
                </div>
              </div>
              {err && <div style={{ color: 'var(--red)', fontSize: '0.82rem', marginTop: 8 }}>{err}</div>}
            </>
          )}
        </div>

        {/* Sidebar */}
        <div style={{ width: 220, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: 14 }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: 10, letterSpacing: '0.05em' }}>DETAILS</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 4 }}>Status</div>
                <select value={editStatus} onChange={e => setEditStatus(e.target.value)} style={selectStyle}>
                  {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 4 }}>Priority</div>
                <select value={editPriority} onChange={e => setEditPriority(e.target.value)} style={selectStyle}>
                  {['low', 'medium', 'high', 'urgent'].map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
                </select>
              </div>
              {ticket.requester_name && (
                <div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 2 }}>Requester</div>
                  <div style={{ fontSize: '0.83rem' }}>{ticket.requester_name}</div>
                  {ticket.requester_email && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{ticket.requester_email}</div>}
                </div>
              )}
              {ticket.assignee_name && (
                <div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 2 }}>Assignee</div>
                  <div style={{ fontSize: '0.83rem' }}>{ticket.assignee_name}</div>
                </div>
              )}
              <div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 2 }}>Created</div>
                <div style={{ fontSize: '0.78rem' }}>{ticket.created_at ? new Date(ticket.created_at).toLocaleString() : '—'}</div>
              </div>
            </div>
            {dirty && (
              <button onClick={save} disabled={saving} style={{ marginTop: 14, width: '100%', padding: '7px', borderRadius: 6, border: 'none', background: 'var(--cyan)', color: '#fff', fontWeight: 600, fontSize: '0.82rem', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function SetupPrompt() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16, padding: 40, textAlign: 'center' }}>
      <div style={{ fontSize: '2.5rem' }}>🎫</div>
      <div style={{ fontWeight: 700, fontSize: '1.15rem' }}>No Ticket System Connected</div>
      <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', maxWidth: 380, lineHeight: 1.6 }}>
        Connect your existing ticketing system to view and manage tickets here. Supported providers: Freshservice, Jira, ServiceNow, and Zendesk.
      </div>
      <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
        Go to <strong>Settings → Integrations → Ticket System</strong> to configure your provider.
      </div>
    </div>
  )
}

export default function IntegrationTicketView({ provider }) {
  const [tickets,      setTickets]      = useState([])
  const [loading,      setLoading]      = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [selected,     setSelected]     = useState(null)
  const [showCreate,   setShowCreate]   = useState(false)
  const [err,          setErr]          = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const { data } = await api.get('/api/ticket-integration/tickets', { params: { status: statusFilter } })
      setTickets(data.tickets || [])
    } catch (e) {
      setErr(e.response?.data?.detail || 'Failed to load tickets')
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => { load() }, [load])

  const onCreated = (ticket) => {
    setShowCreate(false)
    setTickets(ts => [ticket, ...ts])
  }

  if (selected) {
    return (
      <TicketDetailPanel
        ticket={selected}
        provider={provider}
        onBack={() => setSelected(null)}
        onUpdated={() => { load(); setSelected(null) }}
      />
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', flexShrink: 0 }}>
        <ProviderBadge provider={provider} />
        <div style={{ display: 'flex', gap: 4, flex: 1, flexWrap: 'wrap' }}>
          {STATUSES.map(s => (
            <button key={s} onClick={() => setStatusFilter(s)} style={{
              padding: '4px 12px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: '0.78rem',
              background: statusFilter === s ? 'var(--cyan-dim)' : 'transparent',
              color:      statusFilter === s ? 'var(--cyan)'     : 'var(--text-muted)',
              fontWeight: statusFilter === s ? 700 : 400,
            }}>
              {s === 'all' ? 'All' : STATUS_LABEL[s] || s}
            </button>
          ))}
        </div>
        <button onClick={() => setShowCreate(true)} style={{ padding: '6px 16px', borderRadius: 7, border: 'none', background: 'var(--cyan)', color: '#fff', fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer', flexShrink: 0 }}>
          + New Ticket
        </button>
        <button onClick={load} title="Refresh" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1rem' }}>⟳</button>
      </div>

      {/* Table header */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px 90px 130px 130px', gap: 12, padding: '8px 20px', background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        {['Subject', 'Status', 'Priority', 'Assignee', 'Updated'].map(h => (
          <div key={h} style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.05em' }}>{h.toUpperCase()}</div>
        ))}
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {loading && (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.88rem' }}>Loading tickets…</div>
        )}
        {err && (
          <div style={{ padding: 24, color: 'var(--red)', fontSize: '0.88rem', textAlign: 'center' }}>{err}</div>
        )}
        {!loading && !err && tickets.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.88rem' }}>No tickets found.</div>
        )}
        {!loading && tickets.map(t => (
          <TicketRow key={t.id} ticket={t} onSelect={setSelected} />
        ))}
      </div>

      {showCreate && (
        <CreateTicketModal provider={provider} onClose={() => setShowCreate(false)} onCreated={onCreated} />
      )}
    </div>
  )
}

export { SetupPrompt, CreateTicketModal }
