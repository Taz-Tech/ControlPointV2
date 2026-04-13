import { useState, useEffect, useContext, useRef, useCallback } from 'react'
import FloorMapManager from './PortSecurity/FloorMapManager.jsx'
import ReactCrop, { centerCrop, makeAspectCrop } from 'react-image-crop'
import 'react-image-crop/dist/ReactCrop.css'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()
import { api } from '../api/client.js'
import { getShortcuts, createShortcut, updateShortcut, deleteShortcut, uploadShortcutIcon, uploadLogo, deleteLogo, uploadFavicon, deleteFavicon, uploadIcon, deleteIcon, getPortalUsers, updateUserRole, updateUserProfile, updateUserRCAccess, inviteUser, deletePortalUser,
  getSites, createSite, deleteSite, getSwitches, getMaps, getMap, addSwitch, deleteSwitch, uploadMap, deleteMap,
  addSwitchToSite, removeSwitchFromSite, addMapToSite, removeMapFromSite,
  getIntegrations, updateIntegration, testIntegration, uploadIntegrationFile,
  getConferenceRooms, getRoomConfigs, upsertRoomConfig, deleteRoomConfig } from '../api/client.js'
import { UserContext } from '../App.jsx'

function InfoRow({ label, value, mono }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 16 }}>
      <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</span>
      <span style={{ fontSize: '0.875rem', fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)', color: 'var(--text-primary)', wordBreak: 'break-all' }}>{value || '—'}</span>
    </div>
  )
}

/* ── Role definitions ────────────────────────────────────────────────────── */

const TEAM_ROLES = [
  { value: 'service_desk',      label: 'Service Desk' },
  { value: 'applications_team', label: 'Applications Team' },
  { value: 'net_inf_team',      label: 'Net/INF Team' },
]

const ALL_ROLES = [
  { value: 'user',              label: 'User' },
  ...TEAM_ROLES,
  { value: 'admin',             label: 'Admin' },
]

function roleLabel(value) {
  return ALL_ROLES.find(r => r.value === value)?.label ?? value
}

/* ── Quick Links tab (admin only) ────────────────────────────────────────── */

/* ── Icon crop helper ─────────────────────────────────────────────────────── */

function getCroppedBlob(image, crop, fileName) {
  const canvas = document.createElement('canvas')
  const scaleX = image.naturalWidth  / image.width
  const scaleY = image.naturalHeight / image.height
  canvas.width  = crop.width
  canvas.height = crop.height
  const ctx = canvas.getContext('2d')
  ctx.drawImage(
    image,
    crop.x * scaleX, crop.y * scaleY,
    crop.width * scaleX, crop.height * scaleY,
    0, 0, crop.width, crop.height,
  )
  return new Promise(resolve => canvas.toBlob(blob => resolve(new File([blob], fileName, { type: 'image/png' })), 'image/png'))
}

function IconCropModal({ src, fileName, onConfirm, onCancel }) {
  const [crop, setCrop]       = useState()
  const [completed, setCompleted] = useState()
  const imgRef = useRef()

  const onLoad = useCallback((e) => {
    const { width, height } = e.currentTarget
    const initial = centerCrop(
      makeAspectCrop({ unit: '%', width: 60 }, 1, width, height),
      width, height,
    )
    setCrop(initial)
    setCompleted(initial)
  }, [])

  const handleConfirm = async () => {
    if (!completed || !imgRef.current) return
    const file = await getCroppedBlob(imgRef.current, completed, fileName)
    onConfirm(file)
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 3000,
      background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onCancel}>
      <div style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)', padding: 24, maxWidth: 520, width: '100%',
        display: 'flex', flexDirection: 'column', gap: 16,
      }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: '0.95rem', fontWeight: 700 }}>Crop Icon</div>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
          Drag and resize the selection to capture the logo area.
        </p>
        <div style={{ display: 'flex', justifyContent: 'center', maxHeight: 400, overflow: 'auto' }}>
          <ReactCrop
            crop={crop}
            onChange={c => setCrop(c)}
            onComplete={c => setCompleted(c)}
            aspect={1}
            minWidth={20}
            minHeight={20}
          >
            <img ref={imgRef} src={src} onLoad={onLoad} style={{ maxWidth: '100%', maxHeight: 380 }} alt="crop source" />
          </ReactCrop>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={handleConfirm}>Use Crop</button>
        </div>
      </div>
    </div>
  )
}

function ShortcutIcon({ icon, size = 28 }) {
  if (icon && (icon.startsWith('/') || icon.startsWith('http'))) {
    return <img src={icon} alt="" style={{ width: size, height: size, objectFit: 'contain', borderRadius: 4, flexShrink: 0 }} />
  }
  return <span style={{ fontSize: size * 0.85, lineHeight: 1, flexShrink: 0 }}>{icon || '🔗'}</span>
}

function QuickLinksTab() {
  const [shortcuts, setShortcuts] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [saving,    setSaving]    = useState(false)
  const [err,       setErr]       = useState(null)
  const [form, setForm]           = useState({ name: '', url: '', icon: '🔗', description: '', roles: [] })
  const [iconFile, setIconFile]   = useState(null)
  const [iconPreview, setIconPreview] = useState(null)
  // crop modal state: { src, fileName, forRowId (null = new form) }
  const [cropTarget, setCropTarget] = useState(null)
  const newIconRef  = useRef()
  const rowIconRefs = useRef({})
  // per-row URL edit state: { [id]: { editing: bool, url: string, saving: bool } }
  const [rowEdits, setRowEdits] = useState({})

  useEffect(() => {
    getShortcuts()
      .then(r => setShortcuts(r.data))
      .catch(() => setErr('Failed to load shortcuts'))
      .finally(() => setLoading(false))
  }, [])

  // Open crop modal whenever a file is selected
  const handleIconPick = (file, forRowId = null) => {
    if (!file) return
    setCropTarget({ src: URL.createObjectURL(file), fileName: file.name, forRowId })
  }

  // Called when user confirms the crop
  const handleCropConfirm = async (croppedFile) => {
    const { forRowId } = cropTarget
    setCropTarget(null)
    if (forRowId === null) {
      // new-form icon
      setIconFile(croppedFile)
      setIconPreview(URL.createObjectURL(croppedFile))
    } else {
      // existing shortcut — upload immediately
      try {
        const r = await uploadShortcutIcon(forRowId, croppedFile)
        setShortcuts(s => s.map(x => x.id === forRowId ? { ...x, icon: r.data.icon } : x))
      } catch {
        setErr('Failed to upload icon')
      }
    }
  }

  const handleAdd = async () => {
    setErr(null)
    if (!form.name.trim() || !form.url.trim()) { setErr('Name and URL are required'); return }
    let url = form.url.trim()
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url
    setSaving(true)
    try {
      const r = await createShortcut({ ...form, url, order_index: shortcuts.length })
      let shortcut = r.data
      if (iconFile) {
        const ir = await uploadShortcutIcon(shortcut.id, iconFile)
        shortcut = { ...shortcut, icon: ir.data.icon }
      }
      setShortcuts(s => [...s, shortcut])
      setForm({ name: '', url: '', icon: '🔗', description: '', roles: [] })
      setIconFile(null)
      setIconPreview(null)
    } catch {
      setErr('Failed to save shortcut')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id) => {
    try {
      await deleteShortcut(id)
      setShortcuts(s => s.filter(x => x.id !== id))
    } catch {
      setErr('Failed to delete shortcut')
    }
  }

  const handleRoleToggle = async (shortcut, roleValue) => {
    const current = shortcut.roles || []
    const updated = current.includes(roleValue)
      ? current.filter(r => r !== roleValue)
      : [...current, roleValue]
    try {
      const r = await updateShortcut(shortcut.id, {
        name: shortcut.name, url: shortcut.url, icon: shortcut.icon,
        description: shortcut.description, order_index: shortcut.order_index,
        roles: updated,
      })
      setShortcuts(s => s.map(x => x.id === shortcut.id ? { ...x, roles: r.data.roles } : x))
    } catch {
      setErr('Failed to update roles')
    }
  }

  const startUrlEdit = (s) =>
    setRowEdits(e => ({ ...e, [s.id]: { editing: true, url: s.url, saving: false } }))

  const cancelUrlEdit = (id) =>
    setRowEdits(e => ({ ...e, [id]: { ...e[id], editing: false } }))

  const saveUrlEdit = async (s) => {
    let url = (rowEdits[s.id]?.url || '').trim()
    if (!url) return
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url
    setRowEdits(e => ({ ...e, [s.id]: { ...e[s.id], saving: true } }))
    try {
      const r = await updateShortcut(s.id, {
        name: s.name, url, icon: s.icon,
        description: s.description, order_index: s.order_index,
        roles: s.roles,
      })
      setShortcuts(prev => prev.map(x => x.id === s.id ? { ...x, url: r.data.url } : x))
      setRowEdits(e => ({ ...e, [s.id]: { editing: false, url: r.data.url, saving: false } }))
    } catch {
      setErr('Failed to update URL')
      setRowEdits(e => ({ ...e, [s.id]: { ...e[s.id], saving: false } }))
    }
  }

  return (
    <div>
      {cropTarget && (
        <IconCropModal
          src={cropTarget.src}
          fileName={cropTarget.fileName}
          onConfirm={handleCropConfirm}
          onCancel={() => setCropTarget(null)}
        />
      )}
      <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 1.6 }}>
        Quick links appear on the Dashboard. Assign roles to restrict a link to specific teams — or leave unchecked to show it to everyone.
      </p>
      {err && <div className="alert alert-error" style={{ marginBottom: 12 }}>{err}</div>}
      <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 20 }}>
        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Add New Link</div>
        <div className="form-row">
          {/* Icon picker */}
          <div className="form-group" style={{ flex: '0 0 auto' }}>
            <label>Icon</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div
                title="Click to upload & crop image icon"
                onClick={() => newIconRef.current?.click()}
                style={{
                  width: 44, height: 44, borderRadius: 'var(--radius-sm)',
                  border: '1px dashed var(--border)', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'var(--bg-surface)', flexShrink: 0, fontSize: '1.3rem',
                }}
              >
                {iconPreview
                  ? <img src={iconPreview} alt="" style={{ width: 32, height: 32, objectFit: 'contain', borderRadius: 2 }} />
                  : <span>{form.icon || '🔗'}</span>}
              </div>
              {!iconPreview && (
                <input className="input" value={form.icon} maxLength={2}
                  style={{ width: 48, textAlign: 'center', fontSize: '1.1rem' }}
                  onChange={e => setForm(f => ({ ...f, icon: e.target.value }))} />
              )}
              {iconPreview && (
                <button className="btn btn-ghost" style={{ fontSize: '0.7rem', padding: '2px 8px' }}
                  onClick={() => { setIconFile(null); setIconPreview(null) }}>
                  ✕ Clear
                </button>
              )}
              <input ref={newIconRef} type="file" accept="image/*" style={{ display: 'none' }}
                onChange={e => { handleIconPick(e.target.files[0], null); e.target.value = '' }} />
            </div>
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
          <input className="input" placeholder="Short description shown on tile" value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
        </div>
        <div className="form-group">
          <label>Visible to <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(leave unchecked for all users)</span></label>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 4 }}>
            {TEAM_ROLES.map(r => (
              <label key={r.value} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.roles.includes(r.value)}
                  onChange={e => setForm(f => ({
                    ...f,
                    roles: e.target.checked ? [...f.roles, r.value] : f.roles.filter(x => x !== r.value)
                  }))} />
                {r.label}
              </label>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn btn-primary" style={{ fontSize: '0.82rem' }} onClick={handleAdd} disabled={saving}>
            {saving ? 'Adding…' : '+ Add Link'}
          </button>
        </div>
      </div>
      {loading ? (
        <div className="flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
          <div className="spinner" /><span className="text-sm">Loading…</span>
        </div>
      ) : shortcuts.length === 0 ? (
        <p className="text-sm text-muted">No quick links yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {shortcuts.map(s => (
            <div key={s.id} style={{
              padding: '10px 14px',
              background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div
                  title="Click to change icon"
                  onClick={() => rowIconRefs.current[s.id]?.click()}
                  style={{ cursor: 'pointer', flexShrink: 0, opacity: 0.9 }}
                >
                  <ShortcutIcon icon={s.icon} size={28} />
                </div>
                <input
                  ref={el => rowIconRefs.current[s.id] = el}
                  type="file" accept="image/*" style={{ display: 'none' }}
                  onChange={e => { handleIconPick(e.target.files[0], s.id); e.target.value = '' }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{s.name}</div>
                  {rowEdits[s.id]?.editing ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                      <input
                        className="input"
                        style={{ fontSize: '0.78rem', padding: '2px 6px', height: 26, flex: 1 }}
                        value={rowEdits[s.id].url}
                        autoFocus
                        onChange={e => setRowEdits(ed => ({ ...ed, [s.id]: { ...ed[s.id], url: e.target.value } }))}
                        onKeyDown={e => { if (e.key === 'Enter') saveUrlEdit(s); if (e.key === 'Escape') cancelUrlEdit(s.id) }}
                      />
                      <button className="btn btn-primary" style={{ fontSize: '0.7rem', padding: '2px 8px', flexShrink: 0 }}
                        disabled={rowEdits[s.id].saving} onClick={() => saveUrlEdit(s)}>
                        {rowEdits[s.id].saving ? '…' : 'Save'}
                      </button>
                      <button className="btn btn-ghost" style={{ fontSize: '0.7rem', padding: '2px 8px', flexShrink: 0 }}
                        onClick={() => cancelUrlEdit(s.id)}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div className="text-xs text-muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{s.url}</div>
                      <button className="btn btn-ghost" style={{ fontSize: '0.7rem', padding: '2px 8px', flexShrink: 0 }}
                        onClick={() => startUrlEdit(s)}>
                        Edit URL
                      </button>
                    </div>
                  )}
                </div>
                <button className="btn btn-danger" style={{ fontSize: '0.75rem', padding: '4px 10px', flexShrink: 0 }} onClick={() => handleDelete(s.id)}>
                  Remove
                </button>
              </div>
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', flexShrink: 0 }}>
                  Visible to:
                </span>
                {TEAM_ROLES.map(r => (
                  <label key={r.value} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.78rem', cursor: 'pointer' }}>
                    <input type="checkbox"
                      checked={(s.roles || []).includes(r.value)}
                      onChange={() => handleRoleToggle(s, r.value)} />
                    {r.label}
                  </label>
                ))}
                {!(s.roles && s.roles.length) && (
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>All users</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Users tab (admin only) ──────────────────────────────────────────────── */

function UserRow({ user, onUpdate, onDelete }) {
  const [editing,  setEditing]  = useState(false)
  const [form,     setForm]     = useState({ first_name: user.first_name || '', last_name: user.last_name || '', rc_extension_id: user.rc_extension_id || '' })
  const [saving,   setSaving]   = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [err,      setErr]      = useState(null)

  const initials = `${(user.first_name||'')[0]||''}${(user.last_name||'')[0]||''}`.toUpperCase() || '?'
  const lastSeen = user.last_seen ? new Date(user.last_seen).toLocaleString() : 'Never'

  const handleSaveName = async () => {
    if (!form.first_name.trim()) { setErr('First name is required'); return }
    setSaving(true); setErr(null)
    try {
      const r = await updateUserProfile(user.id, {
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        rc_extension_id: form.rc_extension_id.trim() || null,
      })
      onUpdate(r.data)
      setEditing(false)
    } catch {
      setErr('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const handleRoleChange = async (newRole) => {
    try {
      const r = await updateUserRole(user.id, newRole)
      onUpdate(r.data)
    } catch (e) {
      setErr(e.response?.data?.detail || 'Failed to update role')
    }
  }

  const handleDelete = async () => {
    if (!window.confirm(`Remove ${user.email} from the portal?`)) return
    setDeleting(true)
    try {
      await deletePortalUser(user.id)
      onDelete(user.id)
    } catch (e) {
      setErr(e.response?.data?.detail || 'Failed to remove user')
      setDeleting(false)
    }
  }

  const handleRCAccessToggle = async () => {
    const next = !user.rc_presence_access
    try {
      const r = await updateUserRCAccess(user.id, next)
      onUpdate({ ...user, rc_presence_access: r.data.rc_presence_access })
    } catch (e) {
      setErr(e.response?.data?.detail || 'Failed to update RC access')
    }
  }

  return (
    <div style={{
      background: 'var(--bg-elevated)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-sm)', padding: '10px 14px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
          background: 'linear-gradient(135deg, var(--cyan), #818cf8)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '0.7rem', fontWeight: 700, color: '#000',
        }}>{initials}</div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {editing ? (
            <div>
              <div className="form-row" style={{ marginBottom: 6 }}>
                <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                  <input className="input" style={{ padding: '4px 8px', fontSize: '0.82rem' }}
                    placeholder="First name" value={form.first_name}
                    onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))} />
                </div>
                <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                  <input className="input" style={{ padding: '4px 8px', fontSize: '0.82rem' }}
                    placeholder="Last name" value={form.last_name}
                    onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))} />
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>📞 RC Ext. ID</span>
                <input className="input" style={{ padding: '4px 8px', fontSize: '0.78rem', flex: 1 }}
                  placeholder="RingCentral extension ID (e.g. 12345678)"
                  value={form.rc_extension_id}
                  onChange={e => setForm(f => ({ ...f, rc_extension_id: e.target.value }))} />
              </div>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{user.name}</div>
              {user.rc_extension_id && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  marginTop: 3, padding: '1px 7px', borderRadius: 10,
                  background: 'rgba(0,208,255,0.1)', border: '1px solid rgba(0,208,255,0.25)',
                  fontSize: '0.68rem', color: 'var(--cyan)',
                }}>
                  📞 RC {user.rc_extension_id}
                </span>
              )}
            </div>
          )}
          <div className="text-xs text-muted" style={{ marginTop: 2 }}>
            {user.email} · {user.invited
              ? <span style={{ color: 'var(--yellow, #f59e0b)', fontStyle: 'italic' }}>Invited — pending first login</span>
              : `Last seen: ${lastSeen}`}
          </div>
          {err && <div style={{ fontSize: '0.72rem', color: 'var(--red)', marginTop: 2 }}>{err}</div>}
        </div>

        {editing ? (
          <div className="flex gap-2" style={{ flexShrink: 0 }}>
            <button className="btn btn-ghost" style={{ fontSize: '0.75rem', padding: '4px 10px' }}
              onClick={() => { setEditing(false); setForm({ first_name: user.first_name || '', last_name: user.last_name || '', rc_extension_id: user.rc_extension_id || '' }); setErr(null) }}>
              Cancel
            </button>
            <button className="btn btn-primary" style={{ fontSize: '0.75rem', padding: '4px 10px' }}
              onClick={handleSaveName} disabled={saving}>
              {saving ? '…' : 'Save'}
            </button>
          </div>
        ) : (
          <div className="flex gap-2" style={{ flexShrink: 0 }}>
            {!user.invited && (
              <button className="btn btn-ghost" style={{ fontSize: '0.75rem', padding: '4px 10px' }}
                onClick={() => setEditing(true)} title="Edit name">
                ✏️
              </button>
            )}
            <select className="select" style={{ width: 'auto', fontSize: '0.78rem', padding: '4px 8px' }}
              value={user.role} onChange={e => handleRoleChange(e.target.value)}>
              {ALL_ROLES.map(r => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
            <button className="btn btn-ghost" style={{ fontSize: '0.75rem', padding: '4px 10px', color: 'var(--red)' }}
              onClick={handleDelete} disabled={deleting} title="Remove user">
              {deleting ? '…' : '✕'}
            </button>
          </div>
        )}
      </div>

      {/* RC Presence access row — only for non-admin, non-invited users */}
      {!user.invited && user.role !== 'admin' && (
        <div style={{
          marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            RC Presence
          </span>
          <button
            onClick={handleRCAccessToggle}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '2px 10px', borderRadius: 20, fontSize: '0.75rem', fontWeight: 500,
              border: '1px solid',
              borderColor: user.rc_presence_access ? 'rgba(0,208,255,0.4)' : 'var(--border)',
              background: user.rc_presence_access ? 'rgba(0,208,255,0.1)' : 'transparent',
              color: user.rc_presence_access ? 'var(--cyan)' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
            title={user.rc_presence_access ? 'Click to revoke RC Presence access' : 'Click to grant RC Presence access'}
          >
            <span style={{
              width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
              background: user.rc_presence_access ? 'var(--cyan)' : 'var(--text-muted)',
            }} />
            {user.rc_presence_access ? 'Access granted' : 'No access'}
          </button>
        </div>
      )}
      {!user.invited && user.role === 'admin' && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
            RC Presence — always accessible (admin)
          </span>
        </div>
      )}
    </div>
  )
}

function UsersTab() {
  const [users,        setUsers]        = useState([])
  const [loading,      setLoading]      = useState(true)
  const [err,          setErr]          = useState(null)
  const [inviteEmail,  setInviteEmail]  = useState('')
  const [inviting,     setInviting]     = useState(false)
  const [inviteErr,    setInviteErr]    = useState(null)

  useEffect(() => {
    getPortalUsers()
      .then(r => setUsers(r.data))
      .catch(() => setErr('Failed to load users'))
      .finally(() => setLoading(false))
  }, [])

  const handleUpdate = (updated) => {
    setUsers(us => us.map(u => u.id === updated.id ? { ...u, ...updated } : u))
  }

  const handleDelete = (id) => {
    setUsers(us => us.filter(u => u.id !== id))
  }

  const handleInvite = async () => {
    const email = inviteEmail.trim()
    if (!email) return
    setInviting(true); setInviteErr(null)
    try {
      const r = await inviteUser(email)
      setUsers(us => [...us, r.data])
      setInviteEmail('')
    } catch (e) {
      setInviteErr(e.response?.data?.detail || 'Failed to invite user')
    } finally {
      setInviting(false)
    }
  }

  return (
    <div>
      <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 1.6 }}>
        Manage portal access. Invite users by email before they sign in to restrict access — or leave open for any company account.
      </p>

      {/* Invite form */}
      <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 20 }}>
        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Invite User</div>
        {inviteErr && <div className="alert alert-error" style={{ marginBottom: 10, fontSize: '0.8rem' }}>{inviteErr}</div>}
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
            <input className="input" placeholder="user@company.com" value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleInvite()} />
          </div>
          <button className="btn btn-primary" style={{ fontSize: '0.82rem' }} onClick={handleInvite} disabled={inviting || !inviteEmail.trim()}>
            {inviting ? 'Inviting…' : '+ Invite'}
          </button>
        </div>
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 8, marginBottom: 0 }}>
          Add <code>REQUIRE_PREREGISTRATION=true</code> to <code>.env</code> to block uninvited users from signing in.
        </p>
      </div>

      {err && <div className="alert alert-error" style={{ marginBottom: 12 }}>{err}</div>}
      {loading ? (
        <div className="flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
          <div className="spinner" /><span className="text-sm">Loading users…</span>
        </div>
      ) : users.length === 0 ? (
        <p className="text-sm text-muted">No users yet. Invite someone above.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {users.map(u => <UserRow key={u.id} user={u} onUpdate={handleUpdate} onDelete={handleDelete} />)}
        </div>
      )}
    </div>
  )
}

/* ── Integrations tab (admin only) ──────────────────────────────────────── */

function IntegrationCard({ integration: intg, onSaved }) {
  const [expanded, setExpanded] = useState(false)
  const [fields,   setFields]   = useState(
    Object.fromEntries(intg.fields.map(f => [f.key, f.value ?? '']))
  )
  const [show,       setShow]       = useState({})   // revealed secret fields
  const [saving,     setSaving]     = useState(false)
  const [testing,    setTesting]    = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [saveMsg,    setSaveMsg]    = useState(null)
  const [err,        setErr]        = useState(null)
  const [uploading,  setUploading]  = useState({})   // { [fieldKey]: bool }
  const [uploadMsg,  setUploadMsg]  = useState({})   // { [fieldKey]: { ok, text } }
  const fileInputRefs = useRef({})

  const handleFileUpload = async (f, file) => {
    setUploading(u => ({ ...u, [f.key]: true }))
    setUploadMsg(m => ({ ...m, [f.key]: null }))
    try {
      await uploadIntegrationFile(f.upload_url, file)
      setUploadMsg(m => ({ ...m, [f.key]: { ok: true, text: `${file.name} uploaded` } }))
      setFields(v => ({ ...v, [f.key]: file.name }))
      onSaved()
    } catch (e) {
      setUploadMsg(m => ({ ...m, [f.key]: { ok: false, text: e.response?.data?.detail || 'Upload failed' } }))
    } finally {
      setUploading(u => ({ ...u, [f.key]: false }))
    }
  }

  const MASK = '••••••••'

  const handleSave = async () => {
    setSaving(true); setErr(null); setSaveMsg(null)
    try {
      await updateIntegration(intg.id, fields)
      setSaveMsg('Saved')
      setTimeout(() => setSaveMsg(null), 3000)
      onSaved()
    } catch (e) { setErr(e.response?.data?.detail || 'Save failed') }
    finally { setSaving(false) }
  }

  const handleTest = async () => {
    setTesting(true); setTestResult(null)
    try {
      const r = await testIntegration(intg.id)
      setTestResult(r.data)
    } catch (e) { setTestResult({ success: false, message: e.response?.data?.detail || 'Request failed' }) }
    finally { setTesting(false) }
  }

  const dirty = intg.fields.some(f => {
    if (f.type === 'file') return false   // file fields save immediately on upload
    const current = fields[f.key] ?? ''
    const original = f.value ?? ''
    return current !== original && !(f.secret && current === MASK)
  })

  return (
    <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
      {/* Header — clickable to expand/collapse */}
      <div
        onClick={() => setExpanded(e => !e)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: expanded ? '1px solid var(--border)' : 'none', cursor: 'pointer', userSelect: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'inline-block', transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>▶</span>
          <span style={{ fontSize: '1.3rem' }}>{intg.icon}</span>
          <div>
            <div style={{ fontSize: '0.95rem', fontWeight: 700 }}>{intg.name}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{intg.description}</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: '0.72rem', fontWeight: 600, padding: '3px 8px', borderRadius: 20,
            background: intg.configured ? 'rgba(63,185,80,0.15)' : 'rgba(248,81,73,0.15)',
            color: intg.configured ? '#3fb950' : '#f85149',
          }}>
            {intg.configured ? '● Connected' : '● Not configured'}
          </span>
          <button className="btn btn-ghost" style={{ fontSize: '0.75rem', padding: '4px 10px' }}
            onClick={e => { e.stopPropagation(); handleTest() }} disabled={testing}>
            {testing ? '⏳ Testing…' : '⚡ Test Connection'}
          </button>
        </div>
      </div>

      {expanded && (
        <>
          {/* Test result */}
          {testResult && (
            <div style={{
              padding: '8px 16px', fontSize: '0.78rem', fontWeight: 500,
              background: testResult.success ? 'rgba(63,185,80,0.08)' : 'rgba(248,81,73,0.08)',
              color: testResult.success ? '#3fb950' : '#f85149',
              borderBottom: '1px solid var(--border)',
            }}>
              {testResult.success ? '✓' : '✗'} {testResult.message}
            </div>
          )}

          {/* Fields */}
          <div style={{ padding: 16 }}>
            {err && <div className="alert alert-error" style={{ marginBottom: 12, fontSize: '0.8rem' }}>{err}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12, marginBottom: 14 }}>
              {intg.fields.map(f => (
                <div className="form-group" key={f.key} style={{ marginBottom: 0 }}>
                  <label style={{ fontSize: '0.75rem' }}>{f.label}</label>

                  {f.type === 'file' ? (
                    <div>
                      {/* Hidden native file input */}
                      <input
                        ref={el => fileInputRefs.current[f.key] = el}
                        type="file"
                        accept={f.accept || '*'}
                        style={{ display: 'none' }}
                        onChange={e => {
                          const file = e.target.files?.[0]
                          if (file) handleFileUpload(f, file)
                          e.target.value = ''   // reset so same file can be re-uploaded
                        }}
                      />
                      {/* Visible upload row */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div className="input" style={{ flex: 1, fontSize: '0.78rem', color: fields[f.key] ? 'var(--text-primary)' : 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'default' }}>
                          {fields[f.key]
                            ? fields[f.key].split('/').pop().split('\\').pop()
                            : 'No file uploaded'}
                        </div>
                        <button
                          className="btn btn-secondary"
                          style={{ fontSize: '0.75rem', padding: '4px 10px', whiteSpace: 'nowrap' }}
                          disabled={uploading[f.key]}
                          onClick={() => fileInputRefs.current[f.key]?.click()}>
                          {uploading[f.key] ? 'Uploading…' : 'Upload'}
                        </button>
                      </div>
                      {uploadMsg[f.key] && (
                        <div style={{ fontSize: '0.73rem', marginTop: 4, color: uploadMsg[f.key].ok ? '#3fb950' : '#f85149' }}>
                          {uploadMsg[f.key].ok ? '✓' : '✗'} {uploadMsg[f.key].text}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ position: 'relative' }}>
                      <input
                        className="input"
                        style={{ fontSize: '0.82rem', paddingRight: f.secret ? 32 : undefined }}
                        type={f.secret && !show[f.key] ? 'password' : 'text'}
                        placeholder={f.placeholder || (f.secret ? 'Enter to update…' : '')}
                        value={fields[f.key] ?? ''}
                        onChange={e => setFields(v => ({ ...v, [f.key]: e.target.value }))}
                        onFocus={() => {
                          if (f.secret && fields[f.key] === MASK)
                            setFields(v => ({ ...v, [f.key]: '' }))
                        }}
                      />
                      {f.secret && (
                        <button
                          tabIndex={-1}
                          style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.8rem', padding: 0 }}
                          onClick={() => setShow(s => ({ ...s, [f.key]: !s[f.key] }))}>
                          {show[f.key] ? '🙈' : '👁'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button className="btn btn-primary" style={{ fontSize: '0.8rem' }}
                onClick={handleSave} disabled={saving || !dirty}>
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
              {saveMsg && <span style={{ fontSize: '0.78rem', color: '#3fb950' }}>✓ {saveMsg}</span>}
              {intg.docs_url && (
                <a href={intg.docs_url} target="_blank" rel="noreferrer"
                  style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--text-muted)', textDecoration: 'none' }}>
                  Docs ↗
                </a>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function IntegrationsTab() {
  const [integrations, setIntegrations] = useState([])
  const [loading,      setLoading]      = useState(true)

  const load = async () => {
    try { const r = await getIntegrations(); setIntegrations(r.data) }
    catch { /* silent */ }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  if (loading) return (
    <div className="flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
      <div className="spinner" /><span className="text-sm">Loading…</span>
    </div>
  )

  return (
    <div>
      <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 1.6 }}>
        Manage credentials for each connected service. Changes take effect immediately — no restart required.
        Secret fields show <code style={{ fontSize: '0.75rem' }}>••••••••</code> when a value is saved; click the field to update it.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {integrations.map(intg => (
          <IntegrationCard key={intg.id} integration={intg} onSaved={load} />
        ))}
      </div>
    </div>
  )
}

/* ── Sites tab (admin only) ──────────────────────────────────────────────── */

function SiteCard({ site, allSwitches, onRefresh }) {
  const [expanded,      setExpanded]      = useState(false)
  const [swForm,        setSwForm]        = useState({ name: '', ip_address: '', stack_position: '1' })
  const [swAdding,      setSwAdding]      = useState(false)
  const [mapName,       setMapName]       = useState('')
  const [mapUploading,  setMapUploading]  = useState(false)
  const [err,           setErr]           = useState(null)
  const [configuringMap,      setConfiguringMap]      = useState(null)
  const [configuringSwitches, setConfiguringSwitches] = useState([])
  const [editorSelectedSeat,  setEditorSelectedSeat]  = useState(null)
  const mapFileRef = useRef(null)

  const handleOpenSeatEditor = async (fm) => {
    const [mapRes, swRes] = await Promise.all([getMap(fm.id), Promise.resolve({ data: site.switches })])
    setConfiguringMap(mapRes.data)
    setConfiguringSwitches(swRes.data)
    setEditorSelectedSeat(null)
  }

  const assignedSwitchIds = new Set(site.switches.map(s => s.id))
  const availableSwitches = allSwitches.filter(s => !assignedSwitchIds.has(s.id))

  const handleCreateSwitch = async () => {
    if (!swForm.name.trim() || !swForm.ip_address.trim()) return
    setSwAdding(true); setErr(null)
    try {
      const swRes = await addSwitch({ ...swForm, stack_position: parseInt(swForm.stack_position) || 1 })
      await addSwitchToSite(site.id, swRes.data.id)
      setSwForm({ name: '', ip_address: '', stack_position: '1' })
      await onRefresh()
    } catch (e) { setErr(e.response?.data?.detail || 'Failed to add switch') }
    finally { setSwAdding(false) }
  }

  const handleAssignSwitch = async (switchId) => {
    if (!switchId) return
    try { await addSwitchToSite(site.id, parseInt(switchId)); await onRefresh() }
    catch { setErr('Failed to assign switch') }
  }

  const handleDisassociateSwitch = async (switchId) => {
    try { await removeSwitchFromSite(site.id, switchId); await onRefresh() }
    catch { setErr('Failed to remove switch') }
  }

  const handleDeleteSwitch = async (sw) => {
    if (!window.confirm(`Delete switch "${sw.name}"? It will be removed from all sites and seat mappings.`)) return
    try { await deleteSwitch(sw.id); await onRefresh() }
    catch { setErr('Failed to delete switch') }
  }

  const handleUploadMap = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    if (!mapName.trim()) { setErr('Enter a map name first'); e.target.value = ''; return }
    setMapUploading(true); setErr(null)
    try {
      const mapRes = await uploadMap(mapName.trim(), file)
      await addMapToSite(site.id, mapRes.data.id)
      setMapName('')
      await onRefresh()
    } catch (e) { setErr(e.response?.data?.detail || 'Upload failed') }
    finally { setMapUploading(false); e.target.value = '' }
  }

  const handleDeleteMap = async (fm) => {
    if (!window.confirm(`Delete map "${fm.name}"? This will remove all seat pins on this map.`)) return
    try { await deleteMap(fm.id); await onRefresh() }
    catch { setErr('Failed to delete map') }
  }

  const sectionLabel = {
    fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)',
    textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8,
  }

  return (
    <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
      {/* Header / toggle row */}
      <div
        onClick={() => setExpanded(e => !e)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', cursor: 'pointer', userSelect: 'none',
          borderBottom: expanded ? '1px solid var(--border)' : 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', transition: 'transform 0.15s', display: 'inline-block', transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
          <span>🏢</span>
          <span style={{ fontSize: '0.9rem', fontWeight: 700 }}>{site.name}</span>
          <span className="badge badge-gray" style={{ fontSize: '0.7rem' }}>{site.switches.length} switch{site.switches.length !== 1 ? 'es' : ''} · {site.maps.length > 0 ? '1 map' : 'no map'}</span>
        </div>
        <button className="btn btn-danger" style={{ fontSize: '0.72rem', padding: '3px 9px' }}
          onClick={async (e) => {
            e.stopPropagation()
            if (!window.confirm('Delete this site? Switches and maps are not deleted, only the site.')) return
            try { await deleteSite(site.id); await onRefresh() } catch { setErr('Failed to delete site') }
          }}>
          Delete
        </button>
      </div>

      {!expanded ? null : <div style={{ padding: 16 }}>
      {err && <div className="alert alert-error" style={{ marginBottom: 10, fontSize: '0.8rem' }}>{err}</div>}

      {/* ── Switches ── */}
      <div style={{ marginBottom: 16 }}>
        <div style={sectionLabel}>Switches</div>

        {/* Assigned switches */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          {site.switches.length === 0 && <span className="text-xs text-muted">None assigned</span>}
          {site.switches.map(sw => (
            <div key={sw.id} className="badge badge-gray" style={{ padding: '4px 10px', fontSize: '0.75rem', gap: 6 }}>
              <span>📡</span>
              <span>{sw.name}</span>
              <span className="font-mono" style={{ color: 'var(--cyan)' }}>{sw.ip_address}</span>
              <span style={{ color: 'var(--text-muted)' }}>#{sw.stack_position}</span>
              <button title="Remove from site" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0, fontSize: '0.7rem' }}
                onClick={() => handleDisassociateSwitch(sw.id)}>✕</button>
              <button title="Delete switch" style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', padding: 0, fontSize: '0.7rem' }}
                onClick={() => handleDeleteSwitch(sw)}>🗑</button>
            </div>
          ))}
        </div>

        {/* Add new switch */}
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 10, marginBottom: 8 }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 6 }}>Add new switch</div>
          <div className="form-row" style={{ alignItems: 'flex-end', gap: 8 }}>
            <div className="form-group" style={{ flex: 2, marginBottom: 0 }}>
              <input className="input" style={{ fontSize: '0.8rem' }} placeholder="Name (e.g. SW1-Core)"
                value={swForm.name} onChange={e => setSwForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="form-group" style={{ flex: 2, marginBottom: 0 }}>
              <input className="input" style={{ fontSize: '0.8rem' }} placeholder="IP Address"
                value={swForm.ip_address} onChange={e => setSwForm(f => ({ ...f, ip_address: e.target.value }))} />
            </div>
            <div className="form-group" style={{ flex: '0 0 64px', marginBottom: 0 }}>
              <input className="input" style={{ fontSize: '0.8rem' }} type="number" placeholder="Stack #" min={1}
                value={swForm.stack_position} onChange={e => setSwForm(f => ({ ...f, stack_position: e.target.value }))} />
            </div>
            <button className="btn btn-primary" style={{ fontSize: '0.78rem', flexShrink: 0 }}
              onClick={handleCreateSwitch} disabled={swAdding || !swForm.name.trim() || !swForm.ip_address.trim()}>
              {swAdding ? '…' : '+ Add'}
            </button>
          </div>
        </div>

        {/* Assign existing switch */}
        {availableSwitches.length > 0 && (
          <select className="select" style={{ width: 'auto', fontSize: '0.8rem' }}
            value="" onChange={e => handleAssignSwitch(e.target.value)}>
            <option value="">Assign existing switch…</option>
            {availableSwitches.map(sw => (
              <option key={sw.id} value={sw.id}>{sw.name} ({sw.ip_address})</option>
            ))}
          </select>
        )}
      </div>

      <div className="divider" />

      {/* ── Floor Map ── */}
      <div style={{ marginTop: 14 }}>
        <div style={sectionLabel}>Floor Map</div>

        {site.maps.length > 0 ? (
          /* Map is assigned — show it with configure/delete actions */
          site.maps.map(fm => (
            <div key={fm.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '8px 12px' }}>
              <span>🗺️</span>
              <span style={{ fontSize: '0.85rem', fontWeight: 500, flex: 1 }}>{fm.name}</span>
              <button className="btn btn-ghost" style={{ fontSize: '0.72rem', padding: '3px 10px' }}
                onClick={() => handleOpenSeatEditor(fm)}>
                📍 Configure Seats
              </button>
              <button title="Delete map" className="btn btn-danger" style={{ fontSize: '0.72rem', padding: '3px 9px' }}
                onClick={() => handleDeleteMap(fm)}>
                Delete Map
              </button>
            </div>
          ))
        ) : (
          /* No map yet — show upload form */
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 10 }}>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 6 }}>Upload a floor map (image or PDF)</div>
            <div className="form-row" style={{ alignItems: 'flex-end', gap: 8 }}>
              <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                <input className="input" style={{ fontSize: '0.8rem' }} placeholder="Map name (e.g. 2nd Floor West)"
                  value={mapName} onChange={e => setMapName(e.target.value)} />
              </div>
              <button className="btn btn-primary" style={{ fontSize: '0.78rem', flexShrink: 0 }}
                disabled={mapUploading} onClick={() => mapFileRef.current?.click()}>
                {mapUploading ? '⏳ Uploading…' : '📤 Upload Map'}
              </button>
              <input ref={mapFileRef} type="file" accept="image/*,application/pdf" style={{ display: 'none' }} onChange={handleUploadMap} />
            </div>
          </div>
        )}
      </div>
      </div>}

      {/* ── Seat Editor Modal ── */}
      {configuringMap && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(3px)', display: 'flex', flexDirection: 'column' }}>
          {/* Modal header */}
          <div style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: '1.1rem' }}>📍</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: '1rem' }}>Configure Seats — {configuringMap.name}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{site.name} · Click map to add pin · Drag pins to reposition</div>
              </div>
            </div>
            <button onClick={() => { setConfiguringMap(null); onRefresh() }} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.2rem', padding: 4 }}>✕</button>
          </div>
          {/* FloorMapManager fills remaining space */}
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <FloorMapManager
              switches={configuringSwitches}
              onSwitchesChange={setConfiguringSwitches}
              currentMap={configuringMap}
              onMapChange={setConfiguringMap}
              onSeatSelect={setEditorSelectedSeat}
              selectedSeat={editorSelectedSeat}
              hideSelector
              fullScreen
            />
          </div>
        </div>
      )}
    </div>
  )
}

function SitesTab() {
  const [sites,       setSites]       = useState([])
  const [allSwitches, setAllSwitches] = useState([])
  const [allMaps,     setAllMaps]     = useState([])
  const [loading,     setLoading]     = useState(true)
  const [err,         setErr]         = useState(null)
  const [newName,     setNewName]     = useState('')
  const [saving,      setSaving]      = useState(false)

  const reload = async () => {
    try {
      const [sitesRes, swRes, mapsRes] = await Promise.all([getSites(), getSwitches(), getMaps()])
      setSites(sitesRes.data)
      setAllSwitches(swRes.data)
      setAllMaps(mapsRes.data)
    } catch { setErr('Failed to load sites') }
    finally { setLoading(false) }
  }

  useEffect(() => { reload() }, [])

  const handleCreate = async () => {
    if (!newName.trim()) return
    setSaving(true); setErr(null)
    try {
      await createSite(newName.trim())
      setNewName('')
      await reload()
    } catch (e) { setErr(e.response?.data?.detail || 'Failed to create site') }
    finally { setSaving(false) }
  }

  if (loading) return <div className="flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}><div className="spinner" /><span className="text-sm">Loading…</span></div>

  return (
    <div>
      <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 1.6 }}>
        Sites group switches and floor maps for Port Security. Select a site in Deployment Tools to scope the view to that site's equipment.
      </p>
      {err && <div className="alert alert-error" style={{ marginBottom: 12 }}>{err}</div>}

      {/* Create site */}
      <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 20 }}>
        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.08em' }}>New Site</div>
        <div className="form-row" style={{ alignItems: 'flex-end' }}>
          <div className="form-group" style={{ flex: 1 }}>
            <label>Site Name</label>
            <input className="input" placeholder="e.g. Headquarters, Branch Office 1" value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()} />
          </div>
          <div className="form-group" style={{ maxWidth: 'max-content' }}>
            <button className="btn btn-primary" style={{ fontSize: '0.82rem' }} onClick={handleCreate} disabled={saving || !newName.trim()}>
              {saving ? 'Creating…' : '+ Create Site'}
            </button>
          </div>
        </div>
      </div>

      {/* Site cards */}
      {sites.length === 0 ? (
        <p className="text-sm text-muted">No sites configured yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {sites.map(site => (
            <SiteCard key={site.id} site={site} allSwitches={allSwitches} onRefresh={reload} />
          ))}
        </div>
      )}
    </div>
  )
}

/* ── General tab ─────────────────────────────────────────────────────────── */

function BrandingUploadRow({ label, hint, url, onUpload, onRemove, uploading, accept }) {
  const ref = useRef()
  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>
        <div
          onClick={() => ref.current?.click()}
          title="Click to upload"
          style={{
            width: 140, height: 72, borderRadius: 'var(--radius-md)',
            border: '2px dashed var(--border)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--bg-elevated)', flexShrink: 0, overflow: 'hidden',
          }}
        >
          {url
            ? <img src={url} alt={label} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', padding: 6 }} />
            : <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center', padding: 8 }}>Click to upload</span>}
        </div>
        <input ref={ref} type="file" accept={accept || 'image/*'} style={{ display: 'none' }}
          onChange={e => { onUpload(e.target.files[0]); e.target.value = '' }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center' }}>
          <button className="btn btn-ghost" style={{ fontSize: '0.8rem' }}
            onClick={() => ref.current?.click()} disabled={uploading}>
            {uploading ? 'Uploading…' : url ? '↑ Replace' : '↑ Upload'}
          </button>
          {url && (
            <button className="btn btn-danger" style={{ fontSize: '0.8rem' }} onClick={onRemove}>Remove</button>
          )}
        </div>
      </div>
      {hint && <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 8 }}>{hint}</p>}
    </div>
  )
}

function GeneralTab({ config, isAdmin }) {
  const [logo,           setLogo]           = useState('')
  const [favicon,        setFavicon]        = useState('')
  const [icon,           setIcon]           = useState('')
  const [logoUploading,  setLogoUploading]  = useState(false)
  const [favUploading,   setFavUploading]   = useState(false)
  const [iconUploading,  setIconUploading]  = useState(false)
  const [msg, setMsg] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    if (!config) return
    if (config.logoUrl    !== undefined) setLogo(config.logoUrl)
    if (config.faviconUrl !== undefined) setFavicon(config.faviconUrl)
    if (config.iconUrl    !== undefined) setIcon(config.iconUrl)
  }, [config])

  const flash = (ok, text) => {
    if (ok) { setMsg(text); setErr(null); setTimeout(() => setMsg(null), 3000) }
    else    { setErr(text); setMsg(null) }
  }

  const handleUploadLogo = async (file) => {
    if (!file) return
    setLogoUploading(true)
    try { const r = await uploadLogo(file); setLogo(r.data.logoUrl); flash(true, 'Logo updated') }
    catch { flash(false, 'Logo upload failed') }
    finally { setLogoUploading(false) }
  }

  const handleRemoveLogo = async () => {
    try { await deleteLogo(); setLogo(''); flash(true, 'Logo removed') }
    catch { flash(false, 'Failed to remove logo') }
  }

  const handleUploadFavicon = async (file) => {
    if (!file) return
    setFavUploading(true)
    try { const r = await uploadFavicon(file); setFavicon(r.data.faviconUrl); flash(true, 'Favicon updated') }
    catch { flash(false, 'Favicon upload failed') }
    finally { setFavUploading(false) }
  }

  const handleRemoveFavicon = async () => {
    try { await deleteFavicon(); setFavicon(''); flash(true, 'Favicon removed') }
    catch { flash(false, 'Failed to remove favicon') }
  }

  const handleUploadIcon = async (file) => {
    if (!file) return
    setIconUploading(true)
    try { const r = await uploadIcon(file); setIcon(r.data.iconUrl); flash(true, 'Header icon updated') }
    catch { flash(false, 'Icon upload failed') }
    finally { setIconUploading(false) }
  }

  const handleRemoveIcon = async () => {
    try { await deleteIcon(); setIcon(''); flash(true, 'Header icon removed') }
    catch { flash(false, 'Failed to remove icon') }
  }

  return (
    <div>
      <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 1.6 }}>
        General portal settings. Authentication and access control are managed in the Azure Portal.
      </p>
      <InfoRow label="Portal Name" value="ControlPoint" />
      <InfoRow label="Company"     value="Claim Assist Solutions" />
      <InfoRow label="Version"     value="1.0.0" />

      {msg && <div className="alert alert-info" style={{ marginTop: 16 }}>✓ {msg}</div>}
      {err && <div className="alert alert-error" style={{ marginTop: 16 }}>{err}</div>}

      {isAdmin && (
        <>
          <BrandingUploadRow
            label="Company Logo"
            hint="Shown on the sign-in page and sidebar. Recommended: PNG or SVG with transparent background."
            url={logo}
            onUpload={handleUploadLogo}
            onRemove={handleRemoveLogo}
            uploading={logoUploading}
          />
          <BrandingUploadRow
            label="Favicon"
            hint="Browser tab icon. Recommended: ICO, PNG, or SVG, 32×32 or 64×64 px."
            url={favicon}
            onUpload={handleUploadFavicon}
            onRemove={handleRemoveFavicon}
            uploading={favUploading}
            accept="image/*,.ico"
          />
          <BrandingUploadRow
            label="Sidebar Icon (Top Left)"
            hint="Small square icon shown in the top-left sidebar. Overrides the company logo in the sidebar. Recommended: PNG or SVG, 32×32 px."
            url={icon}
            onUpload={handleUploadIcon}
            onRemove={handleRemoveIcon}
            uploading={iconUploading}
          />
        </>
      )}
    </div>
  )
}

/* ── Searchable Select ───────────────────────────────────────────────────── */

function SearchableSelect({ options, value, onChange, placeholder, disabled }) {
  const [query, setQuery]   = useState('')
  const [open, setOpen]     = useState(false)
  const wrapRef             = useRef(null)

  const selected = options.find(o => o.value === value)

  // Close on outside click
  useEffect(() => {
    const handler = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = options.filter(o => o.label.toLowerCase().includes(query.toLowerCase()))

  const handleSelect = (opt) => {
    onChange(opt.value)
    setQuery('')
    setOpen(false)
  }

  const handleInputChange = (e) => {
    setQuery(e.target.value)
    setOpen(true)
    if (!e.target.value) onChange(null)
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', flex: '0 0 240px' }}>
      <input
        className="input"
        style={{ fontSize: '0.8rem', width: '100%' }}
        placeholder={disabled ? 'Select a site first' : (placeholder || 'Search…')}
        disabled={disabled}
        value={open ? query : (selected?.label || '')}
        onChange={handleInputChange}
        onFocus={() => { setQuery(''); setOpen(true) }}
      />
      {open && !disabled && filtered.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200,
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)', boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          maxHeight: 220, overflowY: 'auto', marginTop: 2,
        }}>
          {filtered.map(opt => (
            <div
              key={opt.value}
              onMouseDown={() => handleSelect(opt)}
              style={{
                padding: '7px 12px', fontSize: '0.8rem', cursor: 'pointer',
                background: opt.value === value ? 'var(--bg-elevated)' : 'transparent',
                color: opt.value === value ? 'var(--cyan)' : 'var(--text-primary)',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
              onMouseLeave={e => e.currentTarget.style.background = opt.value === value ? 'var(--bg-elevated)' : 'transparent'}
            >
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Conference Rooms Tab ────────────────────────────────────────────────── */


function ConferenceRoomsTab() {
  const [rooms,     setRooms]     = useState([])
  const [sites,     setSites]     = useState([])
  const [edits,     setEdits]     = useState({})   // email → {site_id, seat_mapping_id}
  const [savedCfgs, setSavedCfgs] = useState({})   // email → saved config from DB
  const [seatsCache, setSeatsCache] = useState({}) // mapId → {loading, seats[]}
  const [loading,   setLoading]   = useState(true)
  const [saving,    setSaving]    = useState({})   // email → bool
  const [search,    setSearch]    = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const [roomsRes, sitesRes, cfgsRes] = await Promise.all([
        getConferenceRooms(),
        getSites(),
        getRoomConfigs(),
      ])
      const allRooms = roomsRes.data.rooms || []
      const cfgMap   = {}
      cfgsRes.data.forEach(c => { cfgMap[c.room_email] = c })

      setRooms(allRooms)
      setSites(sitesRes.data)
      setSavedCfgs(cfgMap)

      const initial = {}
      allRooms.forEach(r => {
        const c = cfgMap[r.email]
        initial[r.email] = {
          site_id:         c?.site_id         ?? null,
          seat_mapping_id: c?.seat_mapping_id ?? null,
        }
      })
      setEdits(initial)

      // Pre-load seats for any site that already has a map assigned
      const mapIds = new Set()
      sitesRes.data.forEach(s => { if (s.maps?.length > 0) mapIds.add(s.maps[0].id) })
      mapIds.forEach(id => loadSeatsForMap(id))
    } catch(e) {}
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const patch = (email, changes) =>
    setEdits(prev => ({ ...prev, [email]: { ...prev[email], ...changes } }))

  const loadSeatsForMap = async (mapId) => {
    if (!mapId) return
    setSeatsCache(prev => {
      if (prev[mapId]) return prev
      return { ...prev, [mapId]: { loading: true, seats: [] } }
    })
    try {
      const r = await getMap(mapId)
      setSeatsCache(prev => ({ ...prev, [mapId]: { loading: false, seats: r.data.seats || [] } }))
    } catch(e) {
      setSeatsCache(prev => ({ ...prev, [mapId]: { loading: false, seats: [] } }))
    }
  }

  const handleSiteChange = (email, val) => {
    const siteId = val ? parseInt(val) : null
    const site   = sites.find(s => s.id === siteId)
    patch(email, { site_id: siteId, seat_mapping_id: null })
    if (site?.maps?.length > 0) loadSeatsForMap(site.maps[0].id)
  }

  const handleSave = async (email) => {
    setSaving(prev => ({ ...prev, [email]: true }))
    try {
      const { site_id, seat_mapping_id } = edits[email] || {}
      await upsertRoomConfig(email, { site_id, seat_mapping_id })
      const r = await getRoomConfigs()
      const m = {}
      r.data.forEach(c => { m[c.room_email] = c })
      setSavedCfgs(m)
    } catch(e) {}
    setSaving(prev => ({ ...prev, [email]: false }))
  }

  const handleClear = async (email) => {
    setSaving(prev => ({ ...prev, [email]: true }))
    try {
      await deleteRoomConfig(email)
      patch(email, { site_id: null, seat_mapping_id: null })
      const r = await getRoomConfigs()
      const m = {}
      r.data.forEach(c => { m[c.room_email] = c })
      setSavedCfgs(m)
    } catch(e) {}
    setSaving(prev => ({ ...prev, [email]: false }))
  }

  if (loading) return (
    <div className="flex items-center gap-3" style={{ color: 'var(--text-secondary)' }}>
      <div className="spinner" /><span className="text-sm">Loading rooms…</span>
    </div>
  )

  if (rooms.length === 0) return (
    <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
      No conference rooms found. Ensure the Microsoft Graph integration is configured.
    </div>
  )

  const byBuilding = rooms.reduce((acc, r) => {
    const key = r.building || 'Other'
    if (!acc[key]) acc[key] = []
    acc[key].push(r)
    return acc
  }, {})

  const searchLower = search.toLowerCase()
  const filteredByBuilding = Object.fromEntries(
    Object.entries(byBuilding)
      .map(([building, bRooms]) => [
        building,
        bRooms.filter(r =>
          r.name.toLowerCase().includes(searchLower) ||
          r.building?.toLowerCase().includes(searchLower) ||
          r.email?.toLowerCase().includes(searchLower)
        )
      ])
      .filter(([, bRooms]) => bRooms.length > 0)
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: '0 0 4px', fontSize: '1rem' }}>Conference Room Locations</h3>
          <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            Assign each room to a site and link it to a seat/port from that site's floor map.
          </p>
        </div>
        <input
          className="input"
          style={{ flex: '0 0 240px', fontSize: '0.85rem' }}
          placeholder="Search rooms…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {Object.keys(filteredByBuilding).length === 0 && (
        <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No rooms match "{search}"</div>
      )}

      {Object.entries(filteredByBuilding).map(([building, bRooms]) => (
        <div key={building}>
          {Object.keys(filteredByBuilding).length > 1 && (
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
              {building}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {bRooms.map(room => {
              const edit     = edits[room.email] || {}
              const savedCfg = savedCfgs[room.email]
              const site     = sites.find(s => s.id === edit.site_id)
              const mapId    = site?.maps?.[0]?.id ?? null
              const mapData  = seatsCache[mapId]
              const seats    = mapData?.seats || []
              const isSaving = !!saving[room.email]

              return (
                <div key={room.email} className="card" style={{ padding: '10px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    {/* Room info */}
                    <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.88rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{room.name}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 1 }}>
                        {[room.building, room.floor ? `Floor ${room.floor}` : null, room.capacity ? `${room.capacity} ppl` : null].filter(Boolean).join(' · ')}
                        {savedCfg?.seat && (
                          <span style={{ color: 'var(--cyan)', marginLeft: 6 }}>
                            · {savedCfg.seat.label} → {savedCfg.seat.switch_name} {savedCfg.seat.port}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Site selector */}
                    <select
                      className="select"
                      style={{ fontSize: '0.8rem', flex: '0 0 160px' }}
                      value={edit.site_id || ''}
                      onChange={e => handleSiteChange(room.email, e.target.value)}
                    >
                      <option value="">— No site —</option>
                      {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>

                    {/* Seat selector */}
                    {site && (
                      mapData?.loading ? (
                        <div className="flex items-center gap-2" style={{ color: 'var(--text-muted)', fontSize: '0.8rem', flex: '0 0 240px' }}>
                          <div className="spinner" /> Loading seats…
                        </div>
                      ) : (
                        <SearchableSelect
                          options={seats.map(s => ({ value: s.id, label: s.seat_label }))}
                          value={edit.seat_mapping_id || null}
                          onChange={val => patch(room.email, { seat_mapping_id: val ? parseInt(val) : null })}
                          placeholder={seats.length === 0 ? 'No seats on map' : 'Search seats…'}
                          disabled={seats.length === 0}
                        />
                      )
                    )}

                    {/* Clear + Save */}
                    <div style={{ display: 'flex', gap: 6, flex: '0 0 auto', marginLeft: 'auto' }}>
                      {savedCfg && (
                        <button className="btn btn-ghost" style={{ fontSize: '0.75rem', padding: '4px 8px' }} onClick={() => handleClear(room.email)} disabled={isSaving}>
                          Clear
                        </button>
                      )}
                      <button className="btn btn-primary" style={{ fontSize: '0.75rem', padding: '4px 10px' }} onClick={() => handleSave(room.email)} disabled={isSaving || !edit.site_id}>
                        {isSaving ? '…' : 'Save'}
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

/* ── Main Settings page ──────────────────────────────────────────────────── */

export default function Settings() {
  const { isAdmin, role } = useContext(UserContext)
  const canAccessSites = isAdmin || role === 'net_inf_team'
  const TABS = isAdmin
    ? ['General', 'Authentication', 'Quick Links', 'Users', 'Sites', 'Conference Rooms', 'Integrations']
    : canAccessSites
      ? ['General', 'Authentication', 'Sites']
      : ['General', 'Authentication']

  const [tab, setTab]       = useState('General')
  const [config, setConfig] = useState(null)

  useEffect(() => {
    api.get('/api/settings/config').then(r => setConfig(r.data)).catch(() => {})
  }, [])

  // Reset to General if current tab is no longer available
  useEffect(() => {
    if (!TABS.includes(tab)) setTab('General')
  }, [isAdmin])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            padding: '12px 16px', fontSize: '0.85rem', fontWeight: 500,
            fontFamily: 'var(--font-sans)',
            color: tab === t ? 'var(--cyan)' : 'var(--text-secondary)',
            borderBottom: `2px solid ${tab === t ? 'var(--cyan)' : 'transparent'}`,
            marginBottom: -1, transition: 'all 0.15s',
          }}>{t}</button>
        ))}
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          {tab === 'General' && (
            <GeneralTab config={config} isAdmin={isAdmin} />
          )}
          {tab === 'Authentication' && (
            <div>
              <div className="alert alert-info" style={{ marginBottom: 20, fontSize: '0.82rem' }}>
                ℹ️ Access is managed entirely in <strong>Microsoft Entra ID</strong>. Assign users or groups in the Azure Portal to grant or revoke access.
              </div>
              {config ? (
                <>
                  <InfoRow label="Tenant ID"    value={config.tenantId}            mono />
                  <InfoRow label="Client ID"    value={config.clientId}            mono />
                  <InfoRow label="Redirect URI" value={window.location.origin}     mono />
                  <div style={{ marginTop: 24 }}>
                    <a href="https://portal.azure.com/#view/Microsoft_AAD_IAM/StartboardApplicationsMenuBlade/~/AppAppsPreview"
                      target="_blank" rel="noreferrer" className="btn btn-ghost"
                      style={{ display: 'inline-flex', fontSize: '0.82rem', gap: 6 }}>
                      🔗 Open Azure Enterprise Applications
                    </a>
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-3" style={{ color: 'var(--text-secondary)' }}>
                  <div className="spinner" /><span className="text-sm">Loading config…</span>
                </div>
              )}
            </div>
          )}
          {tab === 'Quick Links' && isAdmin && <QuickLinksTab />}
          {tab === 'Users'       && isAdmin && <UsersTab />}
          {tab === 'Sites'             && canAccessSites && <SitesTab />}
          {tab === 'Conference Rooms'  && isAdmin && <ConferenceRoomsTab />}
          {tab === 'Integrations'      && isAdmin && <IntegrationsTab />}
        </div>
    </div>
  )
}
