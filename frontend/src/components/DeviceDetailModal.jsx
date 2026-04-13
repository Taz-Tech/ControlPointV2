import { useState, useEffect } from 'react'
import { lookupDevice, getDeviceExploits } from '../api/client.js'

function formatRelativeTime(isoString) {
  if (!isoString) return null
  const date = new Date(isoString)
  if (isNaN(date)) return isoString
  const diff  = Date.now() - date.getTime()
  const mins  = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days  = Math.floor(diff / 86400000)
  if (mins < 1)   return 'just now'
  if (mins < 60)  return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 30)  return `${days}d ago`
  return date.toLocaleDateString()
}

function InfoRow({ label, value, mono }) {
  if (!value) return null
  return (
    <div className="flex" style={{ marginBottom: 8, gap: 8, alignItems: 'flex-start' }}>
      <span className="text-muted text-xs" style={{ flexShrink: 0, width: 88 }}>{label}</span>
      <span className={`text-sm${mono ? ' font-mono' : ''}`} style={{ wordBreak: 'break-all' }}>{value}</span>
    </div>
  )
}

const ACTION_COLORS = {
  'Blocked':    { bg: 'rgba(239,68,68,0.12)',  color: '#ef4444' },
  'Terminated': { bg: 'rgba(239,68,68,0.12)',  color: '#ef4444' },
  'Allowed':    { bg: 'rgba(245,158,11,0.12)', color: '#f59e0b' },
}

function ExploitBadge({ label, variant = 'default' }) {
  const style = ACTION_COLORS[label] || { bg: 'rgba(107,114,128,0.15)', color: '#9ca3af' }
  return (
    <span style={{
      display: 'inline-block', padding: '1px 7px', borderRadius: 10,
      fontSize: '0.68rem', fontWeight: 600,
      background: style.bg, color: style.color,
    }}>{label}</span>
  )
}

function ExploitsSection({ deviceName }) {
  const [exploits, setExploits] = useState(null)   // null = loading
  const [err, setErr]           = useState(null)
  const [open, setOpen]         = useState(true)

  useEffect(() => {
    getDeviceExploits(deviceName)
      .then(r => setExploits(r.data.exploits))
      .catch(e => {
        const msg = e.response?.data?.detail || 'Failed to load exploit data'
        // Silently hide if Aurora isn't configured
        if (e.response?.status === 503) setExploits([])
        else setErr(msg)
      })
  }, [deviceName])

  return (
    <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8,
          background: 'none', border: 'none', cursor: 'pointer',
          padding: '0 0 10px', textAlign: 'left',
        }}
      >
        <span style={{ fontSize: '0.72rem' }}>{open ? '▾' : '▸'}</span>
        <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)' }}>
          🛡️ Aurora Exploit Events
        </span>
        {exploits !== null && (
          <span style={{
            marginLeft: 'auto',
            fontSize: '0.68rem', fontWeight: 600,
            padding: '1px 7px', borderRadius: 10,
            background: exploits.length > 0 ? 'rgba(239,68,68,0.12)' : 'rgba(34,197,94,0.12)',
            color: exploits.length > 0 ? '#ef4444' : '#22c55e',
          }}>
            {exploits.length > 0 ? `${exploits.length} detected` : 'None detected'}
          </span>
        )}
      </button>

      {open && (
        <>
          {exploits === null && !err && (
            <div className="flex items-center gap-2" style={{ color: 'var(--text-muted)', padding: '4px 0 8px' }}>
              <div className="spinner" style={{ width: 14, height: 14 }} />
              <span style={{ fontSize: '0.75rem' }}>Loading exploit data…</span>
            </div>
          )}

          {err && (
            <div className="alert alert-error" style={{ fontSize: '0.75rem', padding: '6px 10px' }}>{err}</div>
          )}

          {exploits !== null && exploits.length === 0 && !err && (
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0 0 8px' }}>
              No exploit events found for this device.
            </p>
          )}

          {exploits !== null && exploits.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {exploits.map((ex, i) => (
                <div key={i} style={{
                  background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)', padding: '8px 10px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>
                      {ex.violationType}
                    </span>
                    <ExploitBadge label={ex.action} />
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'monospace',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 4 }}
                    title={ex.filePath}>
                    {ex.filePath || '—'}
                  </div>
                  <div style={{ display: 'flex', gap: 12, fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                    {ex.username && <span>👤 {ex.username}</span>}
                    {ex.timestamp && <span>{formatRelativeTime(ex.timestamp)}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default function DeviceDetailModal({ deviceName, onClose }) {
  const [device,  setDevice]  = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    lookupDevice(deviceName)
      .then(r => setDevice(r.data))
      .catch(e => setError(e.response?.data?.detail || 'Failed to load device details.'))
      .finally(() => setLoading(false))
  }, [deviceName])

  const im = device?.immybot
  const aw = device?.aurora

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center gap-3" style={{ marginBottom: 20 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 'var(--radius-sm)', flexShrink: 0,
            background: 'var(--bg-elevated)', border: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem',
          }}>💻</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ fontSize: '1rem', marginBottom: 4 }}>{deviceName}</h2>
            {device && (
              <div className="flex items-center gap-2">
                {device.in_immybot
                  ? <span className="badge badge-purple">ImmyBot</span>
                  : <span className="badge badge-gray" style={{ opacity: 0.4 }}>ImmyBot</span>}
                {device.in_aurora
                  ? <span className="badge badge-cyan">Aurora</span>
                  : <span className="badge badge-gray" style={{ opacity: 0.4 }}>Aurora</span>}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1.1rem', flexShrink: 0, padding: 4 }}
          >✕</button>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center gap-3" style={{ color: 'var(--text-secondary)', padding: '20px 0' }}>
            <div className="spinner" />
            <span className="text-sm">Loading device details…</span>
          </div>
        )}

        {/* Error */}
        {error && <div className="alert alert-error">{error}</div>}

        {/* Combined detail */}
        {device && !loading && (
          <>
            <InfoRow label="Status"     value={im?.isOnline != null ? (im.isOnline ? '🟢 Online' : '⚫ Offline') : (aw?.state || null)} />
            <InfoRow label="OS"         value={im?.operatingSystem || aw?.osVersion} />
            <InfoRow label="Make/Model" value={[im?.manufacturer, im?.model].filter(Boolean).join(' ') || null} />
            <InfoRow label="Serial"     value={im?.serialNumber} mono />
            <InfoRow label="User"       value={im?.primaryUserName || im?.primaryUserEmail} />
            <InfoRow label="Tenant"     value={im?.tenantName} />
            <InfoRow label="Policy"     value={aw?.policy} />
            <InfoRow label="Agent"      value={aw?.agentVersion} />
            <InfoRow label="Last Seen"  value={formatRelativeTime(im?.lastSeen || aw?.dateOffline)} />
            <InfoRow label="MAC(s)"     value={aw?.macAddresses?.length ? aw.macAddresses.join(', ') : null} mono />
            <InfoRow label="IP(s)"      value={aw?.ipAddresses?.length  ? aw.ipAddresses.join(', ')  : null} mono />
            <InfoRow label="Enrolled"   value={aw?.dateRegistered ? new Date(aw.dateRegistered).toLocaleDateString() : null} />

            {/* Aurora exploit events — only shown when device is in Aurora */}
            {device.in_aurora && <ExploitsSection deviceName={deviceName} />}

            {/* Open in ImmyBot */}
            {im?.immybotUrl && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                <a
                  href={im.immybotUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-ghost"
                  style={{ fontSize: '0.75rem', padding: '4px 10px', textDecoration: 'none' }}
                >
                  Open in ImmyBot ↗
                </a>
              </div>
            )}
          </>
        )}

      </div>
    </div>
  )
}
