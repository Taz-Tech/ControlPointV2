import { useState, useContext } from 'react'
import { CredentialsContext } from '../../App.jsx'
import { resetPort } from '../../api/client.js'

export default function PortResetPanel({ seat, switches }) {
  const { credentials, setShowCredModal } = useContext(CredentialsContext)
  const [loading,  setLoading]  = useState(false)
  const [output,   setOutput]   = useState('')
  const [error,    setError]    = useState(null)
  const [success,  setSuccess]  = useState(false)

  const handleReset = async () => {
    if (!seat || !credentials) return
    setLoading(true)
    setOutput('')
    setError(null)
    setSuccess(false)

    try {
      const swInfo = switches.find(s => s.id === seat.switch_id)
      if (!swInfo) throw new Error('Switch not found in registry')

      const res = await resetPort({
        switch_ip:     swInfo.ip_address,
        port:          seat.port,
        username:      credentials.username,
        password:      credentials.password,
        enable_secret: credentials.enable_secret || credentials.password,
      })
      setOutput(res.data.output)
      setSuccess(true)
    } catch (e) {
      const msg = e.response?.data?.detail || e.message || 'Unknown error'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  if (!seat) {
    return (
      <div className="card">
        <div className="card-header"><h3>⚡ Port Reset</h3></div>
        <div className="card-body" style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: '2rem', marginBottom: 12 }}>🖱️</div>
          <p className="text-sm text-muted">Click a seat pin on the floor map<br />to select it for a port reset.</p>
        </div>
      </div>
    )
  }

  const sw = switches.find(s => s.id === seat.switch_id)

  return (
    <div className="card">
      <div className="card-header">
        <h3>⚡ Port Reset</h3>
        {success && <span className="badge badge-green">✓ Completed</span>}
        {error   && <span className="badge badge-red">✗ Error</span>}
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Target info */}
        <div style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}>
          <div className="flex items-center gap-3">
            <span style={{ fontSize: '1.5rem' }}>🪑</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{seat.seat_label}</div>
              <div className="text-xs text-muted">Selected seat</div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <InfoChip label="Switch"  value={sw?.name || '—'} icon="📡" />
            <InfoChip label="IP"      value={sw?.ip_address || '—'} icon="🌐" mono />
            <InfoChip label="Port"    value={seat.port} icon="🔌" mono span2 />
          </div>
        </div>

        {/* Credentials warning */}
        {!credentials && (
          <div className="alert alert-warn">
            ⚠️ SSH credentials not set.{' '}
            <button
              className="btn btn-ghost"
              style={{ fontSize: '0.75rem', padding: '2px 8px', marginLeft: 8 }}
              onClick={() => setShowCredModal(true)}
            >
              Set credentials
            </button>
          </div>
        )}

        {/* Reset button */}
        <button
          id="port-reset-btn"
          className={`btn w-full ${success ? 'btn-success' : 'btn-danger'}`}
          style={{ justifyContent: 'center', padding: '12px', fontSize: '0.95rem', gap: 8 }}
          disabled={loading || !credentials || !sw}
          onClick={handleReset}
        >
          {loading ? (
            <><div className="spinner" style={{ width: 16, height: 16 }} /> Running reset…</>
          ) : (
            <><span>🔒</span> Reset Port Security on {seat.port}</>
          )}
        </button>

        {/* What will happen */}
        <div className="text-xs text-muted" style={{
          background: 'var(--bg-elevated)',
          borderRadius: 'var(--radius-sm)',
          padding: '10px 12px',
          fontFamily: 'var(--font-mono)',
          lineHeight: 2,
        }}>
          <div>1. <span className="text-cyan">interface {seat.port}</span></div>
          <div>2. &nbsp;&nbsp;<span style={{ color: 'var(--red)' }}>shutdown</span></div>
          <div>3. <span className="text-cyan">clear port-security sticky int {seat.port.replace(/GigabitEthernet/g, 'Gi')}</span></div>
          <div>4. &nbsp;&nbsp;<span className="text-green">no shutdown</span></div>
        </div>

        {/* Output terminal */}
        {(output || error) && (
          <div>
            <div className="terminal-header">
              <div className="terminal-dot" style={{ background: '#ff5f56' }} />
              <div className="terminal-dot" style={{ background: '#ffbd2e' }} />
              <div className="terminal-dot" style={{ background: '#27c93f' }} />
              <span style={{ marginLeft: 8 }}>{sw?.ip_address} — SSH Output</span>
            </div>
            {error ? (
              <div className="terminal" style={{ color: 'var(--red)' }}>
                ✗ {error}
              </div>
            ) : (
              <div className="terminal">
                {output}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function InfoChip({ label, value, icon, mono, span2 }) {
  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-sm)',
      padding: '8px 12px',
      gridColumn: span2 ? '1 / -1' : undefined,
    }}>
      <div className="text-xs text-muted" style={{ marginBottom: 2 }}>{icon} {label}</div>
      <div className={`text-sm${mono ? ' font-mono' : ''}`} style={{ fontWeight: 500 }}>{value}</div>
    </div>
  )
}
