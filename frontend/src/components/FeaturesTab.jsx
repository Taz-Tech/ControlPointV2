import { useState, useEffect } from 'react'
import { api } from '../api/client.js'

const CATEGORY_LABEL = {
  ticketing:     'Ticketing',
  it_management: 'IT Management',
  general:       'General',
}

const CATEGORY_ORDER = ['ticketing', 'it_management', 'general']

const PROVIDER_FIELDS = {
  freshservice: [
    { key: 'domain',  label: 'Domain',  placeholder: 'yourco.freshservice.com', type: 'text' },
    { key: 'api_key', label: 'API Key', placeholder: 'Your Freshservice API key', type: 'password' },
  ],
  jira: [
    { key: 'base_url',   label: 'Base URL',   placeholder: 'https://yourco.atlassian.net', type: 'text' },
    { key: 'email',      label: 'Email',      placeholder: 'admin@yourco.com', type: 'text' },
    { key: 'api_token',  label: 'API Token',  placeholder: 'Your Jira API token', type: 'password' },
    { key: 'project',    label: 'Project Key', placeholder: 'IT', type: 'text' },
  ],
  servicenow: [
    { key: 'instance',  label: 'Instance',  placeholder: 'yourco (from yourco.service-now.com)', type: 'text' },
    { key: 'username',  label: 'Username',  placeholder: 'admin', type: 'text' },
    { key: 'password',  label: 'Password',  placeholder: 'Service account password', type: 'password' },
  ],
  zendesk: [
    { key: 'subdomain',  label: 'Subdomain',  placeholder: 'yourco (from yourco.zendesk.com)', type: 'text' },
    { key: 'email',      label: 'Email',      placeholder: 'admin@yourco.com', type: 'text' },
    { key: 'api_token',  label: 'API Token',  placeholder: 'Your Zendesk API token', type: 'password' },
  ],
}

function Toggle({ enabled, onChange, disabled }) {
  return (
    <div
      onClick={() => !disabled && onChange(!enabled)}
      style={{
        width: 44, height: 24, borderRadius: 12, flexShrink: 0,
        background: enabled ? 'var(--cyan)' : 'var(--bg-elevated)',
        border: `2px solid ${enabled ? 'var(--cyan)' : 'var(--border)'}`,
        cursor: disabled ? 'not-allowed' : 'pointer',
        position: 'relative', transition: 'all 0.2s', opacity: disabled ? 0.5 : 1,
      }}
    >
      <div style={{
        width: 16, height: 16, borderRadius: '50%',
        background: enabled ? '#fff' : 'var(--text-muted)',
        position: 'absolute', top: 2,
        left: enabled ? 22 : 2,
        transition: 'left 0.2s',
      }} />
    </div>
  )
}

function ExternalTicketingConfig({ feature, onSaved }) {
  const existingCfg = feature.config || {}
  const [provider, setProvider] = useState(existingCfg.provider || 'freshservice')
  const [fields,   setFields]   = useState(existingCfg[existingCfg.provider || 'freshservice'] || {})
  const [saving,   setSaving]   = useState(false)
  const [msg,      setMsg]      = useState(null)

  const providerFields = PROVIDER_FIELDS[provider] || []

  const setField = key => e => setFields(f => ({ ...f, [key]: e.target.value }))

  // Reset fields when provider changes
  const changeProvider = p => {
    setProvider(p)
    setFields(existingCfg[p] || {})
  }

  const save = async () => {
    setSaving(true); setMsg(null)
    try {
      await api.put(`/api/features/external_ticketing/config`, {
        provider,
        [provider]: fields,
      })
      setMsg({ ok: true, text: 'Saved' })
      onSaved?.()
    } catch (e) {
      setMsg({ ok: false, text: e.response?.data?.detail || 'Save failed' })
    } finally {
      setSaving(false)
    }
  }

  const inputStyle = {
    width: '100%', padding: '7px 10px', borderRadius: 6,
    border: '1px solid var(--border)', background: 'var(--bg-elevated)',
    color: 'var(--text)', fontSize: '0.85rem', boxSizing: 'border-box',
  }
  const labelStyle = { fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }

  return (
    <div style={{ marginTop: 16, padding: 16, background: 'var(--bg-elevated)', borderRadius: 8, border: '1px solid var(--border)' }}>
      <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: 12, letterSpacing: '0.05em' }}>
        PROVIDER CONFIGURATION
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>Ticket System</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {Object.keys(PROVIDER_FIELDS).map(p => (
            <button
              key={p}
              onClick={() => changeProvider(p)}
              style={{
                padding: '5px 14px', borderRadius: 20, border: '1px solid',
                cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600,
                borderColor:  provider === p ? 'var(--cyan)' : 'var(--border)',
                background:   provider === p ? 'var(--cyan-dim)' : 'transparent',
                color:        provider === p ? 'var(--cyan)' : 'var(--text-muted)',
              }}
            >
              {{ freshservice: 'Freshservice', jira: 'Jira', servicenow: 'ServiceNow', zendesk: 'Zendesk' }[p]}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {providerFields.map(f => (
          <div key={f.key}>
            <label style={labelStyle}>{f.label}</label>
            <input
              style={inputStyle}
              type={f.type}
              placeholder={f.placeholder}
              value={fields[f.key] || ''}
              onChange={setField(f.key)}
            />
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
        <button
          onClick={save}
          disabled={saving}
          style={{
            padding: '7px 18px', borderRadius: 7, border: 'none',
            background: 'var(--cyan)', color: '#fff', fontWeight: 600,
            fontSize: '0.83rem', cursor: saving ? 'not-allowed' : 'pointer',
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? 'Saving…' : 'Save Configuration'}
        </button>
        {msg && (
          <span style={{ fontSize: '0.8rem', color: msg.ok ? 'var(--green)' : 'var(--red)' }}>
            {msg.ok ? '✓' : '✗'} {msg.text}
          </span>
        )}
      </div>
    </div>
  )
}

function FeatureCard({ feature, onToggle, onSaved }) {
  const [toggling, setToggling] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const hasConfig = feature.key === 'external_ticketing'

  const toggle = async () => {
    setToggling(true)
    try {
      await onToggle(feature.key, !feature.enabled)
      if (!feature.enabled && hasConfig) setExpanded(true)
    } finally {
      setToggling(false)
    }
  }

  return (
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border)',
      borderRadius: 10, padding: 16, transition: 'border-color 0.15s',
      borderColor: feature.enabled ? 'var(--cyan)44' : 'var(--border)',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontWeight: 700, fontSize: '0.92rem' }}>{feature.name}</span>
            {feature.enabled && (
              <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--cyan)', background: 'var(--cyan-dim)', padding: '1px 7px', borderRadius: 20 }}>
                ACTIVE
              </span>
            )}
          </div>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
            {feature.description}
          </p>
          {feature.updated_by && feature.updated_at && (
            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '6px 0 0', opacity: 0.7 }}>
              Last updated by {feature.updated_by} · {new Date(feature.updated_at).toLocaleDateString()}
            </p>
          )}
        </div>
        <Toggle enabled={feature.enabled} onChange={toggle} disabled={toggling} />
      </div>

      {hasConfig && feature.enabled && (
        <div>
          <button
            onClick={() => setExpanded(e => !e)}
            style={{ marginTop: 10, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--cyan)', fontSize: '0.8rem', fontWeight: 600, padding: 0 }}
          >
            {expanded ? '▲ Hide configuration' : '▼ Configure provider'}
          </button>
          {expanded && <ExternalTicketingConfig feature={feature} onSaved={onSaved} />}
        </div>
      )}
    </div>
  )
}

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
    const updated = await api.patch(`/api/features/${key}`, { enabled })
    setFeatures(fs => fs.map(f => f.key === key ? updated.data : f))
  }

  if (loading) return <div style={{ padding: 32, color: 'var(--text-muted)', fontSize: '0.88rem' }}>Loading…</div>
  if (err)     return <div style={{ padding: 32, color: 'var(--red)', fontSize: '0.88rem' }}>{err}</div>

  const grouped = CATEGORY_ORDER.reduce((acc, cat) => {
    const items = features.filter(f => f.category === cat)
    if (items.length) acc.push({ cat, items })
    return acc
  }, [])

  return (
    <div style={{ maxWidth: 760, padding: '8px 0' }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: '0 0 6px' }}>Features</h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>
          Enable or disable product capabilities for this tenant. Changes take effect immediately.
        </p>
      </div>

      {grouped.map(({ cat, items }) => (
        <div key={cat} style={{ marginBottom: 28 }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.07em', marginBottom: 12, textTransform: 'uppercase' }}>
            {CATEGORY_LABEL[cat] || cat}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {items.map(f => (
              <FeatureCard key={f.key} feature={f} onToggle={handleToggle} onSaved={load} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
