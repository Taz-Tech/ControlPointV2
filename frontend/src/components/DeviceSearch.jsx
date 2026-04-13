import { useState, useCallback, useEffect } from 'react'
import { searchDevices, debugDevice, getDeviceExploits } from '../api/client.js'

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
      <span className="text-muted text-xs" style={{ flexShrink: 0, width: 84 }}>{label}</span>
      <span className={`text-sm${mono ? ' font-mono' : ''}`} style={{ wordBreak: 'break-all' }}>{value}</span>
    </div>
  )
}

function CoverageBar({ inImmybot, inAurora, inIntune }) {
  const missing = [!inImmybot, !inAurora, !inIntune].filter(Boolean).length
  const color = missing === 0 ? 'var(--green)' : missing === 1 ? 'var(--yellow)' : 'var(--red)'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
      <div style={{ width: 4, height: 4, borderRadius: 2, background: inImmybot ? 'var(--purple)' : 'var(--border)' }} title="ImmyBot" />
      <div style={{ width: 4, height: 4, borderRadius: 2, background: inAurora  ? 'var(--cyan)'   : 'var(--border)' }} title="Aurora" />
      <div style={{ width: 4, height: 4, borderRadius: 2, background: inIntune  ? 'var(--green)'  : 'var(--border)' }} title="Intune" />
    </div>
  )
}

function DeviceRow({ device, onClick, selected }) {
  const isOnline = device.immybot?.isOnline || device.aurora?.state === 'Online'
  const missing  = [!device.in_immybot, !device.in_aurora, !device.in_intune].filter(Boolean).length

  return (
    <div
      className={`user-result-item${selected ? ' selected' : ''}`}
      onClick={() => onClick(device)}
    >
      {/* Coverage bar (3 colored dots) */}
      <CoverageBar inImmybot={device.in_immybot} inAurora={device.in_aurora} inIntune={device.in_intune} />

      {/* Online dot */}
      <div style={{
        width: 9, height: 9, borderRadius: '50%', flexShrink: 0,
        background: isOnline ? 'var(--green)' : 'var(--border)',
        boxShadow: isOnline ? '0 0 6px var(--green)' : 'none',
      }} />

      {/* Name + sub-info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: '0.88rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {device.name}
        </div>
        <div className="text-xs text-muted" style={{ marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {device.immybot?.operatingSystem || device.intune?.operatingSystem || device.aurora?.osVersion || '—'}
          {device.immybot?.primaryUserName ? ` · ${device.immybot.primaryUserName}` : ''}
          {missing > 0 && (
            <span style={{ marginLeft: 6, color: missing === 1 ? 'var(--yellow)' : 'var(--red)', fontWeight: 600 }}>
              · missing {[
                !device.in_immybot && 'ImmyBot',
                !device.in_aurora  && 'Aurora',
                !device.in_intune  && 'Intune',
              ].filter(Boolean).join(', ')}
            </span>
          )}
        </div>
      </div>

      {/* Integration badges — ✓ present, ✕ missing */}
      <div className="flex items-center gap-1" style={{ flexShrink: 0 }}>
        <span className="badge" style={{ background: device.in_immybot ? 'var(--purple)' : 'transparent', color: device.in_immybot ? '#000' : 'var(--text-muted)', border: `1px solid ${device.in_immybot ? 'var(--purple)' : 'var(--border)'}`, opacity: device.in_immybot ? 1 : 0.5, fontSize: '0.65rem' }}>
          {device.in_immybot ? '✓' : '✕'} Immy
        </span>
        <span className="badge" style={{ background: device.in_aurora ? 'var(--cyan)' : 'transparent', color: device.in_aurora ? '#000' : 'var(--text-muted)', border: `1px solid ${device.in_aurora ? 'var(--cyan)' : 'var(--border)'}`, opacity: device.in_aurora ? 1 : 0.5, fontSize: '0.65rem' }}>
          {device.in_aurora ? '✓' : '✕'} Aurora
        </span>
        <span className="badge" style={{ background: device.in_intune ? 'var(--green)' : 'transparent', color: device.in_intune ? '#000' : 'var(--text-muted)', border: `1px solid ${device.in_intune ? 'var(--green)' : 'var(--border)'}`, opacity: device.in_intune ? 1 : 0.5, fontSize: '0.65rem' }}>
          {device.in_intune ? '✓' : '✕'} Intune
        </span>
      </div>
    </div>
  )
}

const ACTION_COLORS = {
  'Blocked':    { bg: 'rgba(239,68,68,0.12)',  color: '#ef4444' },
  'Terminated': { bg: 'rgba(239,68,68,0.12)',  color: '#ef4444' },
  'Allowed':    { bg: 'rgba(245,158,11,0.12)', color: '#f59e0b' },
}

function ExploitBadge({ label }) {
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
  const [exploits, setExploits] = useState(null)
  const [err, setErr]           = useState(null)
  const [open, setOpen]         = useState(true)

  useEffect(() => {
    getDeviceExploits(deviceName)
      .then(r => setExploits(r.data.exploits))
      .catch(e => {
        if (e.response?.status === 503) setExploits([])
        else setErr(e.response?.data?.detail || 'Failed to load exploit data')
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

function DetailPanel({ device }) {
  if (!device) {
    return (
      <div className="card" style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--text-secondary)', padding: 40 }}>
        <span style={{ fontSize: '2rem' }}>💻</span>
        <p className="text-sm text-muted">Select a device to see details</p>
      </div>
    )
  }

  const { immybot: im, aurora: aw, intune: it } = device

  return (
    <div className="card" style={{ position: 'sticky', top: 0 }}>
      <div className="card-header">
        <div className="flex items-center gap-3">
          <div style={{
            width: 40, height: 40, borderRadius: 'var(--radius-sm)', flexShrink: 0,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '1.2rem',
          }}>💻</div>
          <div>
            <h3 style={{ fontSize: '0.95rem' }}>{device.name}</h3>
            <div className="flex items-center gap-2" style={{ marginTop: 4 }}>
              {device.in_immybot
                ? <span className="badge badge-purple">ImmyBot</span>
                : <span className="badge badge-gray" style={{ opacity: 0.4 }}>ImmyBot</span>}
              {device.in_aurora
                ? <span className="badge badge-cyan">Aurora</span>
                : <span className="badge badge-gray" style={{ opacity: 0.4 }}>Aurora</span>}
              {device.in_intune
                ? <span className="badge badge-green">Intune</span>
                : <span className="badge badge-gray" style={{ opacity: 0.4 }}>Intune</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

        {/* Combined fields */}
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

        {/* Intune-specific fields */}
        {it && (
          <>
            <div style={{ height: 1, background: 'var(--border)', margin: '12px 0' }} />
            <div className="text-xs text-muted" style={{ marginBottom: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Intune
            </div>
            {it.complianceState != null && (
              <div className="flex" style={{ marginBottom: 8, gap: 8, alignItems: 'flex-start' }}>
                <span className="text-muted text-xs" style={{ flexShrink: 0, width: 84 }}>Compliance</span>
                <span className="text-sm" style={{
                  color: it.complianceState === 'compliant'
                    ? 'var(--green)'
                    : it.complianceState === 'noncompliant'
                    ? 'var(--red)'
                    : 'var(--text-secondary)',
                }}>
                  {it.complianceState}
                </span>
              </div>
            )}
            <InfoRow label="Last Sync"    value={formatRelativeTime(it.lastSyncDateTime)} />
            <InfoRow label="Encrypted"    value={it.isEncrypted != null ? (it.isEncrypted ? 'Yes' : 'No') : null} />
            <InfoRow label="Mgmt State"   value={it.managementState} />
            <InfoRow label="Enrolled"     value={it.enrolledDateTime ? new Date(it.enrolledDateTime).toLocaleDateString() : null} />
            {!im?.serialNumber && <InfoRow label="Serial" value={it.serialNumber} mono />}
          </>
        )}

        {/* Aurora exploit events */}
        {device.in_aurora && <ExploitsSection deviceName={device.name} />}

        {/* External links */}
        {(im?.immybotUrl || device.intune?.id) && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            {im?.immybotUrl && (
              <a href={im.immybotUrl} target="_blank" rel="noreferrer" className="btn btn-ghost"
                style={{ fontSize: '0.75rem', padding: '4px 10px', textDecoration: 'none' }}>
                Open in ImmyBot ↗
              </a>
            )}
            {device.intune?.id && (
              <a
                href={`https://intune.microsoft.com/#view/Microsoft_Intune_Devices/DeviceSettingsMenuBlade/~/overview/mdmDeviceId/${device.intune.id}`}
                target="_blank" rel="noreferrer" className="btn btn-ghost"
                style={{ fontSize: '0.75rem', padding: '4px 10px', textDecoration: 'none' }}>
                Open in Intune ↗
              </a>
            )}
          </div>
        )}

      </div>
    </div>
  )
}

function DebugModal({ query, onClose }) {
  const [result,  setResult]  = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    debugDevice(query)
      .then(r => setResult(r.data))
      .catch(() => setError('Debug request failed.'))
      .finally(() => setLoading(false))
  }, [query])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 660, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2" style={{ marginBottom: 4 }}>
          <h2 style={{ fontSize: '1rem' }}>🔬 Name Match Debug</h2>
        </div>
        <p>Raw names returned by each API for <strong>{query}</strong>, and the normalized key used for matching.</p>

        {loading && <div className="flex items-center gap-3"><div className="spinner" /><span className="text-sm">Querying both APIs…</span></div>}
        {error   && <div className="alert alert-error">{error}</div>}

        {result && (
          <div style={{ overflowY: 'auto', flex: 1, paddingRight: 4 }}>
            <div style={{ padding: '8px 12px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', marginBottom: 12 }}>
              <div className="text-sm" style={{ marginBottom: 4 }}>
                <span style={{ color: 'var(--purple)', fontWeight: 700 }}>ImmyBot:</span>{' '}
                {result.immybot_error
                  ? <span style={{ color: 'var(--red)' }}>Error — {result.immybot_error}</span>
                  : <span>{result.immybot_total} devices scanned</span>
                }
              </div>
              <div className="text-sm">
                <span style={{ color: 'var(--cyan)', fontWeight: 700 }}>Aurora:</span>{' '}
                {result.aurora_error
                  ? <span style={{ color: 'var(--red)' }}>Error — {result.aurora_error}</span>
                  : <span>{result.aurora_total} devices scanned</span>
                }
              </div>
              {result.immybot_api_total !== undefined && (
                <div className="text-xs text-muted" style={{ marginTop: 6 }}>
                  ImmyBot API reports total: <span className="font-mono">{String(result.immybot_api_total)}</span>
                  {' | '}response keys: <span className="font-mono">{(result.immybot_response_keys || []).join(', ')}</span>
                </div>
              )}
              {result.immybot_sample?.length > 0 && (
                <div className="text-xs text-muted" style={{ marginTop: 4 }}>
                  ImmyBot name sample: <span className="font-mono">{result.immybot_sample.join(' | ')}</span>
                </div>
              )}
              {result.immybot_filtered?.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  <div className="text-xs" style={{ color: 'var(--yellow, orange)', marginBottom: 4 }}>
                    ImmyBot server-side filter found: <span className="font-mono">{result.immybot_filtered.map(e => e.raw_name).join(' | ')}</span>
                  </div>
                  {result.immybot_filtered_id_check?.map((chk, i) => (
                    <div key={i} className="text-xs" style={{ marginTop: 4, color: chk.in_paginated_results ? 'var(--green, green)' : 'var(--red, red)' }}>
                      ID {chk.id}: {chk.in_paginated_results
                        ? `found in paginated results (computerName: "${chk.paginated_computerName}")`
                        : 'NOT found in paginated results — device is invisible to full scan'}
                    </div>
                  ))}
                  {result.immybot_filtered.map((e, i) => e.raw_record && (
                    <details key={i} style={{ marginTop: 4 }}>
                      <summary className="text-xs" style={{ cursor: 'pointer', color: 'var(--yellow, orange)' }}>
                        Raw ImmyBot fields for {e.raw_name}
                      </summary>
                      <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3, paddingLeft: 8 }}>
                        {Object.entries(e.raw_record).map(([k, v]) => (
                          <div key={k} className="flex" style={{ gap: 8, alignItems: 'flex-start' }}>
                            <span className="text-xs font-mono" style={{ color: 'var(--purple)', flexShrink: 0, width: 180 }}>{k}</span>
                            <span className="text-xs font-mono" style={{ color: 'var(--text-secondary)', wordBreak: 'break-all' }}>
                              {JSON.stringify(v)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </div>

            {result.matched_keys.length > 0 && (
              <div className="alert alert-info" style={{ marginBottom: 12 }}>
                ✅ Matched keys: <strong>{result.matched_keys.join(', ')}</strong>
              </div>
            )}

            <div className="grid-2" style={{ gap: 16, marginBottom: 16 }}>
              {/* ImmyBot column */}
              <div>
                <div className="text-xs text-muted" style={{ marginBottom: 6, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  ImmyBot raw names
                </div>
                {result.immybot.length === 0
                  ? <p className="text-sm text-muted">No results</p>
                  : result.immybot.map((e, i) => (
                    <div key={i} style={{ padding: '6px 10px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', marginBottom: 5 }}>
                      <div className="text-sm font-mono">{e.raw_name}</div>
                      <div className="text-xs text-muted">normalized: <span className="font-mono">{e.normalized}</span></div>
                    </div>
                  ))
                }
              </div>

              {/* Aurora column */}
              <div>
                <div className="text-xs text-muted" style={{ marginBottom: 6, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Aurora raw names
                </div>
                {result.aurora.length === 0
                  ? <p className="text-sm text-muted">No results</p>
                  : result.aurora.map((e, i) => (
                    <div key={i} style={{ padding: '8px 10px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', marginBottom: 5 }}>
                      <div className="text-sm font-mono" style={{ marginBottom: 4 }}>{e.raw_name}</div>
                      <div className="text-xs text-muted" style={{ marginBottom: 6 }}>normalized: <span className="font-mono">{e.normalized}</span></div>
                      {e.raw_record && (
                        <details>
                          <summary className="text-xs text-muted" style={{ cursor: 'pointer', marginBottom: 4 }}>Raw Aurora fields</summary>
                          <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
                            {Object.entries(e.raw_record).map(([k, v]) => (
                              <div key={k} className="flex" style={{ gap: 8, alignItems: 'flex-start' }}>
                                <span className="text-xs font-mono" style={{ color: 'var(--cyan)', flexShrink: 0, width: 180 }}>{k}</span>
                                <span className="text-xs font-mono" style={{ color: 'var(--text-secondary)', wordBreak: 'break-all' }}>
                                  {JSON.stringify(v)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </details>
                      )}
                    </div>
                  ))
                }
              </div>
            </div>

            {result.immybot_only_keys.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <span className="badge badge-purple" style={{ marginRight: 8 }}>ImmyBot only</span>
                <span className="text-sm font-mono">{result.immybot_only_keys.join(', ')}</span>
              </div>
            )}
            {result.aurora_only_keys.length > 0 && (
              <div>
                <span className="badge badge-cyan" style={{ marginRight: 8 }}>Aurora only</span>
                <span className="text-sm font-mono">{result.aurora_only_keys.join(', ')}</span>
              </div>
            )}
          </div>
        )}

        <div style={{ marginTop: 20, textAlign: 'right' }}>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

const FILTERS = [
  { key: 'all',             label: 'All',                badgeClass: 'badge-gray'   },
  { key: 'complete',        label: '✓ All 3',            badgeClass: 'badge-green'  },
  { key: 'incomplete',      label: '⚠ Any Missing',      badgeClass: 'badge-yellow' },
  { key: 'no_immybot',      label: '✕ Missing ImmyBot',  badgeClass: 'badge-purple' },
  { key: 'no_aurora',       label: '✕ Missing Aurora',   badgeClass: 'badge-cyan'   },
  { key: 'no_intune',       label: '✕ Missing Intune',   badgeClass: 'badge-green'  },
]

function applyFilter(devices, filter) {
  if (filter === 'complete')   return devices.filter(d =>  d.in_immybot &&  d.in_aurora &&  d.in_intune)
  if (filter === 'incomplete') return devices.filter(d => !d.in_immybot || !d.in_aurora || !d.in_intune)
  if (filter === 'no_immybot') return devices.filter(d => !d.in_immybot)
  if (filter === 'no_aurora')  return devices.filter(d => !d.in_aurora)
  if (filter === 'no_intune')  return devices.filter(d => !d.in_intune)
  return devices
}

export default function DeviceSearch() {
  const [query,    setQuery]    = useState('')
  const [devices,  setDevices]  = useState([])
  const [loading,  setLoading]  = useState(false)
  const [searched, setSearched] = useState(false)
  const [selected, setSelected] = useState(null)
  const [error,    setError]    = useState(null)
  const [meta,      setMeta]      = useState({ immybot_configured: true, aurora_configured: true, intune_configured: true })
  const [filter,    setFilter]    = useState('all')
  const [showDebug, setShowDebug] = useState(false)
  const [apiErrors, setApiErrors] = useState([])

  const doSearch = useCallback(async () => {
    setLoading(true)
    setError(null)
    setSelected(null)
    setApiErrors([])
    try {
      const { data } = await searchDevices()
      setDevices(data.devices || [])
      setMeta({ immybot_configured: data.immybot_configured, aurora_configured: data.aurora_configured, intune_configured: data.intune_configured })
      setApiErrors(data.errors || [])
      setSearched(true)
    } catch {
      setError('Failed to fetch devices. Check that integrations are configured.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { doSearch() }, [doSearch])

  const filtered = query.trim()
    ? devices.filter(d => d.name.toLowerCase().includes(query.toLowerCase()))
    : devices

  const counts = {
    all:        filtered.length,
    complete:   filtered.filter(d =>  d.in_immybot &&  d.in_aurora &&  d.in_intune).length,
    incomplete: filtered.filter(d => !d.in_immybot || !d.in_aurora || !d.in_intune).length,
    no_immybot: filtered.filter(d => !d.in_immybot).length,
    no_aurora:  filtered.filter(d => !d.in_aurora).length,
    no_intune:  filtered.filter(d => !d.in_intune).length,
  }

  const visible = applyFilter(filtered, filter)

  return (
    <div className={selected ? 'user-lookup-layout' : ''}>

      {/* ── LEFT column ──────────────────────────────────────────────────── */}
      <div className="user-lookup-left">
        <div className="card">
          <div className="card-header">
            <div className="flex items-center gap-2">
              <span style={{ fontSize: '1rem' }}>💻</span>
              <h3>Device Search</h3>
              {searched && !loading && (
                <span className="badge badge-gray" style={{ marginLeft: 4 }}>{visible.length}</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className={`badge ${meta.immybot_configured ? 'badge-purple' : 'badge-gray'}`}>ImmyBot</span>
              <span className={`badge ${meta.aurora_configured  ? 'badge-cyan'   : 'badge-gray'}`}>Aurora</span>
              <span className={`badge ${meta.intune_configured  ? 'badge-green'  : 'badge-gray'}`}>Intune</span>
            </div>
          </div>

          <div className="card-body">
            {/* Search bar */}
            <div className="flex items-center gap-2">
              <div className="search-bar" style={{ flex: 1 }}>
                <span className="search-icon">🔍</span>
                <input
                  className="input"
                  placeholder="Filter by device name…"
                  value={query}
                  onChange={e => { setQuery(e.target.value); setSelected(null) }}
                  autoComplete="off"
                />
              </div>
              {query.trim() && (
                <button
                  className="btn btn-ghost"
                  onClick={() => setShowDebug(true)}
                  title="Debug name matching for this device"
                  style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                >
                  🔬 Debug
                </button>
              )}
            </div>

            {/* Filter tabs */}
            {searched && !loading && (
              <div className="flex items-center gap-2 mt-3" style={{ flexWrap: 'wrap' }}>
                {FILTERS.map(f => (
                  <button
                    key={f.key}
                    onClick={() => { setFilter(f.key); setSelected(null) }}
                    className={`badge ${filter === f.key ? f.badgeClass : 'badge-gray'}`}
                    style={{
                      cursor: 'pointer',
                      border: 'none',
                      opacity: filter === f.key ? 1 : 0.6,
                      transition: 'opacity 0.15s',
                      fontFamily: 'inherit',
                    }}
                  >
                    {f.label} {counts[f.key] > 0 ? `(${counts[f.key]})` : '(0)'}
                  </button>
                ))}
              </div>
            )}

            {/* Config warnings */}
            {searched && !meta.immybot_configured && (
              <div className="alert alert-warn mt-3">
                ImmyBot is not configured — showing Aurora and Intune devices only.
              </div>
            )}
            {searched && !meta.aurora_configured && (
              <div className="alert alert-warn mt-3">
                Aurora is not configured — showing ImmyBot and Intune devices only.
              </div>
            )}
            {searched && !meta.intune_configured && (
              <div className="alert alert-warn mt-3">
                Intune is not configured — showing ImmyBot and Aurora devices only.
              </div>
            )}

            {error && (
              <div className="alert alert-error mt-3">⚠️ {error}</div>
            )}

            {apiErrors.map((e, i) => (
              <div key={i} className="alert alert-error mt-3">⚠️ {e}</div>
            ))}

            {loading && (
              <div className="flex items-center gap-3 mt-4" style={{ color: 'var(--text-secondary)' }}>
                <div className="spinner" />
                <span className="text-sm">Loading devices…</span>
              </div>
            )}

            {/* Device list */}
            {searched && !loading && visible.length === 0 && !error && (
              <div className="text-sm text-muted mt-4" style={{ textAlign: 'center', padding: 32 }}>
                No devices match this filter.
              </div>
            )}

            {searched && !loading && visible.length > 0 && (
              <div style={{ marginTop: 14 }}>
                {visible.map(d => (
                  <DeviceRow
                    key={d.name}
                    device={d}
                    onClick={d => setSelected(s => s?.name === d.name ? null : d)}
                    selected={selected?.name === d.name}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── RIGHT column — shown when a device is selected ────────────────── */}
      {selected && (
        <div className="user-lookup-right">
          <DetailPanel device={selected} />
        </div>
      )}

      {showDebug && (
        <DebugModal query={query.trim()} onClose={() => setShowDebug(false)} />
      )}

    </div>
  )
}
