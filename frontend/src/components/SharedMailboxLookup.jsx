import { useState, useRef, useCallback } from 'react'
import { searchMailboxes, getMailboxPermissions } from '../api/client.js'

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function avatarColor(name = '') {
  const colors = [
    ['#21d4fd','#000'], ['#3fb950','#000'], ['#bc8cff','#000'],
    ['#ff8c00','#000'], ['#f85149','#fff'], ['#5eead4','#000'],
  ]
  const idx = (name.charCodeAt(0) || 0) % colors.length
  return colors[idx]
}

function Avatar({ name, size = 36 }) {
  const initials = name ? name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() : '?'
  const [bg, fg] = avatarColor(name)
  return (
    <div className="avatar" style={{ width: size, height: size, background: bg, color: fg, fontSize: size * 0.35 }}>
      {initials}
    </div>
  )
}

/* ── Permission row ──────────────────────────────────────────────────────── */

function PermRow({ principal, rights, deny }) {
  // Strip domain prefix for cleaner display (COMPANY\user → user)
  const display = principal.includes('\\') ? principal.split('\\').pop() : principal
  return (
    <div className="mailbox-member-row">
      <Avatar name={display} size={32} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 500, fontSize: '0.875rem' }}>{display}</div>
        {display !== principal && (
          <div className="text-xs text-muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {principal}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1" style={{ flexShrink: 0 }}>
        {(rights || []).map(r => (
          <span key={r} className="badge badge-purple" style={{ fontSize: '0.65rem' }}>{r}</span>
        ))}
        {deny && <span className="badge badge-red" style={{ fontSize: '0.65rem' }}>Deny</span>}
      </div>
    </div>
  )
}

function PermSection({ title, badge, items, renderItem, emptyText }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
        <span className="text-xs text-muted" style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{title}</span>
        <span className="badge badge-gray" style={{ fontSize: '0.65rem' }}>{items.length}</span>
      </div>
      {items.length === 0
        ? <div className="text-xs text-muted" style={{ paddingLeft: 4 }}>{emptyText}</div>
        : items.map((item, i) => renderItem(item, i))
      }
    </div>
  )
}

/* ── Mailbox result card ─────────────────────────────────────────────────── */

function MailboxCard({ mailbox, isExpanded, onToggle }) {
  const [perms,    setPerms]    = useState(null)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)
  const fetched                 = useRef(false)

  const handleToggle = async () => {
    onToggle()
    if (!fetched.current) {
      fetched.current = true
      setLoading(true)
      try {
        const res = await getMailboxPermissions(mailbox.id)
        setPerms(res.data)
      } catch (e) {
        setError(e.response?.data?.detail || 'Failed to load permissions')
      } finally {
        setLoading(false)
      }
    }
  }

  return (
    <div className={`mailbox-card${isExpanded ? ' expanded' : ''}`}>
      {/* Card header — clickable */}
      <div className="mailbox-card-header" onClick={handleToggle} id={`mailbox-${mailbox.id}`}>
        <div className="flex items-center gap-3" style={{ flex: 1, minWidth: 0 }}>
          <div className="mailbox-icon">📬</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {mailbox.displayName}
            </div>
            <div className="text-xs text-muted">{mailbox.mail || mailbox.userPrincipalName}</div>
          </div>
        </div>
        <div className="flex items-center gap-2" style={{ flexShrink: 0 }}>
          {mailbox.department && (
            <span className="badge badge-gray">{mailbox.department}</span>
          )}
          {mailbox.id && (
            <a
              href={`https://admin.exchange.microsoft.com/#/mailboxes/:/MailboxDetails/${mailbox.id}`}
              target="_blank"
              rel="noreferrer"
              onClick={e => e.stopPropagation()}
              className="btn btn-ghost"
              style={{ fontSize: '0.72rem', padding: '3px 9px' }}
              title="Open in Exchange Admin Center"
            >
              Manage in EAC ↗
            </a>
          )}
          <span className="mailbox-chevron">{isExpanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {/* Expanded permissions */}
      {isExpanded && (
        <div className="mailbox-card-body">
          {loading && (
            <div className="flex items-center gap-3" style={{ color: 'var(--text-secondary)', padding: '16px 0' }}>
              <div className="spinner" />
              <span className="text-sm">Querying Exchange Online…</span>
            </div>
          )}

          {error && <div className="alert alert-error">{error}</div>}

          {perms && !loading && (() => {
            // Merge Full Access + Send As + Send on Behalf by principal (case-insensitive)
            const map = new Map()
            for (const item of (perms.fullAccess || [])) {
              const key = item.user.toLowerCase()
              if (!map.has(key)) map.set(key, { principal: item.user, rights: [], deny: false })
              const entry = map.get(key)
              entry.rights.push(...(item.accessRights || []))
              if (item.deny) entry.deny = true
            }
            for (const item of (perms.sendAs || [])) {
              const key = item.trustee.toLowerCase()
              if (!map.has(key)) map.set(key, { principal: item.trustee, rights: [], deny: false })
              map.get(key).rights.push(...(item.accessRights || []))
            }
            for (const item of (perms.sendOnBehalf || [])) {
              const key = item.toLowerCase()
              if (!map.has(key)) map.set(key, { principal: item, rights: [], deny: false })
              map.get(key).rights.push('SendOnBehalf')
            }
            const merged = Array.from(map.values())

            return (
              <PermSection
                title="Mailbox Permissions"
                items={merged}
                emptyText="No users with mailbox permissions."
                renderItem={(item, i) => (
                  <PermRow key={i} principal={item.principal} rights={item.rights} deny={item.deny} />
                )}
              />
            )
          })()}
        </div>
      )}
    </div>
  )
}

/* ── Main component ──────────────────────────────────────────────────────── */

export default function SharedMailboxLookup() {
  const [query, setQuery]       = useState('')
  const [results, setResults]   = useState([])
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)
  const [expanded, setExpanded] = useState(null)
  const debounceRef             = useRef(null)

  const handleSearch = useCallback((val) => {
    setQuery(val)
    setError(null)
    setExpanded(null)
    clearTimeout(debounceRef.current)
    if (!val.trim()) { setResults([]); return }
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await searchMailboxes(val.trim())
        setResults(res.data.mailboxes || [])
      } catch (e) {
        setError(e.response?.data?.detail || 'Search failed — check Azure credentials in backend .env')
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 400)
  }, [])

  return (
    <div>
      {/* Search card */}
      <div className="card">
        <div className="card-header">
          <h3>Search Shared Mailboxes</h3>
          <span className="badge badge-cyan">Exchange Online PS</span>
        </div>
        <div className="card-body">
          <div className="search-bar">
            <span className="search-icon">🔍</span>
            <input
              id="mailbox-search-input"
              className="input"
              placeholder="Search by mailbox name or email address…"
              value={query}
              onChange={e => handleSearch(e.target.value)}
              autoComplete="off"
            />
          </div>

          {error && <div className="alert alert-error mt-3">⚠️ {error}</div>}

          {loading && (
            <div className="flex items-center gap-3 mt-4" style={{ color: 'var(--text-secondary)' }}>
              <div className="spinner" />
              <span className="text-sm">Searching shared mailboxes…</span>
            </div>
          )}

          {!loading && results.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div className="text-xs text-muted" style={{ marginBottom: 12 }}>
                {results.length} shared mailbox{results.length !== 1 ? 'es' : ''} found — click to expand members
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {results.map(mb => (
                  <MailboxCard
                    key={mb.id}
                    mailbox={mb}
                    isExpanded={expanded === mb.id}
                    onToggle={() => setExpanded(prev => prev === mb.id ? null : mb.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {!loading && query && results.length === 0 && !error && (
            <div className="text-sm text-muted mt-4" style={{ textAlign: 'center', padding: 32 }}>
              No shared mailboxes found for "{query}"
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
