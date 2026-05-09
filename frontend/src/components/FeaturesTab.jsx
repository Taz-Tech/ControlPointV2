import { useState, useEffect } from 'react'
import { api } from '../api/client.js'

const CATEGORY_ORDER = ['ticketing', 'it_management', 'general']
const CATEGORY_LABEL = { ticketing: 'Ticketing', it_management: 'IT Management', general: 'General' }

const NATIVE_INCLUDES = [
  'Tickets, tasks, and queues',
  'Change & problem management',
  'Project boards',
  'Knowledge base',
  'SLA tracking & reporting',
  'Customer self-service portal',
]

const PROVIDER_FIELDS = {
  freshservice: [
    { key: 'domain',  label: 'Domain',  placeholder: 'yourco.freshservice.com', type: 'text' },
    { key: 'api_key', label: 'API Key', placeholder: 'Your Freshservice API key', type: 'password' },
  ],
  jira: [
    { key: 'base_url',  label: 'Base URL',    placeholder: 'https://yourco.atlassian.net', type: 'text' },
    { key: 'email',     label: 'Email',        placeholder: 'admin@yourco.com', type: 'text' },
    { key: 'api_token', label: 'API Token',    placeholder: 'Your Jira API token', type: 'password' },
    { key: 'project',   label: 'Project Key',  placeholder: 'IT', type: 'text' },
  ],
  servicenow: [
    { key: 'instance', label: 'Instance', placeholder: 'yourco (from yourco.service-now.com)', type: 'text' },
    { key: 'username', label: 'Username', placeholder: 'admin', type: 'text' },
    { key: 'password', label: 'Password', placeholder: 'Service account password', type: 'password' },
  ],
  zendesk: [
    { key: 'subdomain', label: 'Subdomain', placeholder: 'yourco (from yourco.zendesk.com)', type: 'text' },
    { key: 'email',     label: 'Email',     placeholder: 'admin@yourco.com', type: 'text' },
    { key: 'api_token', label: 'API Token', placeholder: 'Your Zendesk API token', type: 'password' },
  ],
}

const PROVIDER_LABEL = { freshservice: 'Freshservice', jira: 'Jira', servicenow: 'ServiceNow', zendesk: 'Zendesk' }

// ── Ticketing section ─────────────────────────────────────────────────────────

function ProviderConfig({ feature, onSaved }) {
  const existingCfg = feature.config || {}
  const [provider, setProvider] = useState(existingCfg.provider || 'freshservice')
  const [fields,   setFields]   = useState(existingCfg[existingCfg.provider || 'freshservice'] || {})
  const [saving,   setSaving]   = useState(false)
  const [msg,      setMsg]      = useState(null)

  const changeProvider = p => { setProvider(p); setFields(existingCfg[p] || {}) }
  const setField = k => e => setFields(f => ({ ...f, [k]: e.target.value }))

  const save = async () => {
    setSaving(true); setMsg(null)
    try {
      await api.put('/api/features/external_ticketing/config', { provider, [provider]: fields })
      setMsg({ ok: true, text: 'Configuration saved' })
      onSaved?.()
    } catch (e) {
      setMsg({ ok: false, text: e.response?.data?.detail || 'Save failed' })
    } finally {
      setSaving(false)
    }
  }

  const inp = {
    width: '100%', padding: '7px 10px', borderRadius: 6,
    border: '1px solid var(--border)', background: 'var(--bg-surface)',
    color: 'var(--text)', fontSize: '0.85rem', boxSizing: 'border-box',
  }
  const lbl = { fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }

  return (
    <div style={{ marginTop: 14, padding: 16, background: 'var(--bg-elevated)', borderRadius: 8, border: '1px solid var(--border)' }}>
      <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: 12, letterSpacing: '0.06em' }}>
        PROVIDER CONFIGURATION
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={lbl}>Select your ticket system</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {Object.keys(PROVIDER_FIELDS).map(p => (
            <button key={p} onClick={() => changeProvider(p)} style={{
              padding: '5px 14px', borderRadius: 20, cursor: 'pointer',
              fontSize: '0.8rem', fontWeight: 600,
              border: `1px solid ${provider === p ? 'var(--cyan)' : 'var(--border)'}`,
              background: provider === p ? 'var(--cyan-dim)' : 'transparent',
              color: provider === p ? 'var(--cyan)' : 'var(--text-muted)',
            }}>
              {PROVIDER_LABEL[p]}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {(PROVIDER_FIELDS[provider] || []).map(f => (
          <div key={f.key}>
            <label style={lbl}>{f.label}</label>
            <input style={inp} type={f.type} placeholder={f.placeholder}
              value={fields[f.key] || ''} onChange={setField(f.key)} />
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
        <button onClick={save} disabled={saving} style={{
          padding: '7px 18px', borderRadius: 7, border: 'none',
          background: 'var(--cyan)', color: '#fff', fontWeight: 600,
          fontSize: '0.83rem', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1,
        }}>
          {saving ? 'Saving…' : 'Save Configuration'}
        </button>
        {msg && <span style={{ fontSize: '0.8rem', color: msg.ok ? 'var(--green)' : 'var(--red)' }}>
          {msg.ok ? '✓' : '✗'} {msg.text}
        </span>}
      </div>
    </div>
  )
}

function TicketingSection({ native, external, onToggle, onSaved }) {
  const [showConfig, setShowConfig] = useState(external?.enabled || false)
  const [toggling,   setToggling]   = useState(null)

  const activate = async (key) => {
    setToggling(key)
    try {
      await onToggle(key, true)
      if (key === 'external_ticketing') setShowConfig(true)
    } finally {
      setToggling(null)
    }
  }

  const deactivate = async (key) => {
    setToggling(key)
    try {
      await onToggle(key, false)
      if (key === 'external_ticketing') setShowConfig(false)
    } finally {
      setToggling(null)
    }
  }

  const card = (active) => ({
    flex: 1, borderRadius: 10, padding: 20, cursor: 'pointer',
    border: `2px solid ${active ? 'var(--cyan)' : 'var(--border)'}`,
    background: active ? 'var(--cyan-dim)' : 'var(--bg-surface)',
    transition: 'all 0.15s', position: 'relative',
  })

  const nativeActive   = native?.enabled   ?? false
  const externalActive = external?.enabled ?? false

  return (
    <div>
      <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.07em', marginBottom: 14, textTransform: 'uppercase' }}>
        Ticketing
      </div>
      <p style={{ fontSize: '0.83rem', color: 'var(--text-muted)', marginBottom: 16, marginTop: 0 }}>
        Choose one ticketing mode. Native gives you a full built-in platform. External connects your existing system.
      </p>

      <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>

        {/* Native ticketing card */}
        <div style={card(nativeActive)}>
          {nativeActive && (
            <span style={{ position: 'absolute', top: 12, right: 12, fontSize: '0.68rem', fontWeight: 700, color: 'var(--cyan)', background: 'var(--bg-surface)', padding: '2px 8px', borderRadius: 20, border: '1px solid var(--cyan)' }}>
              ACTIVE
            </span>
          )}
          <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: 6 }}>Native Ticketing</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 14, lineHeight: 1.5 }}>
            Full built-in ticketing platform managed entirely within ControlPoint.
          </div>
          <ul style={{ margin: '0 0 16px', padding: '0 0 0 16px', fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.8 }}>
            {NATIVE_INCLUDES.map(item => <li key={item}>{item}</li>)}
          </ul>
          {nativeActive ? (
            <button onClick={() => deactivate('native_ticketing')} disabled={toggling === 'native_ticketing'} style={{
              width: '100%', padding: '7px', borderRadius: 7, fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer',
              border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)',
            }}>
              {toggling === 'native_ticketing' ? 'Updating…' : 'Disable'}
            </button>
          ) : (
            <button onClick={() => activate('native_ticketing')} disabled={!!toggling} style={{
              width: '100%', padding: '7px', borderRadius: 7, fontWeight: 600, fontSize: '0.82rem', cursor: toggling ? 'not-allowed' : 'pointer',
              border: 'none', background: 'var(--cyan)', color: '#fff', opacity: toggling ? 0.6 : 1,
            }}>
              {toggling === 'native_ticketing' ? 'Enabling…' : 'Enable Native Ticketing'}
            </button>
          )}
        </div>

        {/* External ticketing card */}
        <div style={card(externalActive)}>
          {externalActive && (
            <span style={{ position: 'absolute', top: 12, right: 12, fontSize: '0.68rem', fontWeight: 700, color: 'var(--cyan)', background: 'var(--bg-surface)', padding: '2px 8px', borderRadius: 20, border: '1px solid var(--cyan)' }}>
              ACTIVE
            </span>
          )}
          <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: 6 }}>External Integration</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 14, lineHeight: 1.5 }}>
            Connect your existing ticket system and view tickets directly in ControlPoint.
          </div>
          <ul style={{ margin: '0 0 16px', padding: '0 0 0 16px', fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.8 }}>
            <li>Freshservice</li>
            <li>Jira / Jira Service Management</li>
            <li>ServiceNow</li>
            <li>Zendesk</li>
          </ul>
          {externalActive ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button onClick={() => setShowConfig(v => !v)} style={{
                width: '100%', padding: '7px', borderRadius: 7, fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer',
                border: '1px solid var(--cyan)', background: 'transparent', color: 'var(--cyan)',
              }}>
                {showConfig ? 'Hide Configuration' : 'Configure Provider'}
              </button>
              <button onClick={() => deactivate('external_ticketing')} disabled={toggling === 'external_ticketing'} style={{
                width: '100%', padding: '7px', borderRadius: 7, fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer',
                border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)',
              }}>
                {toggling === 'external_ticketing' ? 'Updating…' : 'Disable'}
              </button>
            </div>
          ) : (
            <button onClick={() => activate('external_ticketing')} disabled={!!toggling} style={{
              width: '100%', padding: '7px', borderRadius: 7, fontWeight: 600, fontSize: '0.82rem', cursor: toggling ? 'not-allowed' : 'pointer',
              border: 'none', background: 'var(--cyan)', color: '#fff', opacity: toggling ? 0.6 : 1,
            }}>
              {toggling === 'external_ticketing' ? 'Enabling…' : 'Enable External Integration'}
            </button>
          )}
        </div>
      </div>

      {externalActive && showConfig && external && (
        <ProviderConfig feature={external} onSaved={onSaved} />
      )}

      {!nativeActive && !externalActive && (
        <div style={{ padding: '12px 16px', background: 'var(--bg-elevated)', borderRadius: 8, fontSize: '0.82rem', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
          No ticketing mode is active. Select one above to enable the Ticketing workspace.
        </div>
      )}
    </div>
  )
}

// ── Generic feature toggle (IT Management, etc.) ──────────────────────────────

function Toggle({ enabled, onChange, disabled }) {
  return (
    <div onClick={() => !disabled && onChange(!enabled)} style={{
      width: 44, height: 24, borderRadius: 12, flexShrink: 0,
      background: enabled ? 'var(--cyan)' : 'var(--bg-elevated)',
      border: `2px solid ${enabled ? 'var(--cyan)' : 'var(--border)'}`,
      cursor: disabled ? 'not-allowed' : 'pointer',
      position: 'relative', transition: 'all 0.2s', opacity: disabled ? 0.5 : 1,
    }}>
      <div style={{
        width: 16, height: 16, borderRadius: '50%',
        background: enabled ? '#fff' : 'var(--text-muted)',
        position: 'absolute', top: 2, left: enabled ? 22 : 2, transition: 'left 0.2s',
      }} />
    </div>
  )
}

function FeatureCard({ feature, onToggle }) {
  const [toggling, setToggling] = useState(false)
  const toggle = async () => {
    setToggling(true)
    try { await onToggle(feature.key, !feature.enabled) }
    finally { setToggling(false) }
  }
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 14, padding: 16,
      background: 'var(--bg-surface)', border: `1px solid ${feature.enabled ? 'var(--cyan)44' : 'var(--border)'}`,
      borderRadius: 10, transition: 'border-color 0.15s',
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontWeight: 700, fontSize: '0.92rem' }}>{feature.name}</span>
          {feature.enabled && (
            <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--cyan)', background: 'var(--cyan-dim)', padding: '1px 7px', borderRadius: 20 }}>ACTIVE</span>
          )}
        </div>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>{feature.description}</p>
        {feature.updated_by && feature.updated_at && (
          <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '6px 0 0', opacity: 0.7 }}>
            Last updated by {feature.updated_by} · {new Date(feature.updated_at).toLocaleDateString()}
          </p>
        )}
      </div>
      <Toggle enabled={feature.enabled} onChange={toggle} disabled={toggling} />
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function FeaturesTab() {
  const [features, setFeatures] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [err,      setErr]      = useState(null)

  const load = () => {
    setLoading(true)
    api.get('/api/features')
      .then(r => setFeatures(r.data))
      .catch(() => setErr('Failed to load features'))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const handleToggle = async (key, enabled) => {
    const { data: updated } = await api.patch(`/api/features/${key}`, { enabled })
    // Refresh all features since toggling ticketing modes flips both rows
    load()
    return updated
  }

  if (loading) return <div style={{ padding: 32, color: 'var(--text-muted)', fontSize: '0.88rem' }}>Loading…</div>
  if (err)     return <div style={{ padding: 32, color: 'var(--red)',         fontSize: '0.88rem' }}>{err}</div>

  const byKey      = Object.fromEntries(features.map(f => [f.key, f]))
  const nonTicket  = features.filter(f => f.category !== 'ticketing')
  const byCategory = CATEGORY_ORDER.slice(1).reduce((acc, cat) => {
    const items = nonTicket.filter(f => f.category === cat)
    if (items.length) acc.push({ cat, items })
    return acc
  }, [])

  return (
    <div style={{ maxWidth: 800, padding: '8px 0' }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: '0 0 6px' }}>Features</h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>
          Enable product capabilities for this tenant. Changes take effect immediately.
        </p>
      </div>

      {/* Ticketing — always rendered as a special two-option section */}
      <div style={{ marginBottom: 32 }}>
        <TicketingSection
          native={byKey['native_ticketing']}
          external={byKey['external_ticketing']}
          onToggle={handleToggle}
          onSaved={load}
        />
      </div>

      {/* All other categories — simple toggles */}
      {byCategory.map(({ cat, items }) => (
        <div key={cat} style={{ marginBottom: 28 }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.07em', marginBottom: 12, textTransform: 'uppercase' }}>
            {CATEGORY_LABEL[cat] || cat}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {items.map(f => (
              <FeatureCard key={f.key} feature={f} onToggle={handleToggle} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
