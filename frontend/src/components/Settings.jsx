import { useState, useEffect, useContext, useRef, useCallback } from 'react'
import NotificationSettings from './NotificationSettings.jsx'
import FloorMapManager from './PortSecurity/FloorMapManager.jsx'
import TicketSettings from './Ticketing/TicketSettings.jsx'
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
import { getShortcuts, createShortcut, updateShortcut, deleteShortcut, uploadShortcutIcon, uploadLogo, deleteLogo, uploadFavicon, deleteFavicon, uploadIcon, deleteIcon, getPortalUsers, updateUserRole, updateUserProfile, updateUserRCAccess, adminSetUserPassword, inviteUser, deletePortalUser,
  getSites, createSite, deleteSite, setSiteCustomer, getSwitches, getMaps, getMap, addSwitch, deleteSwitch, uploadMap, deleteMap,
  addSwitchToSite, removeSwitchFromSite, addMapToSite, removeMapFromSite, linkUnifiHost, setSiteUnifiSiteName, getUnifiHosts, getHostControllerSites, syncUnifiDevices,
  getIntegrations, updateIntegration, testIntegration, toggleIntegration, uploadIntegrationFile, uploadIntegrationLogo,
  getClientIntegrations, createClientIntegration, updateClientIntegration, deleteClientIntegration, toggleClientIntegration, testClientIntegration,
  syncDirectory, syncAllDevices, getDirectoryUsers, getDeviceInventory,
  getConferenceRooms, getRoomConfigs, upsertRoomConfig, deleteRoomConfig,
  getRoles, createRole, updateRole, deleteRole, getAssetCustomers } from '../api/client.js'
import { UserContext } from '../App.jsx'
import ClientsWorkspace from './Clients/ClientsWorkspace.jsx'

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
  { value: 'network_viewer',    label: 'Network Viewer' },
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

function UserRow({ user, onUpdate, onDelete, roles }) {
  const [editing,      setEditing]      = useState(false)
  const [form,         setForm]         = useState({ first_name: user.first_name || '', last_name: user.last_name || '', rc_extension_id: user.rc_extension_id || '' })
  const [saving,       setSaving]       = useState(false)
  const [deleting,     setDeleting]     = useState(false)
  const [err,          setErr]          = useState(null)
  const [showPwForm,   setShowPwForm]   = useState(false)
  const [newPassword,  setNewPassword]  = useState('')
  const [pwSaving,     setPwSaving]     = useState(false)
  const [pwMsg,        setPwMsg]        = useState(null)

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

  const handleSetPassword = async () => {
    if (newPassword.length < 8) { setPwMsg({ ok: false, text: 'Password must be at least 8 characters' }); return }
    setPwSaving(true); setPwMsg(null)
    try {
      await adminSetUserPassword(user.id, newPassword)
      setPwMsg({ ok: true, text: 'Password set successfully' })
      setNewPassword('')
      setTimeout(() => { setShowPwForm(false); setPwMsg(null) }, 1500)
    } catch (e) {
      setPwMsg({ ok: false, text: e.response?.data?.detail || 'Failed to set password' })
    } finally {
      setPwSaving(false)
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
            {!user.invited && (
              <button className="btn btn-ghost" style={{ fontSize: '0.75rem', padding: '4px 10px' }}
                onClick={() => { setShowPwForm(f => !f); setPwMsg(null); setNewPassword('') }}
                title="Set password">
                🔑
              </button>
            )}
            <select className="select" style={{ width: 'auto', fontSize: '0.78rem', padding: '4px 8px' }}
              value={user.role} onChange={e => handleRoleChange(e.target.value)}>
              {(roles && roles.length > 0 ? roles : ALL_ROLES.map(r => ({ name: r.value, label: r.label }))).map(r => (
                <option key={r.name} value={r.name}>{r.label}</option>
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

      {showPwForm && !user.invited && (
        <div style={{ marginTop: 8, paddingTop: 10, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', flexShrink: 0 }}>
            Set password
          </span>
          <input
            className="input"
            type="password"
            placeholder="New password (min 8 chars)"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSetPassword()}
            style={{ flex: 1, fontSize: '0.82rem', padding: '4px 8px' }}
          />
          <button className="btn btn-primary" style={{ fontSize: '0.75rem', padding: '4px 10px', flexShrink: 0 }}
            onClick={handleSetPassword} disabled={pwSaving || newPassword.length < 1}>
            {pwSaving ? '…' : 'Save'}
          </button>
          <button className="btn btn-ghost" style={{ fontSize: '0.75rem', padding: '4px 8px', flexShrink: 0 }}
            onClick={() => { setShowPwForm(false); setPwMsg(null); setNewPassword('') }}>
            Cancel
          </button>
          {pwMsg && (
            <span style={{ fontSize: '0.75rem', color: pwMsg.ok ? '#22c55e' : '#ef4444', flexShrink: 0 }}>
              {pwMsg.text}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function UsersTab() {
  const [users,        setUsers]        = useState([])
  const [roles,        setRoles]        = useState([])
  const [loading,      setLoading]      = useState(true)
  const [err,          setErr]          = useState(null)
  const [inviteEmail,  setInviteEmail]  = useState('')
  const [inviting,     setInviting]     = useState(false)
  const [inviteErr,    setInviteErr]    = useState(null)

  useEffect(() => {
    Promise.all([getPortalUsers(), getRoles()])
      .then(([usersRes, rolesRes]) => {
        setUsers(usersRes.data)
        setRoles(rolesRes.data)
      })
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
        Manage agent access. Invite agents by email to grant them access to the portal.
      </p>

      {/* Invite form */}
      <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 20 }}>
        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Invite Agent</div>
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
      </div>

      {err && <div className="alert alert-error" style={{ marginBottom: 12 }}>{err}</div>}
      {loading ? (
        <div className="flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
          <div className="spinner" /><span className="text-sm">Loading agents…</span>
        </div>
      ) : users.length === 0 ? (
        <p className="text-sm text-muted">No agents yet. Invite someone above.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {users.map(u => <UserRow key={u.id} user={u} onUpdate={handleUpdate} onDelete={handleDelete} roles={roles} />)}
        </div>
      )}
    </div>
  )
}

/* ── Integrations tab (admin only) ──────────────────────────────────────── */

const INTEGRATION_CATEGORIES = [
  'Asset',
  'Badges & Access Control Systems',
  'Calendars',
  'Directory Sync',
  'Employee Experience',
  'Facility Ticketing',
  'Real Estate',
  'Security',
  'Single Sign-On (SSO)',
  'Video Conferencing',
  'Networking',
]

function IntegrationCard({ integration: intg, onConfigure, iconSize = 48 }) {
  const [testing,    setTesting]    = useState(false)
  const [testResult, setTestResult] = useState(null)

  const handleTest = async () => {
    setTesting(true); setTestResult(null)
    try {
      const r = await testIntegration(intg.id)
      setTestResult(r.data)
    } catch (e) { setTestResult({ success: false, message: e.response?.data?.detail || 'Request failed' }) }
    finally { setTesting(false) }
  }

  return (
    <div style={{
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      transition: 'border-color 0.15s',
    }}
      onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(33,212,253,0.35)'}
      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
    >
      <div style={{ padding: '20px 20px 16px', display: 'flex', flexDirection: 'column', flex: 1 }}>
        {/* Logo + name row */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 12 }}>
          <div style={{
            width: iconSize, height: iconSize, borderRadius: Math.round(iconSize * 0.21), flexShrink: 0,
            background: 'var(--bg-surface)', border: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: `${(iconSize / 48) * 1.6}rem`, overflow: 'hidden',
            transition: 'width 0.15s, height 0.15s',
          }}>
            {intg.logo_url
              ? <img src={intg.logo_url} alt={intg.name} style={{ width: Math.round(iconSize * 0.67), height: Math.round(iconSize * 0.67), objectFit: 'contain', borderRadius: 4 }} />
              : intg.icon}
          </div>

          <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
            <div style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: 5 }}>{intg.name}</div>
            <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
              {(intg.categories ?? [intg.category || 'Uncategorized']).map(cat => (
                <span key={cat} style={{
                  display: 'inline-block', fontSize: '0.65rem', fontWeight: 600,
                  padding: '2px 7px', borderRadius: 20,
                  background: 'var(--cyan-dim)', color: 'var(--cyan)',
                  border: '1px solid rgba(33,212,253,0.2)', whiteSpace: 'nowrap',
                }}>{cat}</span>
              ))}
            </div>
          </div>

          <div style={{ paddingTop: 2, flexShrink: 0 }}>
            <span style={{
              fontSize: '0.7rem', fontWeight: 600, padding: '3px 9px', borderRadius: 20,
              background: !intg.configured ? 'var(--bg-surface)' : intg.enabled === false ? 'rgba(239,68,68,0.1)' : 'rgba(63,185,80,0.12)',
              color: !intg.configured ? 'var(--text-muted)' : intg.enabled === false ? 'var(--red)' : 'var(--green)',
              border: `1px solid ${!intg.configured ? 'var(--border)' : intg.enabled === false ? 'rgba(239,68,68,0.25)' : 'rgba(63,185,80,0.25)'}`,
            }}>
              {!intg.configured ? '○ Not set up' : intg.enabled === false ? '○ Disconnected' : '● Connected'}
            </span>
          </div>
        </div>

        {/* Description */}
        <p style={{
          fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.55,
          marginBottom: 12, flex: 1,
          display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
          {intg.description}
        </p>

        {/* Inline test result */}
        {testResult && (
          <div style={{
            fontSize: '0.73rem', fontWeight: 500, marginBottom: 10,
            padding: '5px 10px', borderRadius: 6,
            background: testResult.success ? 'rgba(63,185,80,0.08)' : 'rgba(248,81,73,0.08)',
            color: testResult.success ? 'var(--green)' : 'var(--red)',
            border: `1px solid ${testResult.success ? 'rgba(63,185,80,0.2)' : 'rgba(248,81,73,0.2)'}`,
          }}>
            {testResult.success ? '✓' : '✗'} {testResult.message}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn-primary"
            style={{ fontSize: '0.78rem', padding: '6px 14px', flex: 1 }}
            onClick={() => onConfigure(intg)}>
            ⚙ Configure
          </button>
          <button
            className="btn btn-ghost"
            style={{ fontSize: '0.78rem', padding: '6px 12px' }}
            onClick={handleTest}
            disabled={testing}>
            {testing ? '⏳' : '⚡'} Test
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── UniFi host config row (per-host local controller form) ─────────────── */

/* ── Integration setup page ──────────────────────────────────────────────── */

const _dirLastSynced  = () => getDirectoryUsers({ limit: 1 }).then(r => r.data.users?.[0]?.last_updated || null).catch(() => null)
const _devLastSynced  = () => getDeviceInventory({ limit: 1 }).then(r => r.data.devices?.[0]?.last_updated || null).catch(() => null)

const SYNC_MAP = {
  microsoft365: { label: 'Sync Directory', fn: syncDirectory,  fetchLastSynced: _dirLastSynced, detail: (d) => `${d.synced} users — M365 ${d.m365_count}${d.workday_count > 0 ? ` · Workday ${d.workday_count}` : ''}${d.okta_count > 0 ? ` · Okta ${d.okta_count}` : ''}` },
  okta:         { label: 'Sync Directory', fn: syncDirectory,  fetchLastSynced: _dirLastSynced, detail: (d) => `${d.synced} users — M365 ${d.m365_count}${d.workday_count > 0 ? ` · Workday ${d.workday_count}` : ''}${d.okta_count > 0 ? ` · Okta ${d.okta_count}` : ''}` },
  workday:      { label: 'Sync Directory', fn: syncDirectory,  fetchLastSynced: _dirLastSynced, detail: (d) => `${d.synced} users — M365 ${d.m365_count}${d.workday_count > 0 ? ` · Workday ${d.workday_count}` : ''}${d.okta_count > 0 ? ` · Okta ${d.okta_count}` : ''}` },
  immybot:      { label: 'Sync Devices',   fn: syncAllDevices, fetchLastSynced: _devLastSynced, detail: (d) => `${d.synced} devices — ImmyBot ${d.immy_count} · Intune ${d.intune_count} · Aurora ${d.aurora_count}` },
  intune:       { label: 'Sync Devices',   fn: syncAllDevices, fetchLastSynced: _devLastSynced, detail: (d) => `${d.synced} devices — ImmyBot ${d.immy_count} · Intune ${d.intune_count} · Aurora ${d.aurora_count}` },
  arcticwolf:   { label: 'Sync Devices',   fn: syncAllDevices, fetchLastSynced: _devLastSynced, detail: (d) => `${d.synced} devices — ImmyBot ${d.immy_count} · Intune ${d.intune_count} · Aurora ${d.aurora_count}` },
}

function IntegrationSetupPage({ integration: intg, onExit, onSaved }) {
  const [fields,        setFields]        = useState(
    Object.fromEntries(intg.fields.map(f => [f.key, f.value ?? '']))
  )
  const [baseFields,    setBaseFields]    = useState(
    Object.fromEntries(intg.fields.map(f => [f.key, f.value ?? '']))
  )
  const [show,          setShow]          = useState({})
  const [saving,        setSaving]        = useState(false)
  const [saveMsg,       setSaveMsg]       = useState(null)
  const [err,           setErr]           = useState(null)
  const [testing,       setTesting]       = useState(false)
  const [testResult,    setTestResult]    = useState(null)
  const [uploading,     setUploading]     = useState({})
  const [uploadMsg,     setUploadMsg]     = useState({})
  const [logoUploading, setLogoUploading] = useState(false)
  const [logoMsg,       setLogoMsg]       = useState(null)
  const [logoUrl,       setLogoUrl]       = useState(intg.logo_url ?? null)
  const [syncing,       setSyncing]       = useState(false)
  const [syncResult,    setSyncResult]    = useState(null)
  const [lastSynced,    setLastSynced]    = useState(null)
  const [selectedCustomerId, setSelectedCustomerId] = useState(null)
  const [customers,          setCustomers]          = useState([])
  const [existingCI,         setExistingCI]         = useState(null)
  const fileInputRefs = useRef({})
  const logoInputRef  = useRef(null)

  useEffect(() => {
    getAssetCustomers().then(r => setCustomers(r.data || []))
  }, [])

  useEffect(() => {
    if (selectedCustomerId === null) {
      const globalFields = Object.fromEntries(intg.fields.map(f => [f.key, f.value ?? '']))
      setFields(globalFields)
      setBaseFields(globalFields)
      setExistingCI(null)
      return
    }
    getClientIntegrations(selectedCustomerId).then(r => {
      const ci = (r.data || []).find(c => c.integration_type === intg.id)
      if (ci) {
        setExistingCI(ci)
        const vals = JSON.parse(ci.values_json || '{}')
        const populated = Object.fromEntries(intg.fields.map(f => [f.key, vals[f.key] ?? '']))
        setFields(populated)
        setBaseFields(populated)
      } else {
        setExistingCI(null)
        const empty = Object.fromEntries(intg.fields.map(f => [f.key, '']))
        setFields(empty)
        setBaseFields(empty)
      }
    })
  }, [selectedCustomerId]) // eslint-disable-line react-hooks/exhaustive-deps

  const syncDef = SYNC_MAP[intg.id]

  useEffect(() => {
    if (syncDef?.fetchLastSynced) {
      syncDef.fetchLastSynced().then(ts => setLastSynced(ts))
    }
  }, [intg.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSync = async () => {
    if (!syncDef) return
    setSyncing(true); setSyncResult(null)
    try {
      const { data } = await syncDef.fn()
      setSyncResult({ success: true, message: syncDef.detail(data) })
      setLastSynced(new Date().toISOString())
    } catch (e) {
      setSyncResult({ success: false, message: e.response?.data?.detail || 'Sync failed' })
    } finally {
      setSyncing(false)
    }
  }

  function fmtRelative(iso) {
    if (!iso) return null
    const d = Date.now() - new Date(iso).getTime()
    const m = Math.floor(d / 60000), h = Math.floor(d / 3600000), dy = Math.floor(d / 86400000)
    return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : h < 24 ? `${h}h ago` : `${dy}d ago`
  }

  const MASK = '••••••••'

  const dirty = intg.fields.some(f => {
    if (f.type === 'file') return false
    const current = fields[f.key] ?? ''
    const base = baseFields[f.key] ?? ''
    return current !== base && !(f.secret && current === MASK)
  })

  const handleSave = async () => {
    setSaving(true); setErr(null); setSaveMsg(null)
    try {
      if (selectedCustomerId === null) {
        await updateIntegration(intg.id, fields)
        onSaved()
      } else if (existingCI) {
        const r = await updateClientIntegration(existingCI.id, { values: fields })
        setExistingCI(r.data)
        const vals = JSON.parse(r.data.values_json || '{}')
        const updated = Object.fromEntries(intg.fields.map(f => [f.key, vals[f.key] ?? '']))
        setBaseFields(updated)
      } else {
        const r = await createClientIntegration({ customer_id: selectedCustomerId, integration_type: intg.id, values: fields })
        setExistingCI(r.data)
        const vals = JSON.parse(r.data.values_json || '{}')
        const updated = Object.fromEntries(intg.fields.map(f => [f.key, vals[f.key] ?? '']))
        setBaseFields(updated)
      }
      setSaveMsg('Saved')
      setTimeout(() => setSaveMsg(null), 3000)
    } catch (e) { setErr(e.response?.data?.detail || 'Save failed') }
    finally { setSaving(false) }
  }

  const handleTest = async () => {
    setTesting(true); setTestResult(null)
    try {
      let r
      if (selectedCustomerId !== null && existingCI) {
        r = await testClientIntegration(existingCI.id)
      } else {
        r = await testIntegration(intg.id)
      }
      setTestResult(r.data)
    } catch (e) { setTestResult({ success: false, message: e.response?.data?.detail || 'Request failed' }) }
    finally { setTesting(false) }
  }

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

  const handleLogoUpload = async (file) => {
    setLogoUploading(true); setLogoMsg(null)
    try {
      const r = await uploadIntegrationLogo(intg.id, file)
      setLogoUrl(r.data.logo_url)
      setLogoMsg({ ok: true, text: 'Logo updated' })
      onSaved()
    } catch (e) {
      setLogoMsg({ ok: false, text: e.response?.data?.detail || 'Upload failed' })
    } finally {
      setLogoUploading(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

      {/* ── Page header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16,
        marginBottom: 28,
      }}>
        {/* Logo */}
        <div style={{
          width: 64, height: 64, borderRadius: 14, flexShrink: 0,
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '2rem', overflow: 'hidden',
        }}>
          {logoUrl
            ? <img src={logoUrl} alt={intg.name} style={{ width: 44, height: 44, objectFit: 'contain' }} />
            : intg.icon}
        </div>

        {/* Name + categories + description */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: 6 }}>{intg.name}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
            {(intg.categories ?? [intg.category || 'Uncategorized']).map(cat => (
              <span key={cat} style={{
                fontSize: '0.65rem', fontWeight: 600,
                padding: '2px 8px', borderRadius: 20,
                background: 'var(--cyan-dim)', color: 'var(--cyan)',
                border: '1px solid rgba(33,212,253,0.2)', whiteSpace: 'nowrap',
              }}>{cat}</span>
            ))}
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{intg.description}</div>
        </div>

        {/* Status */}
        <span style={{
          flexShrink: 0,
          fontSize: '0.75rem', fontWeight: 600, padding: '4px 12px', borderRadius: 20,
          background: !intg.configured ? 'var(--bg-elevated)' : intg.enabled === false ? 'rgba(239,68,68,0.1)' : 'rgba(63,185,80,0.12)',
          color: !intg.configured ? 'var(--text-muted)' : intg.enabled === false ? 'var(--red)' : 'var(--green)',
          border: `1px solid ${!intg.configured ? 'var(--border)' : intg.enabled === false ? 'rgba(239,68,68,0.25)' : 'rgba(63,185,80,0.25)'}`,
        }}>
          {!intg.configured ? '○ Not set up' : intg.enabled === false ? '○ Disconnected' : '● Connected'}
        </span>

        {/* Disconnect / Reconnect toggle */}
        {intg.configured && (
          <button
            className="btn btn-ghost"
            style={{ flexShrink: 0, fontSize: '0.82rem', padding: '6px 14px', color: intg.enabled === false ? 'var(--green)' : 'var(--red)' }}
            onClick={async () => {
              await toggleIntegration(intg.id, intg.enabled !== false)
              onSaved()
            }}>
            {intg.enabled === false ? 'Reconnect' : 'Disconnect'}
          </button>
        )}

        {/* Sync button + last synced — only for integrations that support it */}
        {syncDef && (
          <div className="flex items-center gap-2">
            {lastSynced && !syncing && (
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                Synced {fmtRelative(lastSynced)}
              </span>
            )}
            <button
              className="btn btn-primary"
              style={{ flexShrink: 0, fontSize: '0.82rem', padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 6 }}
              onClick={handleSync}
              disabled={syncing}>
              {syncing
                ? <><div className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} /> Syncing…</>
                : `↻ ${syncDef.label}`}
            </button>
          </div>
        )}

        {/* Exit — far right */}
        <button
          className="btn btn-ghost"
          style={{ flexShrink: 0, fontSize: '0.82rem', padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 6 }}
          onClick={onExit}>
          ← All Integrations
        </button>
      </div>

      {/* ── Client selector bar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 16px', marginBottom: 16,
        background: 'var(--bg-elevated)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
      }}>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 500, flexShrink: 0 }}>
          Configuring for:
        </span>
        <select
          className="input"
          style={{ fontSize: '0.82rem', padding: '4px 8px', maxWidth: 300, flex: 1 }}
          value={selectedCustomerId ?? ''}
          onChange={e => {
            setSelectedCustomerId(e.target.value ? Number(e.target.value) : null)
            setTestResult(null); setErr(null); setSaveMsg(null)
          }}>
          <option value="">My Organization (Global)</option>
          {customers.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        {selectedCustomerId !== null && (
          <span style={{ fontSize: '0.72rem', fontWeight: 600, padding: '2px 8px', borderRadius: 8,
            background: existingCI ? 'rgba(63,185,80,0.1)' : 'rgba(251,191,36,0.1)',
            color: existingCI ? 'var(--green)' : '#f59e0b',
          }}>
            {existingCI ? '● Configured' : '○ Not configured'}
          </span>
        )}
      </div>

      {/* Sync result banner */}
      {syncResult && !syncing && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          padding: '8px 16px', fontSize: '0.78rem',
          background: syncResult.success ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
          border: `1px solid ${syncResult.success ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
          borderRadius: 'var(--radius-sm)', marginTop: 12,
        }}>
          <span style={{ fontWeight: 600, color: syncResult.success ? 'var(--green)' : 'var(--red)' }}>
            {syncResult.success ? '✓' : '⚠'} {syncResult.message}
          </span>
          <button onClick={() => setSyncResult(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.8rem' }}>✕</button>
        </div>
      )}

      {/* ── Two-column body ── */}
      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>

      {/* Setup guide */}
      {intg.setup_guide?.length > 0 && (
        <div style={{
          width: 280, flexShrink: 0,
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          padding: '20px 20px 24px',
        }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 16 }}>
            Setup Guide
          </div>
          <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 20 }}>
            {intg.setup_guide.map((step, i) => (
              <li key={i} style={{ display: 'flex', gap: 12 }}>
                <div style={{
                  width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                  background: 'var(--cyan-dim)', border: '1px solid rgba(33,212,253,0.3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.68rem', fontWeight: 700, color: 'var(--cyan)',
                  marginTop: 1,
                }}>{i + 1}</div>
                <div>
                  <div style={{ fontSize: '0.78rem', fontWeight: 600, marginBottom: 4, color: 'var(--text-primary)' }}>
                    {step.title}
                  </div>
                  <div style={{ fontSize: '0.73rem', color: 'var(--text-secondary)', lineHeight: 1.6, whiteSpace: 'pre-line', wordBreak: 'break-word' }}>
                    {step.body}
                  </div>
                </div>
              </li>
            ))}
          </ol>
          {intg.docs_url && (
            <a href={intg.docs_url} target="_blank" rel="noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 20, fontSize: '0.75rem', color: 'var(--cyan)', textDecoration: 'none' }}>
              Full documentation ↗
            </a>
          )}
        </div>
      )}

      {/* ── Credentials card ── */}
      <div style={{
        flex: 1, minWidth: 0,
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
      }}>

        {/* Test result banner */}
        {testResult && (
          <div style={{
            padding: '10px 24px', fontSize: '0.82rem', fontWeight: 500,
            background: testResult.success ? 'rgba(63,185,80,0.08)' : 'rgba(248,81,73,0.08)',
            color: testResult.success ? 'var(--green)' : 'var(--red)',
            borderBottom: '1px solid var(--border)',
          }}>
            {testResult.success ? '✓' : '✗'} {testResult.message}
          </div>
        )}

        <div style={{ padding: 24 }}>

          {/* Logo upload */}
          <div style={{ marginBottom: 24, paddingBottom: 24, borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
              Integration Logo
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{
                width: 56, height: 56, borderRadius: 12, flexShrink: 0,
                background: 'var(--bg-surface)', border: '1px solid var(--border)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '1.8rem', overflow: 'hidden',
              }}>
                {logoUrl
                  ? <img src={logoUrl} alt="logo" style={{ width: 40, height: 40, objectFit: 'contain' }} />
                  : intg.icon}
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept=".png,.jpg,.jpeg,.webp,.svg,.gif"
                    style={{ display: 'none' }}
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleLogoUpload(f); e.target.value = '' }}
                  />
                  <button
                    className="btn btn-secondary"
                    style={{ fontSize: '0.78rem', padding: '5px 14px' }}
                    disabled={logoUploading}
                    onClick={() => logoInputRef.current?.click()}>
                    {logoUploading ? 'Uploading…' : 'Upload Logo'}
                  </button>
                  {logoMsg && (
                    <span style={{ fontSize: '0.75rem', color: logoMsg.ok ? 'var(--green)' : 'var(--red)' }}>
                      {logoMsg.ok ? '✓' : '✗'} {logoMsg.text}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  PNG, JPG, WEBP, SVG or GIF · max 2 MB
                </div>
              </div>
            </div>
          </div>

          {/* Credentials */}
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 14 }}>
            Connection Details
          </div>
          {err && <div className="alert alert-error" style={{ marginBottom: 14, fontSize: '0.8rem' }}>{err}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14, marginBottom: 24 }}>
            {intg.fields.map(f => (
              <div className="form-group" key={f.key} style={{ marginBottom: 0 }}>
                <label style={{ fontSize: '0.78rem' }}>{f.label}</label>
                {f.type === 'file' ? (
                  <div>
                    <input
                      ref={el => fileInputRefs.current[f.key] = el}
                      type="file" accept={f.accept || '*'}
                      style={{ display: 'none' }}
                      onChange={e => { const file = e.target.files?.[0]; if (file) handleFileUpload(f, file); e.target.value = '' }}
                    />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div className="input" style={{ flex: 1, fontSize: '0.8rem', color: fields[f.key] ? 'var(--text-primary)' : 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'default' }}>
                        {fields[f.key] ? fields[f.key].split('/').pop().split('\\').pop() : 'No file uploaded'}
                      </div>
                      <button className="btn btn-secondary" style={{ fontSize: '0.78rem', padding: '5px 12px', whiteSpace: 'nowrap' }}
                        disabled={uploading[f.key]}
                        onClick={() => fileInputRefs.current[f.key]?.click()}>
                        {uploading[f.key] ? 'Uploading…' : 'Upload'}
                      </button>
                    </div>
                    {uploadMsg[f.key] && (
                      <div style={{ fontSize: '0.73rem', marginTop: 4, color: uploadMsg[f.key].ok ? 'var(--green)' : 'var(--red)' }}>
                        {uploadMsg[f.key].ok ? '✓' : '✗'} {uploadMsg[f.key].text}
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ position: 'relative' }}>
                    <input
                      className="input"
                      style={{ fontSize: '0.85rem', paddingRight: f.secret ? 34 : undefined }}
                      type={f.secret && !show[f.key] ? 'password' : 'text'}
                      placeholder={f.placeholder || (f.secret ? 'Enter to update…' : '')}
                      value={fields[f.key] ?? ''}
                      onChange={e => setFields(v => ({ ...v, [f.key]: e.target.value }))}
                      onFocus={() => { if (f.secret && fields[f.key] === MASK) setFields(v => ({ ...v, [f.key]: '' })) }}
                    />
                    {f.secret && (
                      <button tabIndex={-1}
                        style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.85rem', padding: 0 }}
                        onClick={() => setShow(s => ({ ...s, [f.key]: !s[f.key] }))}>
                        {show[f.key] ? '🙈' : '👁'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Footer actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 4 }}>
            <button className="btn btn-primary" style={{ fontSize: '0.82rem' }}
              onClick={handleSave} disabled={saving || !dirty}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
            <button className="btn btn-ghost" style={{ fontSize: '0.82rem' }}
              onClick={handleTest} disabled={testing}>
              {testing ? '⏳ Testing…' : '⚡ Test Connection'}
            </button>
            {saveMsg && <span style={{ fontSize: '0.78rem', color: 'var(--green)' }}>✓ {saveMsg}</span>}
          </div>

        </div>
      </div>

      </div>{/* end two-column body */}

    </div>
  )
}

function IntegrationsTab() {
  const [integrations,   setIntegrations]   = useState([])
  const [loading,        setLoading]        = useState(true)
  const [search,         setSearch]         = useState('')
  const [activeCategory, setActiveCategory] = useState(null)   // null = All, '__integrated__' = Integrated, else category string
  const [configuring,    setConfiguring]    = useState(null)   // integration object being configured, or null
  const [iconSize,       setIconSize]       = useState(() => {
    const saved = localStorage.getItem('integrations.iconSize')
    return saved ? Number(saved) : 48
  })

  const load = async () => {
    try {
      const r = await getIntegrations()
      setIntegrations(r.data)
      // Keep setup page in sync with latest data after save
      if (configuring) {
        const updated = r.data.find(i => i.id === configuring.id)
        if (updated) setConfiguring(updated)
      }
    } catch { /* silent */ }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const searchLower = search.trim().toLowerCase()

  const matchesSearch = intg =>
    !searchLower ||
    intg.name.toLowerCase().includes(searchLower) ||
    intg.description.toLowerCase().includes(searchLower)

  const inCategory = (intg, cat) =>
    (intg.categories ?? [intg.category]).includes(cat)

  const filtered = integrations.filter(intg => {
    if (!matchesSearch(intg)) return false
    if (activeCategory === '__integrated__') return intg.configured
    if (activeCategory) return inCategory(intg, activeCategory)
    return true
  })

  // Count badges for sidebar
  const integratedCount = integrations.filter(i => i.configured).length
  const categoryCount = cat => integrations.filter(i => inCategory(i, cat) && matchesSearch(i)).length

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)' }}>
      <div className="spinner" /><span style={{ fontSize: '0.875rem' }}>Loading…</span>
    </div>
  )

  if (configuring) return (
    <IntegrationSetupPage
      integration={configuring}
      onExit={() => setConfiguring(null)}
      onSaved={load}
    />
  )

  return (
    <div style={{ display: 'flex', gap: 0, minHeight: 0 }}>

      {/* ── Left sidebar ─────────────────────────────────────────────────── */}
      <div style={{
        width: 210, flexShrink: 0,
        borderRight: '1px solid var(--border)',
        paddingRight: 8,
        display: 'flex', flexDirection: 'column', gap: 2,
      }}>
        {/* Search */}
        <div style={{ position: 'relative', marginBottom: 12 }}>
          <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: '0.8rem', pointerEvents: 'none' }}>🔍</span>
          <input
            className="input"
            style={{ paddingLeft: 28, fontSize: '0.82rem', height: 34 }}
            placeholder="Search apps…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* Section label */}
        <div style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-muted)', textTransform: 'uppercase', padding: '2px 10px 6px' }}>
          Categories
        </div>

        {/* Integrated */}
        <SidebarCatItem
          label="Integrated"
          count={integratedCount}
          active={activeCategory === '__integrated__'}
          onClick={() => setActiveCategory(activeCategory === '__integrated__' ? null : '__integrated__')}
          accent
        />

        {/* All */}
        <SidebarCatItem
          label="All"
          count={integrations.filter(i => matchesSearch(i)).length}
          active={activeCategory === null}
          onClick={() => setActiveCategory(null)}
        />

        <div style={{ height: 1, background: 'var(--border)', margin: '6px 10px' }} />

        {INTEGRATION_CATEGORIES.map(cat => (
          <SidebarCatItem
            key={cat}
            label={cat}
            count={categoryCount(cat)}
            active={activeCategory === cat}
            onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
          />
        ))}
      </div>

      {/* ── Right content ────────────────────────────────────────────────── */}
      <div style={{ flex: 1, minWidth: 0, paddingLeft: 24 }}>
        {/* Heading */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: '1rem', fontWeight: 700, marginBottom: 2 }}>
              {activeCategory === '__integrated__' ? 'Integrated' : activeCategory ?? 'All Integrations'}
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              {filtered.length} {filtered.length === 1 ? 'app' : 'apps'}
              {activeCategory === '__integrated__' && ' connected'}
            </div>
          </div>

          {/* Icon size control */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 2 }}>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 500, whiteSpace: 'nowrap' }}>Icon size</span>
            <input
              type="range" min={28} max={72} step={4}
              value={iconSize}
              onChange={e => {
                const v = Number(e.target.value)
                setIconSize(v)
                localStorage.setItem('integrations.iconSize', v)
              }}
              style={{ width: 80, accentColor: 'var(--cyan)', cursor: 'pointer' }}
            />
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 500, width: 26, textAlign: 'right' }}>{iconSize}</span>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)', paddingTop: 24 }}>
            {search ? `No apps match "${search}".` : 'No integrations in this category yet.'}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
            {filtered.map(intg => (
              <IntegrationCard key={intg.id} integration={intg} onConfigure={setConfiguring} iconSize={iconSize} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Client Integrations tab ───────────────────────────────────────────────────

function ClientIntegrationsTab() {
  const [clientIntegrations, setClientIntegrations] = useState([])
  const [customers,          setCustomers]          = useState([])
  const [integrationDefs,    setIntegrationDefs]    = useState([])
  const [loading,            setLoading]            = useState(true)
  const [showModal,          setShowModal]          = useState(false)
  const [editing,            setEditing]            = useState(null)   // ClientIntegration object
  const [testResult,         setTestResult]         = useState({})

  const load = async () => {
    setLoading(true)
    const [ciRes, custRes, intgRes] = await Promise.all([
      getClientIntegrations(),
      getAssetCustomers(),
      getIntegrations(),
    ])
    setClientIntegrations(ciRes.data || [])
    setCustomers(custRes.data || [])
    setIntegrationDefs(intgRes.data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const handleDelete = async (id) => {
    if (!confirm('Remove this client integration?')) return
    await deleteClientIntegration(id)
    load()
  }

  const handleToggle = async (ci) => {
    await toggleClientIntegration(ci.id, !ci.enabled)
    load()
  }

  const handleTest = async (id) => {
    setTestResult(r => ({ ...r, [id]: { loading: true } }))
    const res = await testClientIntegration(id).catch(() => ({ data: { success: false, message: 'Request failed' } }))
    setTestResult(r => ({ ...r, [id]: res.data }))
  }

  // Group by customer
  const byCustomer = customers.map(c => ({
    customer: c,
    integrations: clientIntegrations.filter(ci => ci.customer_id === c.id),
  })).filter(g => g.integrations.length > 0 || true)

  const usedTypes = (customerId) => clientIntegrations.filter(ci => ci.customer_id === customerId).map(ci => ci.integration_type)

  return (
    <div style={{ padding: '24px 28px', maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h2 style={{ fontWeight: 700, fontSize: '1rem', marginBottom: 2 }}>Client Integrations</h2>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>
            Each client can have one instance of each integration type.
          </p>
        </div>
        <button className="btn btn-primary" style={{ fontSize: '0.82rem' }} onClick={() => { setEditing(null); setShowModal(true) }}>
          + Add Integration
        </button>
      </div>

      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading…</div>
      ) : clientIntegrations.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', padding: '40px 0', textAlign: 'center' }}>
          No client integrations yet. Click + Add Integration to configure one.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {customers.filter(c => clientIntegrations.some(ci => ci.customer_id === c.id)).map(c => (
            <div key={c.id}>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                🏢 {c.name}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {clientIntegrations.filter(ci => ci.customer_id === c.id).map(ci => {
                  const tr = testResult[ci.id]
                  return (
                    <div key={ci.id} className="card" style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
                      <span style={{ fontSize: '1.5rem', flexShrink: 0 }}>{ci.icon}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{ci.name}</div>
                        {ci.label && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{ci.label}</div>}
                      </div>
                      <span style={{
                        fontSize: '0.68rem', fontWeight: 600, padding: '2px 8px', borderRadius: 8,
                        background: ci.configured ? '#22c55e22' : '#f59e0b22',
                        color:      ci.configured ? '#22c55e'   : '#f59e0b',
                      }}>{ci.configured ? 'Configured' : 'Incomplete'}</span>
                      {tr && !tr.loading && (
                        <span style={{ fontSize: '0.75rem', color: tr.success ? '#22c55e' : '#ef4444' }}>
                          {tr.success ? '✓' : '✗'} {tr.message}
                        </span>
                      )}
                      <button className="btn btn-ghost" style={{ fontSize: '0.75rem', padding: '3px 8px' }}
                        onClick={() => handleTest(ci.id)} disabled={tr?.loading}>
                        {tr?.loading ? '…' : 'Test'}
                      </button>
                      <button className="btn btn-ghost" style={{ fontSize: '0.75rem', padding: '3px 8px' }}
                        onClick={() => { setEditing(ci); setShowModal(true) }}>
                        Edit
                      </button>
                      <button className="btn btn-ghost" style={{ fontSize: '0.75rem', padding: '3px 8px', color: ci.enabled ? 'var(--text-muted)' : 'var(--cyan)' }}
                        onClick={() => handleToggle(ci)}>
                        {ci.enabled ? 'Disable' : 'Enable'}
                      </button>
                      <button className="btn btn-ghost" style={{ fontSize: '0.75rem', padding: '3px 8px', color: '#ef4444' }}
                        onClick={() => handleDelete(ci.id)}>
                        Remove
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <ClientIntegrationModal
          editing={editing}
          customers={customers}
          integrationDefs={integrationDefs}
          usedTypes={usedTypes}
          onClose={() => { setShowModal(false); setEditing(null) }}
          onSaved={() => { setShowModal(false); setEditing(null); load() }}
        />
      )}
    </div>
  )
}

function ClientIntegrationModal({ editing, customers, integrationDefs, usedTypes, onClose, onSaved, lockedType }) {
  const [customerId,  setCustomerId]  = useState(editing?.customer_id ?? '')
  const [intgType,    setIntgType]    = useState(editing?.integration_type ?? lockedType ?? '')
  const [label,       setLabel]       = useState(editing?.label ?? '')
  const [fieldVals,   setFieldVals]   = useState(() => {
    if (!editing) return {}
    const vals = {}
    for (const f of editing.fields || []) vals[f.key] = f.value || ''
    return vals
  })
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  const selectedDef = integrationDefs.find(d => d.id === intgType)
  const availableTypes = integrationDefs.filter(d => {
    if (!customerId) return true
    const used = usedTypes(parseInt(customerId))
    return !used.includes(d.id) || d.id === editing?.integration_type
  })

  const setVal = (k, v) => setFieldVals(prev => ({ ...prev, [k]: v }))

  const submit = async () => {
    if (!customerId || !intgType) { setError('Select a client and integration type.'); return }
    setSaving(true)
    setError('')
    try {
      if (editing) {
        await updateClientIntegration(editing.id, { label: label || null, values: fieldVals })
      } else {
        await createClientIntegration({ customer_id: parseInt(customerId), integration_type: intgType, label: label || null, values: fieldVals })
      }
      onSaved()
    } catch (e) {
      setError(e.response?.data?.detail || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: 'var(--bg-surface)', borderRadius: 12, width: '100%', maxWidth: 560, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 48px rgba(0,0,0,0.4)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
          <h3 style={{ fontWeight: 700, fontSize: '1rem' }}>{editing ? 'Edit Integration' : 'Add Client Integration'}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: 'var(--text-muted)' }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {error && <div style={{ color: '#ef4444', fontSize: '0.82rem', background: '#ef444422', borderRadius: 6, padding: '8px 12px' }}>{error}</div>}

          <div>
            <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>Client *</div>
            <select className="select" value={customerId} onChange={e => { setCustomerId(e.target.value); setIntgType('') }} disabled={!!editing} style={{ width: '100%' }}>
              <option value="">— Select client —</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          {!lockedType && (
            <div>
              <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>Integration Type *</div>
              <select className="select" value={intgType} onChange={e => setIntgType(e.target.value)} disabled={!!editing} style={{ width: '100%' }}>
                <option value="">— Select integration —</option>
                {availableTypes.map(d => <option key={d.id} value={d.id}>{d.icon} {d.name}</option>)}
              </select>
            </div>
          )}

          <div>
            <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>Label (optional)</div>
            <input className="input" value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Production Freshservice" style={{ width: '100%' }} />
          </div>

          {selectedDef && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)' }}>Connection Details</div>
              {selectedDef.fields.map(f => (
                <div key={f.key}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>{f.label}{f.optional ? '' : ' *'}</div>
                  <input
                    className="input"
                    type={f.secret ? 'password' : 'text'}
                    value={fieldVals[f.key] || ''}
                    onChange={e => setVal(f.key, e.target.value)}
                    placeholder={f.placeholder || (f.secret && editing ? '(unchanged)' : '')}
                    style={{ width: '100%' }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={saving || !customerId || !intgType}>
            {saving ? 'Saving…' : editing ? 'Save Changes' : 'Add Integration'}
          </button>
        </div>
      </div>
    </div>
  )
}

function SidebarCatItem({ label, count, active, onClick, accent = false }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        width: '100%', textAlign: 'left',
        padding: '6px 10px', borderRadius: 'var(--radius-sm)',
        border: 'none', cursor: 'pointer',
        background: active ? (accent ? 'rgba(33,212,253,0.12)' : 'var(--bg-elevated)') : 'transparent',
        color: active ? (accent ? 'var(--cyan)' : 'var(--text-primary)') : 'var(--text-secondary)',
        fontWeight: active ? 600 : 400,
        fontSize: '0.82rem',
        transition: 'background 0.15s, color 0.15s',
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg-elevated)' }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{label}</span>
      {count > 0 && (
        <span style={{
          fontSize: '0.68rem', fontWeight: 600, marginLeft: 6, flexShrink: 0,
          padding: '1px 6px', borderRadius: 20,
          background: active && accent ? 'rgba(33,212,253,0.2)' : 'var(--bg-surface)',
          color: active && accent ? 'var(--cyan)' : 'var(--text-muted)',
          border: '1px solid var(--border)',
        }}>
          {count}
        </span>
      )}
    </button>
  )
}

/* ── Sites tab (admin only) ──────────────────────────────────────────────── */

function SiteCard({ site, allSwitches, allMaps, allSites, clients = [], onRefresh }) {
  const [expanded,       setExpanded]       = useState(false)
  const [swForm,         setSwForm]         = useState({ name: '', ip_address: '', stack_position: '1' })
  const [swAdding,       setSwAdding]       = useState(false)
  const [showSwForm,     setShowSwForm]     = useState(false)
  const [mapName,        setMapName]        = useState('')
  const [mapUploading,   setMapUploading]   = useState(false)
  const [showMapUpload,  setShowMapUpload]  = useState(false)
  const [err,            setErr]            = useState(null)
  const [configuringMap,      setConfiguringMap]      = useState(null)
  const [configuringSwitches, setConfiguringSwitches] = useState([])
  const [editorSelectedSeat,  setEditorSelectedSeat]  = useState(null)
  const mapFileRef = useRef(null)

  const [unifiHosts,    setUnifiHosts]    = useState(null)
  const [unifiLoading,  setUnifiLoading]  = useState(false)
  const [unifiLinking,  setUnifiLinking]  = useState(false)
  const [unifiDevices,  setUnifiDevices]  = useState(null)
  const [devicesLoading, setDevicesLoading] = useState(false)
  const [controllerSites, setControllerSites] = useState(null)
  const [controllerSitesLoading, setControllerSitesLoading] = useState(false)

  const loadUnifiHosts = async () => {
    if (unifiHosts !== null) return
    setUnifiLoading(true)
    try { setUnifiHosts((await getUnifiHosts()).data) }
    catch { setUnifiHosts([]) }
    finally { setUnifiLoading(false) }
  }

  const loadDevices = async (hostId) => {
    if (!hostId) { setUnifiDevices(null); return }
    setDevicesLoading(true)
    try { setUnifiDevices((await getUnifiDevices(hostId)).data) }
    catch { setUnifiDevices([]) }
    finally { setDevicesLoading(false) }
  }

  const loadControllerSites = async (hostId) => {
    if (!hostId) { setControllerSites(null); return }
    setControllerSitesLoading(true)
    try { setControllerSites((await getHostControllerSites(hostId)).data) }
    catch { setControllerSites([]) }
    finally { setControllerSitesLoading(false) }
  }

  const handleExpand = () => {
    const next = !expanded
    setExpanded(next)
    if (next) {
      loadUnifiHosts()
      if (site.unifi_host_id) {
        loadDevices(site.unifi_host_id)
        loadControllerSites(site.unifi_host_id)
      }
    }
  }

  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState(null)

  const handleSync = async () => {
    setSyncing(true); setSyncMsg(null)
    try {
      const r = await syncUnifiDevices(site.id)
      setSyncMsg(r.data.message)
      await onRefresh()
    } catch (e) {
      setSyncMsg(e.response?.data?.detail || 'Sync failed')
    } finally { setSyncing(false) }
  }

  const handleLinkHost = async (hostId) => {
    setUnifiLinking(true)
    try {
      await linkUnifiHost(site.id, hostId || null)
      await onRefresh()
      if (hostId) {
        loadDevices(hostId)
        loadControllerSites(hostId)
      } else {
        setUnifiDevices(null)
        setControllerSites(null)
      }
    }
    catch { setErr('Failed to update UniFi host link') }
    finally { setUnifiLinking(false) }
  }

  const handleSetUnifiSite = async (siteName) => {
    try { await setSiteUnifiSiteName(site.id, siteName || null); await onRefresh() }
    catch { setErr('Failed to update UniFi site') }
  }

  const handleSetClient = async (customerId) => {
    try { await setSiteCustomer(site.id, customerId ? parseInt(customerId) : null); await onRefresh() }
    catch { setErr('Failed to update client assignment') }
  }

  const handleOpenSeatEditor = async (fm) => {
    const mapRes = await getMap(fm.id)
    setConfiguringMap(mapRes.data)
    setConfiguringSwitches(site.switches)
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
      setShowSwForm(false)
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
      setShowMapUpload(false)
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
    textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0,
  }

  const isSwitchDevice = d => {
    const t = (d.type || d.device_type || d.model || '').toLowerCase()
    return t.includes('usw') || t.includes('switch')
  }
  const isApDevice = d => {
    const t = (d.type || d.device_type || d.model || '').toLowerCase()
    return t.includes('uap') || t.includes('u6-') || t.includes('u7-') || t.includes('access_point') || t.includes('access') || t.includes('ap-')
  }
  const uswDevices = unifiDevices?.filter(isSwitchDevice) || []
  const uapDevices = unifiDevices?.filter(isApDevice) || []

  const DeviceGrid = ({ devices }) => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8, marginTop: 8 }}>
      {devices.map(d => (
        <div key={d.id} style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)', padding: '8px 10px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
            <span style={{
              width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
              background: d.status === 'online' ? '#22c55e' : d.status === 'offline' ? '#ef4444' : '#a3a3a3',
            }} />
            <span style={{ fontSize: '0.78rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {d.name || d.mac}
            </span>
          </div>
          {d.model && <div style={{ fontSize: '0.67rem', color: 'var(--text-muted)' }}>{d.model}</div>}
          {d.ipAddress && <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--cyan)', marginTop: 2 }}>{d.ipAddress}</div>}
        </div>
      ))}
    </div>
  )

  return (
    <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>

      {/* ── Header ── */}
      <div
        onClick={handleExpand}
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
          <span className="badge badge-gray" style={{ fontSize: '0.7rem' }}>
            {site.switches.length} switch{site.switches.length !== 1 ? 'es' : ''} · {site.maps.length} map{site.maps.length !== 1 ? 's' : ''}
          </span>
          {site.customer_id && clients.find(c => c.id === site.customer_id) && (
            <span className="badge" style={{ fontSize: '0.7rem', background: 'rgba(59,130,246,0.12)', color: '#3b82f6', border: '1px solid rgba(59,130,246,0.3)', borderRadius: 4 }}>
              {clients.find(c => c.id === site.customer_id).name}
            </span>
          )}
          {site.unifi_host_id && (
            <span className="badge" style={{ fontSize: '0.7rem', background: 'rgba(6,182,212,0.12)', color: 'var(--cyan)', border: '1px solid rgba(6,182,212,0.3)', borderRadius: 4 }}>
              📡 UniFi linked
            </span>
          )}
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

      {expanded && (
        <div style={{ padding: '16px 16px 8px' }}>
          {err && <div className="alert alert-error" style={{ marginBottom: 12, fontSize: '0.8rem' }}>{err}</div>}

          {/* ── CLIENT ASSIGNMENT ── */}
          {clients.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={sectionLabel}>Client</div>
              <div style={{ marginTop: 8 }}>
                <select className="select" style={{ fontSize: '0.8rem', maxWidth: 320 }}
                  value={site.customer_id || ''} onChange={e => handleSetClient(e.target.value)}>
                  {!site.customer_id && <option value="">— Select a client —</option>}
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
          )}

          {/* ── NETWORK ── */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={sectionLabel}>Network</div>
              {site.unifi_host_id && (
                <button className="btn btn-ghost" style={{ fontSize: '0.72rem', padding: '3px 10px' }}
                  onClick={handleSync} disabled={syncing}>
                  {syncing ? '⏳ Syncing…' : '↻ Sync Devices'}
                </button>
              )}
            </div>
            {syncMsg && <div className={`alert ${syncMsg.includes('failed') || syncMsg.includes('error') ? 'alert-error' : 'alert-info'}`} style={{ marginBottom: 10, fontSize: '0.78rem' }}>{syncMsg}</div>}

            {/* UniFi host selector */}
            <div style={{ marginBottom: 14 }}>
              {unifiLoading ? (
                <div className="flex items-center gap-2" style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                  <div className="spinner" style={{ width: 12, height: 12 }} /> Loading hosts…
                </div>
              ) : unifiHosts?.length === 0 ? (
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>
                  No UniFi hosts found — check your UniFi integration in the Integrations tab.
                </p>
              ) : unifiHosts ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <select className="select" style={{ fontSize: '0.8rem', flex: 1 }}
                    value={site.unifi_host_id || ''} onChange={e => handleLinkHost(e.target.value)} disabled={unifiLinking}>
                    <option value="">— Select UniFi host —</option>
                    {unifiHosts.map(h => {
                      const takenBy = allSites?.find(s => s.id !== site.id && s.unifi_host_id === h.id)
                      return takenBy
                        ? null
                        : <option key={h.id} value={h.id}>{h.name || h.id}</option>
                    })}
                  </select>
                  {site.unifi_host_id && (
                    <button className="btn btn-ghost" style={{ fontSize: '0.78rem', flexShrink: 0 }}
                      onClick={() => handleLinkHost(null)} disabled={unifiLinking}>Unlink</button>
                  )}
                </div>
              ) : null}
            </div>

            {/* UniFi site selector */}
            {site.unifi_host_id && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 4 }}>UniFi site</div>
                {controllerSitesLoading ? (
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div className="spinner" style={{ width: 12, height: 12 }} /> Loading sites…
                  </div>
                ) : controllerSites && controllerSites.length > 0 ? (
                  <select className="select" style={{ fontSize: '0.8rem', width: '100%' }}
                    value={site.unifi_site_name || ''}
                    onChange={e => handleSetUnifiSite(e.target.value)}>
                    <option value="">— All sites (no filter) —</option>
                    {controllerSites.map(s => (
                      <option key={s.name} value={s.name}>{s.desc || s.name}</option>
                    ))}
                  </select>
                ) : controllerSites?.length === 0 ? (
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>No sites found on this host.</p>
                ) : null}
              </div>
            )}

            {/* Live devices */}
            {site.unifi_host_id && (
              devicesLoading ? (
                <div className="flex items-center gap-2" style={{ color: 'var(--text-muted)', fontSize: '0.78rem', padding: '4px 0' }}>
                  <div className="spinner" style={{ width: 12, height: 12 }} /> Loading devices…
                </div>
              ) : unifiDevices === null ? null
              : unifiDevices.length === 0 ? (
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>No devices found on this host.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {uswDevices.length > 0 && (
                    <div>
                      <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        Switches ({uswDevices.length})
                      </div>
                      <DeviceGrid devices={uswDevices} />
                    </div>
                  )}
                  {uapDevices.length > 0 && (
                    <div>
                      <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        Access Points ({uapDevices.length})
                      </div>
                      <DeviceGrid devices={uapDevices} />
                    </div>
                  )}
                </div>
              )
            )}
            {!site.unifi_host_id && unifiHosts?.length > 0 && (
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0, fontStyle: 'italic' }}>
                Select a host above to view live network devices.
              </p>
            )}

          </div>

          <div className="divider" />

          {/* ── FLOOR MAPS ── */}
          <div style={{ margin: '16px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={sectionLabel}>Floor Maps</div>
              <button className="btn btn-ghost" style={{ fontSize: '0.72rem', padding: '3px 10px' }}
                onClick={() => setShowMapUpload(v => !v)}>
                {showMapUpload ? '✕ Cancel' : '+ Upload Map'}
              </button>
            </div>

            {showMapUpload && (
              <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 12, marginBottom: 14 }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 8 }}>Upload a floor map (image or PDF)</div>
                <div className="form-row" style={{ alignItems: 'flex-end', gap: 8 }}>
                  <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                    <input className="input" style={{ fontSize: '0.8rem' }} placeholder="Map name (e.g. 2nd Floor West)"
                      value={mapName} onChange={e => setMapName(e.target.value)} />
                  </div>
                  <button className="btn btn-primary" style={{ fontSize: '0.78rem', flexShrink: 0 }}
                    disabled={mapUploading} onClick={() => mapFileRef.current?.click()}>
                    {mapUploading ? '⏳ Uploading…' : '📤 Choose File'}
                  </button>
                  <input ref={mapFileRef} type="file" accept="image/*,application/pdf" style={{ display: 'none' }} onChange={handleUploadMap} />
                </div>
              </div>
            )}

            {site.maps.length > 0 ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
                {site.maps.map(fm => {
                  const meta  = allMaps?.find(m => m.id === fm.id)
                  const isPdf = fm.filename?.toLowerCase().endsWith('.pdf')
                  return (
                    <div key={fm.id} style={{
                      background: 'var(--bg-surface)', border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)', overflow: 'hidden',
                    }}>
                      <div onClick={() => handleOpenSeatEditor(fm)} title="Click to configure seats"
                        style={{ height: 110, overflow: 'hidden', cursor: 'pointer', background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {isPdf ? (
                          <Document
                            file={`/api/maps/${fm.id}/image`}
                            loading={<span style={{ fontSize: '1.2rem', opacity: 0.4 }}>⏳</span>}
                            error={<span style={{ fontSize: '2rem', opacity: 0.4 }}>📄</span>}
                          >
                            <Page
                              pageNumber={1}
                              width={160}
                              renderTextLayer={false}
                              renderAnnotationLayer={false}
                            />
                          </Document>
                        ) : (
                          <img src={`/api/maps/${fm.id}/image`} alt={fm.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        )}
                      </div>
                      <div style={{ padding: '8px 10px' }}>
                        <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fm.name}</div>
                        {meta != null && (
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 6 }}>
                            {meta.seat_count} seat{meta.seat_count !== 1 ? 's' : ''}
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn btn-ghost" style={{ fontSize: '0.68rem', padding: '3px 0', flex: 1 }}
                            onClick={() => handleOpenSeatEditor(fm)}>📍 Configure</button>
                          <button className="btn btn-danger" style={{ fontSize: '0.68rem', padding: '3px 8px' }}
                            onClick={() => handleDeleteMap(fm)}>Delete</button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: '2rem', opacity: 0.35, marginBottom: 8 }}>🗺️</div>
                <p style={{ fontSize: '0.78rem', margin: 0 }}>No floor maps uploaded yet.</p>
              </div>
            )}
          </div>

          <div className="divider" />

          {/* ── PORT SECURITY SWITCHES ── */}
          <div style={{ margin: '16px 0 8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={sectionLabel}>Port Security Switches</div>
              <button className="btn btn-ghost" style={{ fontSize: '0.72rem', padding: '3px 10px' }}
                onClick={() => setShowSwForm(v => !v)}>
                {showSwForm ? '✕ Cancel' : '+ Add Switch'}
              </button>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: site.switches.length > 0 ? 10 : 0 }}>
              {site.switches.length === 0 && !showSwForm && <span className="text-xs text-muted">None assigned</span>}
              {site.switches.map(sw => (
                <div key={sw.id} className="badge badge-gray" style={{ padding: '4px 10px', fontSize: '0.75rem', gap: 6 }}>
                  <span>📡</span>
                  <span>{sw.name}</span>
                  <span className="font-mono" style={{ color: 'var(--cyan)' }}>{sw.ip_address}</span>
                  {sw.model && <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>{sw.model}</span>}
                  {sw.unifi_device_id
                    ? <span style={{ fontSize: '0.65rem', background: 'rgba(6,182,212,0.15)', color: 'var(--cyan)', border: '1px solid rgba(6,182,212,0.3)', borderRadius: 3, padding: '1px 4px' }}>UniFi</span>
                    : <span style={{ color: 'var(--text-muted)' }}>#{sw.stack_position}</span>
                  }
                  <button title="Remove from site" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0, fontSize: '0.7rem' }}
                    onClick={() => handleDisassociateSwitch(sw.id)}>✕</button>
                  <button title="Delete switch" style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', padding: 0, fontSize: '0.7rem' }}
                    onClick={() => handleDeleteSwitch(sw)}>🗑</button>
                </div>
              ))}
            </div>

            {showSwForm && (
              <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 10, marginBottom: 8 }}>
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
            )}

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
        </div>
      )}

      {/* ── Seat Editor Modal ── */}
      {configuringMap && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(3px)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: '1.1rem' }}>📍</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: '1rem' }}>Configure Seats — {configuringMap.name}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{site.name} · Click map to add pin · Drag pins to reposition</div>
              </div>
            </div>
            <button onClick={() => { setConfiguringMap(null); onRefresh() }}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.2rem', padding: 4 }}>✕</button>
          </div>
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <FloorMapManager
              switches={configuringSwitches}
              onSwitchesChange={setConfiguringSwitches}
              currentMap={configuringMap}
              onMapChange={setConfiguringMap}
              onSeatSelect={setEditorSelectedSeat}
              selectedSeat={editorSelectedSeat}
              siteAPs={site.unifi_devices?.filter(d => d.device_type === 'ap') || []}
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
  const [clients,     setClients]     = useState([])
  const [loading,     setLoading]     = useState(true)
  const [err,         setErr]         = useState(null)
  const [showModal,   setShowModal]   = useState(false)
  const [newName,     setNewName]     = useState('')
  const [newClientId, setNewClientId] = useState('')
  const [saving,      setSaving]      = useState(false)

  const reload = async () => {
    try {
      const [sitesRes, swRes, mapsRes, clientsRes] = await Promise.all([getSites(), getSwitches(), getMaps(), api.get('/api/tickets/customers')])
      setSites(sitesRes.data)
      setAllSwitches(swRes.data)
      setAllMaps(mapsRes.data)
      setClients(clientsRes.data)
    } catch { setErr('Failed to load sites') }
    finally { setLoading(false) }
  }

  useEffect(() => { reload() }, [])

  const openModal = (preselectedClientId = '') => {
    setNewName(''); setNewClientId(preselectedClientId ? String(preselectedClientId) : (clients.length === 1 ? String(clients[0].id) : '')); setErr(null); setShowModal(true)
  }
  const closeModal = () => { setShowModal(false); setNewName(''); setNewClientId('') }

  const handleCreate = async () => {
    if (!newName.trim() || !newClientId) return
    setSaving(true); setErr(null)
    try {
      await createSite(newName.trim(), parseInt(newClientId))
      closeModal()
      await reload()
    } catch (e) { setErr(e.response?.data?.detail || 'Failed to create site') }
    finally { setSaving(false) }
  }

  if (loading) return <div className="flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}><div className="spinner" /><span className="text-sm">Loading…</span></div>

  // Group sites by client
  const sitesByClient = clients.map(c => ({
    client: c,
    sites: sites.filter(s => s.customer_id === c.id),
  }))
  const unassigned = sites.filter(s => !s.customer_id)

  return (
    <div>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, gap: 16 }}>
        <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
          Each site belongs to a client. Sites group switches and floor maps for Port Security.
        </p>
        <button className="btn btn-primary" style={{ fontSize: '0.82rem', flexShrink: 0 }}
          onClick={() => openModal()} disabled={clients.length === 0}>
          + New Site
        </button>
      </div>

      {clients.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: 12, opacity: 0.4 }}>🏢</div>
          <p style={{ fontSize: '0.9rem' }}>No clients yet. Add a client in the <strong>Clients</strong> tab before creating sites.</p>
        </div>
      )}

      {err && <div className="alert alert-error" style={{ marginBottom: 12 }}>{err}</div>}

      {/* Sites grouped by client */}
      {sitesByClient.map(({ client, sites: clientSites }) => (
        <div key={client.id} style={{ marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{client.name}</span>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', background: 'var(--bg-elevated)', padding: '1px 7px', borderRadius: 8 }}>
                {clientSites.length} site{clientSites.length !== 1 ? 's' : ''}
              </span>
            </div>
            <button className="btn btn-ghost" style={{ fontSize: '0.75rem', padding: '3px 10px' }}
              onClick={() => openModal(client.id)}>+ Add Site</button>
          </div>
          {clientSites.length === 0 ? (
            <div style={{ padding: '16px', background: 'var(--bg-elevated)', border: '1px dashed var(--border)', borderRadius: 'var(--radius-md)', color: 'var(--text-muted)', fontSize: '0.83rem', textAlign: 'center' }}>
              No sites for this client yet
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {clientSites.map(site => (
                <SiteCard key={site.id} site={site} allSwitches={allSwitches} allMaps={allMaps} allSites={sites} clients={clients} onRefresh={reload} />
              ))}
            </div>
          )}
        </div>
      ))}

      {/* Legacy unassigned sites */}
      {unassigned.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
            ⚠ Unassigned ({unassigned.length}) — assign these to a client
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {unassigned.map(site => (
              <SiteCard key={site.id} site={site} allSwitches={allSwitches} allMaps={allMaps} allSites={sites} clients={clients} onRefresh={reload} />
            ))}
          </div>
        </div>
      )}

      {/* New Site modal */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => { if (e.target === e.currentTarget) closeModal() }}>
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', width: 420, padding: 24, boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '1rem' }}>New Site</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>Add a new location to manage switches and floor maps</div>
              </div>
              <button onClick={closeModal} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.1rem', padding: 4, lineHeight: 1 }}>✕</button>
            </div>

            {err && <div className="alert alert-error" style={{ marginBottom: 14, fontSize: '0.82rem' }}>{err}</div>}

            <div className="form-group" style={{ marginBottom: 16 }}>
              <label>Client <span style={{ color: 'var(--red)' }}>*</span></label>
              <select className="select" value={newClientId} onChange={e => setNewClientId(e.target.value)} autoFocus>
                <option value="">— Select a client —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>

            <div className="form-group" style={{ marginBottom: 20 }}>
              <label>Site Name <span style={{ color: 'var(--red)' }}>*</span></label>
              <input
                className="input"
                placeholder="e.g. Headquarters, Branch Office 1"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreate()}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn btn-ghost" onClick={closeModal} disabled={saving}>Cancel</button>
              <button className="btn btn-primary" onClick={handleCreate} disabled={saving || !newName.trim() || !newClientId}>
                {saving ? 'Creating…' : 'Create Site'}
              </button>
            </div>
          </div>
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
  const [favicon,       setFavicon]       = useState('')
  const [icon,          setIcon]          = useState('')
  const [favUploading,  setFavUploading]  = useState(false)
  const [iconUploading, setIconUploading] = useState(false)
  const [msg, setMsg] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    if (!config) return
    if (config.faviconUrl !== undefined) setFavicon(config.faviconUrl)
    if (config.iconUrl    !== undefined) setIcon(config.iconUrl)
  }, [config])

  const flash = (ok, text) => {
    if (ok) { setMsg(text); setErr(null); setTimeout(() => setMsg(null), 3000) }
    else    { setErr(text); setMsg(null) }
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
            hint="Small square icon shown in the top-left sidebar. Recommended: PNG or SVG, 32×32 px."
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

/* ── Map Picker Modal ────────────────────────────────────────────────────── */

function MapPickerModal({ mapData, selectedSeatId, onSelect, onClose }) {
  const [ready,     setReady]     = useState(false)
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 })
  const [isPanning, setIsPanning] = useState(false)
  const [panStart,  setPanStart]  = useState({ x: 0, y: 0 })
  const [hoveredId, setHoveredId] = useState(null)
  const wrapperRef  = useRef(null)
  const contentRef  = useRef(null)
  const hasPanned   = useRef(false)
  const downPos     = useRef(null)

  useEffect(() => {
    if (!ready) return
    const id = requestAnimationFrame(() => requestAnimationFrame(() => fitMap()))
    return () => cancelAnimationFrame(id)
  }, [ready])

  const fitMap = () => {
    if (!wrapperRef.current || !contentRef.current) return
    const wW   = wrapperRef.current.clientWidth
    const wH   = wrapperRef.current.clientHeight
    const imgW = contentRef.current.offsetWidth
    const imgH = contentRef.current.offsetHeight
    if (!wW || !wH || !imgW || !imgH) return
    const scale = Math.min(wW / imgW, wH / imgH) * 0.92
    setTransform({ scale, x: (wW - imgW * scale) / 2, y: (wH - imgH * scale) / 2 })
  }

  useEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    const onWheel = (e) => {
      e.preventDefault()
      setTransform(prev => {
        const factor   = -e.deltaY * 0.001
        const newScale = Math.min(Math.max(prev.scale * (1 + factor), 0.1), 8)
        const rect     = el.getBoundingClientRect()
        const mx = e.clientX - rect.left
        const my = e.clientY - rect.top
        const ratio = newScale / prev.scale
        return { scale: newScale, x: mx - (mx - prev.x) * ratio, y: my - (my - prev.y) * ratio }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [ready])

  const onPointerDown = (e) => {
    if (e.target.closest('[data-seat-pin]')) return
    e.currentTarget.setPointerCapture(e.pointerId)
    hasPanned.current = false
    downPos.current   = { x: e.clientX, y: e.clientY }
    setIsPanning(true)
    setPanStart({ x: e.clientX, y: e.clientY })
  }
  const onPointerMove = (e) => {
    if (!isPanning) return
    if (downPos.current) {
      const dx = e.clientX - downPos.current.x
      const dy = e.clientY - downPos.current.y
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasPanned.current = true
    }
    setTransform(prev => ({ ...prev, x: prev.x + e.clientX - panStart.x, y: prev.y + e.clientY - panStart.y }))
    setPanStart({ x: e.clientX, y: e.clientY })
  }
  const onPointerUp = (e) => {
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch {}
    setIsPanning(false)
  }

  const handlePinClick = (e, seat) => {
    e.stopPropagation()
    if (hasPanned.current) return
    onSelect(seat.id)
    onClose()
  }

  const isPdf    = mapData?.filename?.toLowerCase().endsWith('.pdf')
  const rotation = mapData?.rotation ?? 0

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(4px)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{mapData?.name || 'Floor Map'}</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>Click a pin to set the conference room location</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" style={{ fontSize: '0.78rem' }} onClick={fitMap}>Fit map</button>
          <button className="btn btn-ghost" style={{ fontSize: '0.78rem' }} onClick={onClose}>✕ Cancel</button>
        </div>
      </div>

      <div ref={wrapperRef}
        style={{ flex: 1, overflow: 'hidden', cursor: isPanning ? 'grabbing' : 'grab', position: 'relative', background: 'var(--bg-base)' }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}>

        {!ready && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--text-muted)', zIndex: 10 }}>
            <div className="spinner" /> Loading map…
          </div>
        )}

        <div style={{ position: 'absolute', transformOrigin: '0 0', transform: `translate(${transform.x}px,${transform.y}px) scale(${transform.scale})` }}>
          <div ref={contentRef} style={{ transform: rotation ? `rotate(${rotation}deg)` : undefined, transformOrigin: '50% 50%', position: 'relative', display: 'inline-block' }}>
            {isPdf ? (
              <Document file={`/uploads/${mapData.filename}`} loading="">
                <Page pageNumber={1} renderTextLayer={false} renderAnnotationLayer={false} onRenderSuccess={() => setReady(true)} />
              </Document>
            ) : (
              <img src={`/uploads/${mapData.filename}`} alt="Floor plan"
                style={{ display: 'block', userSelect: 'none', maxWidth: 'none' }}
                onLoad={() => setReady(true)} draggable={false} />
            )}

            {ready && mapData.seats?.map(s => {
              const isSel  = s.id === selectedSeatId
              const isHov  = s.id === hoveredId
              const active = isSel || isHov
              return (
                <div key={s.id}
                  data-seat-pin="1"
                  onClick={e => handlePinClick(e, s)}
                  onPointerEnter={() => setHoveredId(s.id)}
                  onPointerLeave={() => setHoveredId(null)}
                  style={{
                    position: 'absolute', left: `${s.x_pct}%`, top: `${s.y_pct}%`,
                    transform: 'translate(-50%,-100%)',
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    zIndex: isSel ? 20 : isHov ? 15 : 5,
                    cursor: 'pointer',
                  }}>
                  {active && (
                    <div style={{
                      background: 'var(--bg-surface)',
                      border: `1px solid ${isSel ? 'var(--orange)' : 'var(--cyan)'}`,
                      borderRadius: 4, padding: '2px 8px', fontSize: '0.7rem', fontWeight: 700,
                      color: isSel ? 'var(--orange)' : 'var(--cyan)', whiteSpace: 'nowrap', marginBottom: 4,
                      boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
                      transform: rotation ? `rotate(${-rotation}deg)` : undefined,
                    }}>{s.seat_label}</div>
                  )}
                  <div style={{
                    width: active ? 20 : 14, height: active ? 20 : 14, borderRadius: '50%',
                    background: isSel ? 'var(--orange)' : isHov ? 'var(--cyan)' : 'rgba(56,189,248,0.55)',
                    boxShadow: isSel ? '0 0 0 4px rgba(255,150,50,0.35),0 0 12px rgba(255,150,50,0.5)'
                             : isHov ? '0 0 0 3px rgba(56,189,248,0.3)' : 'none',
                    border: '2px solid rgba(255,255,255,0.4)',
                    transition: 'all 0.1s',
                  }} />
                  <div style={{ width: 2, height: active ? 8 : 5, background: isSel ? 'var(--orange)' : 'var(--cyan)', opacity: 0.8 }} />
                </div>
              )
            })}
          </div>
        </div>
      </div>
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
  const [mapPickerRoom, setMapPickerRoom] = useState(null) // email of room with open map picker

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
      setSeatsCache(prev => ({ ...prev, [mapId]: { loading: false, seats: r.data.seats || [], mapInfo: r.data } }))
    } catch(e) {
      setSeatsCache(prev => ({ ...prev, [mapId]: { loading: false, seats: [], mapInfo: null } }))
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
                        <div className="flex items-center gap-2" style={{ color: 'var(--text-muted)', fontSize: '0.8rem', flex: '0 0 200px' }}>
                          <div className="spinner" /> Loading seats…
                        </div>
                      ) : (
                        <button
                          className="btn btn-ghost"
                          style={{ fontSize: '0.8rem', flex: '0 0 200px', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}
                          onClick={() => setMapPickerRoom(room.email)}
                          disabled={seats.length === 0}
                        >
                          <span style={{ flexShrink: 0 }}>📍</span>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {seats.length === 0
                              ? 'No seats on map'
                              : edit.seat_mapping_id
                                ? seats.find(s => s.id === edit.seat_mapping_id)?.seat_label || 'Seat selected'
                                : 'Pick on map…'}
                          </span>
                        </button>
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

      {/* Map picker modal */}
      {mapPickerRoom && (() => {
        const pickerEdit   = edits[mapPickerRoom] || {}
        const pickerSite   = sites.find(s => s.id === pickerEdit.site_id)
        const pickerMapId  = pickerSite?.maps?.[0]?.id ?? null
        const pickerMapInfo = pickerMapId ? seatsCache[pickerMapId]?.mapInfo : null
        return pickerMapInfo ? (
          <MapPickerModal
            mapData={pickerMapInfo}
            selectedSeatId={pickerEdit.seat_mapping_id}
            onSelect={seatId => patch(mapPickerRoom, { seat_mapping_id: seatId })}
            onClose={() => setMapPickerRoom(null)}
          />
        ) : null
      })()}
    </div>
  )
}

/* ── Roles Tab ───────────────────────────────────────────────────────────── */

const PERMISSION_GROUPS = [
  {
    key: 'nav', label: 'Navigation', hint: 'Which pages appear in the sidebar',
    perms: [
      { key: 'nav.dashboard',        label: 'Dashboard' },
      { key: 'nav.users',            label: 'User Lookup' },
      { key: 'nav.devices',          label: 'Device Search' },
      { key: 'nav.conference_rooms', label: 'Conference Rooms' },
      { key: 'nav.locations',        label: 'Locations' },
      { key: 'nav.network',          label: 'Network' },
      { key: 'nav.mailboxes',        label: 'Shared Mailboxes' },
      { key: 'nav.deployment',       label: 'Deployment Tools' },
      { key: 'nav.ringcentral',      label: 'RC Presence' },
    ],
  },
  {
    key: 'action', label: 'Actions', hint: 'Sensitive write operations',
    perms: [
      { key: 'action.port_reset', label: 'Reset Switch Ports' },
      { key: 'action.sites_edit', label: 'Edit Sites & Floor Maps' },
    ],
  },
  {
    key: 'settings', label: 'Settings Tabs', hint: 'Which Settings tabs are accessible',
    perms: [
      { key: 'settings.quick_links',      label: 'Quick Links' },
      { key: 'settings.users',            label: 'Agent Management' },
      { key: 'settings.sites',            label: 'Sites' },
      { key: 'settings.conference_rooms', label: 'Conference Rooms' },
      { key: 'settings.integrations',     label: 'Integrations' },
      { key: 'settings.roles',            label: 'Roles (admin only)' },
    ],
  },
]

function PermissionEditor({ permissions, onChange, disabled }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {PERMISSION_GROUPS.map(group => (
        <div key={group.key}>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
            {group.label}
            <span style={{ fontWeight: 400, marginLeft: 8, textTransform: 'none', letterSpacing: 0, color: 'var(--text-muted)' }}> — {group.hint}</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 20px' }}>
            {group.perms.map(p => (
              <label key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: disabled ? 'default' : 'pointer', fontSize: '0.82rem' }}>
                <input type="checkbox"
                  checked={permissions.includes(p.key)}
                  onChange={() => !disabled && onChange(p.key)}
                  style={{ accentColor: 'var(--cyan)', cursor: disabled ? 'default' : 'pointer' }} />
                {p.label}
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function RolesTab() {
  const [roles,      setRoles]      = useState([])
  const [loading,    setLoading]    = useState(true)
  const [saving,     setSaving]     = useState({})     // roleName → bool
  const [expanded,   setExpanded]   = useState({})     // roleName → bool
  const [edits,      setEdits]      = useState({})     // roleName → permissions[]
  const [creating,   setCreating]   = useState(false)
  const [newRole,    setNewRole]    = useState({ name: '', label: '', description: '', permissions: [] })
  const [createErr,  setCreateErr]  = useState('')
  const [createBusy, setCreateBusy] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const r = await getRoles()
      setRoles(r.data)
      const init = {}
      r.data.forEach(role => { init[role.name] = [...role.permissions] })
      setEdits(init)
    } catch {}
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const togglePerm = (roleName, perm) =>
    setEdits(prev => {
      const cur = prev[roleName] || []
      return { ...prev, [roleName]: cur.includes(perm) ? cur.filter(p => p !== perm) : [...cur, perm] }
    })

  const handleSave = async (roleName) => {
    setSaving(prev => ({ ...prev, [roleName]: true }))
    try {
      await updateRole(roleName, { permissions: edits[roleName] || [] })
      await load()
    } catch {}
    setSaving(prev => ({ ...prev, [roleName]: false }))
  }

  const handleDelete = async (role) => {
    if (!window.confirm(`Delete role "${role.label}"? Users assigned this role will be reset to "user".`)) return
    try { await deleteRole(role.name); await load() } catch {}
  }

  const handleCreate = async () => {
    setCreateErr('')
    const name = newRole.name.trim().toLowerCase().replace(/\s+/g, '_')
    if (!name)             { setCreateErr('Role key is required'); return }
    if (!newRole.label.trim()) { setCreateErr('Display name is required'); return }
    setCreateBusy(true)
    try {
      await createRole({ ...newRole, name })
      setNewRole({ name: '', label: '', description: '', permissions: [] })
      setCreating(false)
      await load()
    } catch (e) {
      setCreateErr(e.response?.data?.detail || 'Failed to create role')
    }
    setCreateBusy(false)
  }

  if (loading) return (
    <div className="flex items-center gap-3" style={{ color: 'var(--text-secondary)' }}>
      <div className="spinner" /><span className="text-sm">Loading roles…</span>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <h3 style={{ margin: '0 0 4px', fontSize: '1rem' }}>Roles & Permissions</h3>
          <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            Define what each role can access. System roles can't be deleted but their permissions can be edited. Click a role to expand it.
          </p>
        </div>
        {!creating && (
          <button className="btn btn-primary" style={{ fontSize: '0.82rem', flexShrink: 0 }} onClick={() => setCreating(true)}>
            + New Role
          </button>
        )}
      </div>

      {/* Create form */}
      {creating && (
        <div className="card" style={{ padding: 20, border: '1px solid var(--cyan)' }}>
          <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: 14, color: 'var(--cyan)' }}>New Role</div>
          {createErr && <div className="alert alert-error" style={{ marginBottom: 12, fontSize: '0.8rem' }}>{createErr}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label style={{ fontSize: '0.75rem' }}>Role Key *</label>
              <input className="input" style={{ fontSize: '0.85rem' }} placeholder="e.g. help_desk_lead"
                value={newRole.name} onChange={e => setNewRole(v => ({ ...v, name: e.target.value }))} />
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 3 }}>Lowercase with underscores — used internally.</div>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label style={{ fontSize: '0.75rem' }}>Display Name *</label>
              <input className="input" style={{ fontSize: '0.85rem' }} placeholder="e.g. Help Desk Lead"
                value={newRole.label} onChange={e => setNewRole(v => ({ ...v, label: e.target.value }))} />
            </div>
            <div className="form-group" style={{ marginBottom: 0, gridColumn: '1 / -1' }}>
              <label style={{ fontSize: '0.75rem' }}>Description</label>
              <input className="input" style={{ fontSize: '0.85rem' }} placeholder="Optional — shown as a hint in user management"
                value={newRole.description} onChange={e => setNewRole(v => ({ ...v, description: e.target.value }))} />
            </div>
          </div>
          <div style={{ marginBottom: 18 }}>
            <PermissionEditor
              permissions={newRole.permissions}
              onChange={perm => setNewRole(v => ({
                ...v, permissions: v.permissions.includes(perm)
                  ? v.permissions.filter(p => p !== perm)
                  : [...v.permissions, perm],
              }))}
              disabled={false}
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" style={{ fontSize: '0.82rem' }} onClick={handleCreate} disabled={createBusy}>
              {createBusy ? 'Creating…' : 'Create Role'}
            </button>
            <button className="btn btn-ghost" style={{ fontSize: '0.82rem' }}
              onClick={() => { setCreating(false); setCreateErr('') }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Role cards */}
      {roles.map(role => {
        const isExpanded = !!expanded[role.name]
        const currentPerms = edits[role.name] || []
        const dirty = JSON.stringify(currentPerms) !== JSON.stringify(role.permissions)
        const isSaving = !!saving[role.name]
        const isAdmin  = role.name === 'admin'

        return (
          <div key={role.name} className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {/* Card header — always visible */}
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: 'pointer', userSelect: 'none' }}
              onClick={() => setExpanded(prev => ({ ...prev, [role.name]: !prev[role.name] }))}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{role.label}</span>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{role.name}</span>
                  {role.is_system && (
                    <span style={{ fontSize: '0.65rem', fontWeight: 700, padding: '2px 6px', borderRadius: 3, background: 'rgba(56,189,248,0.12)', color: 'var(--cyan)', textTransform: 'uppercase', letterSpacing: '0.06em', flexShrink: 0 }}>
                      System
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                  {role.description || `${role.permissions.length} permission${role.permissions.length !== 1 ? 's' : ''} granted`}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                {dirty && !isAdmin && (
                  <button className="btn btn-primary" style={{ fontSize: '0.75rem', padding: '4px 10px' }}
                    disabled={isSaving} onClick={() => handleSave(role.name)}>
                    {isSaving ? '…' : 'Save'}
                  </button>
                )}
                {!role.is_system && (
                  <button className="btn btn-ghost" style={{ fontSize: '0.75rem', padding: '4px 8px', color: '#f85149' }}
                    onClick={() => handleDelete(role)}>
                    Delete
                  </button>
                )}
              </div>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', flexShrink: 0 }}>{isExpanded ? '▲' : '▼'}</span>
            </div>

            {/* Expanded body */}
            {isExpanded && (
              <div style={{ borderTop: '1px solid var(--border)', padding: '16px 16px 20px' }}>
                {isAdmin ? (
                  <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                    The Admin role always has all permissions and cannot be modified.
                  </p>
                ) : (
                  <>
                    <PermissionEditor
                      permissions={currentPerms}
                      onChange={perm => togglePerm(role.name, perm)}
                      disabled={false}
                    />
                    {dirty && (
                      <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
                        <button className="btn btn-primary" style={{ fontSize: '0.8rem' }}
                          disabled={isSaving} onClick={() => handleSave(role.name)}>
                          {isSaving ? 'Saving…' : 'Save Changes'}
                        </button>
                        <button className="btn btn-ghost" style={{ fontSize: '0.8rem' }}
                          onClick={() => setEdits(prev => ({ ...prev, [role.name]: [...role.permissions] }))}>
                          Discard
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/* ── Audit Log page ──────────────────────────────────────────────────────── */

const CATEGORY_OPTIONS = [
  { id: '',                label: 'All Categories' },
  { id: 'auth',            label: 'Authentication' },
  { id: 'user_management', label: 'User Management' },
  { id: 'roles',           label: 'Roles' },
  { id: 'system_settings', label: 'System Settings' },
  { id: 'integrations',    label: 'Integrations' },
]

const ACTION_META = {
  'user.first_login':      { icon: '🔑', color: '#06b6d4' },
  'user.invited':          { icon: '✉️', color: '#8b5cf6' },
  'user.deleted':          { icon: '🗑️', color: '#ef4444' },
  'user.invite_rescinded': { icon: '✂️', color: '#f97316' },
  'user.role_changed':     { icon: '🔄', color: '#f59e0b' },
  'user.profile_updated':  { icon: '✏️', color: '#06b6d4' },
  'user.password_set':     { icon: '🔒', color: '#8b5cf6' },
  'user.rc_access_changed':{ icon: '📞', color: '#06b6d4' },
  'role.created':          { icon: '➕', color: '#22c55e' },
  'role.updated':          { icon: '✏️', color: '#f59e0b' },
  'role.deleted':          { icon: '🗑️', color: '#ef4444' },
  'branding.logo_uploaded':   { icon: '🖼️', color: '#06b6d4' },
  'branding.logo_deleted':    { icon: '🗑️', color: '#ef4444' },
  'branding.favicon_uploaded':{ icon: '🖼️', color: '#06b6d4' },
  'branding.favicon_deleted': { icon: '🗑️', color: '#ef4444' },
  'branding.icon_uploaded':   { icon: '🖼️', color: '#06b6d4' },
  'branding.icon_deleted':    { icon: '🗑️', color: '#ef4444' },
}

function actionLabel(action) {
  const map = {
    'user.first_login':       'First Login',
    'user.invited':           'User Invited',
    'user.deleted':           'User Deleted',
    'user.invite_rescinded':  'Invite Rescinded',
    'user.role_changed':      'Role Changed',
    'user.profile_updated':   'Profile Updated',
    'user.password_set':      'Password Set',
    'user.rc_access_changed': 'RC Access Changed',
    'role.created':           'Role Created',
    'role.updated':           'Role Updated',
    'role.deleted':           'Role Deleted',
    'branding.logo_uploaded':    'Logo Uploaded',
    'branding.logo_deleted':     'Logo Deleted',
    'branding.favicon_uploaded': 'Favicon Uploaded',
    'branding.favicon_deleted':  'Favicon Deleted',
    'branding.icon_uploaded':    'Icon Uploaded',
    'branding.icon_deleted':     'Icon Deleted',
  }
  return map[action] || action
}

function fmtTs(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

function AuditLogPage() {
  const [logs,     setLogs]     = useState([])
  const [loading,  setLoading]  = useState(true)
  const [search,   setSearch]   = useState('')
  const [category, setCategory] = useState('')
  const [offset,   setOffset]   = useState(0)
  const [hasMore,  setHasMore]  = useState(false)
  const LIMIT = 50

  const load = async (newOffset = 0, reset = false) => {
    setLoading(true)
    try {
      const params = { limit: LIMIT, offset: newOffset }
      if (category) params.category = category
      if (search.trim()) params.search = search.trim()
      const r = await api.get('/api/audit-logs/', { params })
      const rows = r.data
      setLogs(prev => reset ? rows : [...prev, ...rows])
      setOffset(newOffset + rows.length)
      setHasMore(rows.length === LIMIT)
    } catch { /* swallow */ }
    finally { setLoading(false) }
  }

  useEffect(() => { load(0, true) }, [category])

  const handleSearch = (e) => {
    e.preventDefault()
    load(0, true)
  }

  return (
    <div style={{ maxWidth: 900 }}>
      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8, flex: 1, minWidth: 220 }}>
          <input
            className="input"
            placeholder="Search actor, target, detail…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ flex: 1, padding: '7px 12px', fontSize: '0.84rem' }}
          />
          <button type="submit" className="btn btn-ghost" style={{ fontSize: '0.83rem', padding: '7px 14px' }}>
            Search
          </button>
        </form>
        <select
          className="select"
          value={category}
          onChange={e => { setCategory(e.target.value) }}
          style={{ padding: '7px 12px', fontSize: '0.84rem', minWidth: 170 }}
        >
          {CATEGORY_OPTIONS.map(o => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Log entries */}
      {loading && logs.length === 0 ? (
        <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
          <div className="spinner" style={{ margin: '0 auto 12px' }} />
          Loading audit log…
        </div>
      ) : logs.length === 0 ? (
        <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
          No audit events found.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {logs.map(log => {
            const meta = ACTION_META[log.action] || { icon: '📋', color: 'var(--text-muted)' }
            return (
              <div key={log.id} style={{
                display: 'grid', gridTemplateColumns: '32px 1fr auto',
                gap: 12, alignItems: 'start',
                padding: '12px 14px', borderRadius: 8,
                background: 'var(--bg-surface)', border: '1px solid var(--border)',
              }}>
                {/* Icon */}
                <div style={{
                  width: 32, height: 32, borderRadius: '50%',
                  background: meta.color + '18', border: `1px solid ${meta.color}33`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 15, flexShrink: 0,
                }}>
                  {meta.icon}
                </div>

                {/* Body */}
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 2 }}>
                    <span style={{
                      fontSize: '0.72rem', fontWeight: 700, color: meta.color,
                      background: meta.color + '14', padding: '1px 7px', borderRadius: 4,
                      border: `1px solid ${meta.color}30`, textTransform: 'uppercase', letterSpacing: '0.04em',
                    }}>
                      {actionLabel(log.action)}
                    </span>
                    {log.target_label && (
                      <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {log.target_label}
                      </span>
                    )}
                  </div>
                  {log.detail && (
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                      {log.detail}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 12, marginTop: 4, flexWrap: 'wrap' }}>
                    {log.actor_email && (
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        by {log.actor_name || log.actor_email}
                      </span>
                    )}
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'capitalize' }}>
                      {log.category?.replace('_', ' ')}
                    </span>
                  </div>
                </div>

                {/* Timestamp */}
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', textAlign: 'right', paddingTop: 2 }}>
                  {fmtTs(log.timestamp)}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Load more */}
      {hasMore && !loading && (
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={() => load(offset)} style={{ fontSize: '0.83rem' }}>
            Load more
          </button>
        </div>
      )}
      {loading && logs.length > 0 && (
        <div style={{ textAlign: 'center', marginTop: 16, color: 'var(--text-muted)', fontSize: '0.82rem' }}>
          Loading…
        </div>
      )}
    </div>
  )
}

/* ── Coming Soon placeholder ─────────────────────────────────────────────── */

function ComingSoon({ label }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300, color: 'var(--text-muted)', gap: 12 }}>
      <div style={{ fontSize: 36 }}>🚧</div>
      <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>Coming Soon</div>
      <div style={{ fontSize: '0.83rem', textAlign: 'center', maxWidth: 340, lineHeight: 1.6 }}>
        {label ? <><strong>{label}</strong> is</> : 'This feature is'} on the roadmap and will be available in a future update.
      </div>
    </div>
  )
}

/* ── Authentication panel ────────────────────────────────────────────────── */

function AuthenticationPanel({ config }) {
  return (
    <div>
      <div className="alert alert-info" style={{ marginBottom: 20, fontSize: '0.82rem' }}>
        ℹ️ Access is managed entirely in <strong>Microsoft Entra ID</strong>. Assign users or groups in the Azure Portal to grant or revoke access.
      </div>
      {config ? (
        <>
          <InfoRow label="Tenant ID"    value={config.tenantId}        mono />
          <InfoRow label="Client ID"    value={config.clientId}        mono />
          <InfoRow label="Redirect URI" value={window.location.origin} mono />
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
  )
}

/* ── Integrations panel (system + client sub-tabs) ───────────────────────── */

function IntegrationsPanel() {
  const [sub, setSub] = useState('system')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 20, flexShrink: 0 }}>
        {[{ id: 'system', label: 'System Integrations' }, { id: 'client', label: 'Client Integrations' }].map(s => (
          <button key={s.id} onClick={() => setSub(s.id)} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            padding: '10px 16px', fontSize: '0.85rem',
            fontWeight: sub === s.id ? 600 : 400, fontFamily: 'var(--font-sans)',
            color: sub === s.id ? 'var(--cyan)' : 'var(--text-secondary)',
            borderBottom: `2px solid ${sub === s.id ? 'var(--cyan)' : 'transparent'}`,
            marginBottom: -1, transition: 'all 0.15s',
          }}>{s.label}</button>
        ))}
      </div>
      {sub === 'system' ? <IntegrationsTab /> : <ClientIntegrationsTab />}
    </div>
  )
}

/* ── Nav structure definition ────────────────────────────────────────────── */

const NAV_STRUCTURE = [
  {
    section: 'Account Settings',
    items: [
      { id: 'account',             label: 'Account' },
      { id: 'authentication',      label: 'Authentication' },
      { id: 'plans_billing',       label: 'Plans & Billing',      soon: true },
      { id: 'service_desk',        label: 'Service Desk Settings' },
      { id: 'audit_log',           label: 'Audit Log' },
      { id: 'email_notifications', label: 'Email Notifications',  admin: true },
      { id: 'data_archival',       label: 'Data Archival',        soon: true },
      { id: 'clients',             label: 'Clients',              admin: true },
      { id: 'integrations',        label: 'Integrations',         perm: 'settings.integrations' },
    ],
  },
  {
    section: 'User Management',
    items: [
      { id: 'agents',           label: 'Agents',            perm: 'settings.users' },
      { id: 'roles',            label: 'Roles',             perm: 'settings.roles' },
      { id: 'departments',      label: 'Departments',       soon: true },
      { id: 'dept_fields',      label: 'Department Fields', soon: true },
      { id: 'requestors',       label: 'Requestors',        soon: true },
      { id: 'user_fields',      label: 'User Fields',       soon: true },
      { id: 'cab',              label: 'CAB',               soon: true },
      { id: 'requester_groups', label: 'Requester Groups',  soon: true },
      { id: 'work_schedule',    label: 'Work Schedule',     soon: true },
    ],
  },
  {
    section: 'Channels',
    items: [
      { id: 'ch_teams',   label: 'Servicebot for Microsoft Teams', soon: true },
      { id: 'ch_slack',   label: 'Servicebot for Slack',           soon: true },
      { id: 'ch_discord', label: 'Servicebot for Discord',         soon: true },
    ],
  },
  {
    section: 'Service Management',
    items: [
      { id: 'sm_g1',           type: 'group', label: 'Service Desk' },
      { id: 'business_hours',  label: 'Business Hours',            soon: true },
      { id: 'sla_ola',         label: 'SLA and OLA Policies',      soon: true },
      { id: 'field_manager',   label: 'Field Manager',             soon: true },
      { id: 'business_rules',  label: 'Business Rules for Forms',  soon: true },
      { id: 'surveys',         label: 'Surveys',                   soon: true },
      { id: 'sm_g2',           type: 'group', label: 'Service Request Management' },
      { id: 'service_catalog', label: 'Service Catalog',           soon: true },
      { id: 'emp_onboarding',  label: 'Employee Onboarding',       soon: true },
      { id: 'emp_offboarding', label: 'Employee Offboarding',      soon: true },
      { id: 'journeys',        label: 'Journeys',                  soon: true },
    ],
  },
  {
    section: 'Automation & Productivity',
    items: [
      { id: 'supervisor_rules', label: 'Supervisor Rules', soon: true },
      { id: 'leaderboard',      label: 'Leaderboard',      soon: true },
      { id: 'email_commands',   label: 'Email Commands',   soon: true },
      { id: 'collaborate',      label: 'Collaborate',      soon: true },
      { id: 'quick_links',      label: 'Quick Links',      perm: 'settings.quick_links' },
    ],
  },
  {
    section: 'Asset Management',
    items: [
      { id: 'asset_types',        label: 'Asset Types & Fields',   soon: true },
      { id: 'discovery_hub',      label: 'Discovery Hub',          soon: true },
      { id: 'product_catalog',    label: 'Product Catalog',        soon: true },
      { id: 'vendors',            label: 'Vendors',                soon: true },
      { id: 'vendor_fields',      label: 'Vendor Fields',          soon: true },
      { id: 'software_fields',    label: 'Software Fields',        soon: true },
      { id: 'contract_types',     label: 'Contract Types',         soon: true },
      { id: 'po_fields',          label: 'Purchase Order Fields',  soon: true },
      { id: 'asset_locations',    label: 'Locations',              soon: true },
      { id: 'asset_depreciation', label: 'Asset Depreciation',     soon: true },
    ],
  },
  {
    section: 'Project & Workload Management',
    items: [
      { id: 'project_fields',   label: 'Project Fields',        soon: true },
      { id: 'project_collab',   label: 'Project Collaboration', soon: true },
      { id: 'workload_manager', label: 'Workload Manager',      soon: true },
    ],
  },
  {
    section: 'Facility Management',
    items: [
      { id: 'sites',            label: 'Sites',            perm: 'settings.sites' },
      { id: 'conference_rooms', label: 'Conference Rooms', perm: 'settings.conference_rooms' },
    ],
  },
]

/* ── Main Settings page ──────────────────────────────────────────────────── */

export default function Settings({ theme, setTheme }) {
  const { isAdmin, hasPermission } = useContext(UserContext)
  const [activeId, setActiveId] = useState('account')
  const [config,   setConfig]   = useState(null)

  useEffect(() => {
    api.get('/api/settings/config').then(r => setConfig(r.data)).catch(() => {})
  }, [])

  const isVisible = (item) => {
    if (item.type === 'group') return true
    if (item.admin && !isAdmin) return false
    if (item.perm && !hasPermission(item.perm)) return false
    return true
  }

  const allItems = NAV_STRUCTURE.flatMap(s => s.items)
  const activeItem    = allItems.find(i => i.id === activeId)
  const activeSection = NAV_STRUCTURE.find(s => s.items.some(i => i.id === activeId))

  const renderContent = () => {
    switch (activeId) {
      case 'audit_log':           return <AuditLogPage />
      case 'account':             return <GeneralTab config={config} isAdmin={isAdmin} />
      case 'authentication':      return <AuthenticationPanel config={config} />
      case 'service_desk':        return <TicketSettings />
      case 'email_notifications': return isAdmin ? <NotificationSettings /> : <ComingSoon label="Email Notifications" />
      case 'clients':             return isAdmin ? <ClientsWorkspace /> : null
      case 'integrations':        return hasPermission('settings.integrations') ? <IntegrationsPanel /> : null
      case 'agents':              return hasPermission('settings.users')        ? <UsersTab />         : null
      case 'roles':               return hasPermission('settings.roles')        ? <RolesTab />         : null
      case 'quick_links':         return hasPermission('settings.quick_links')  ? <QuickLinksTab />    : null
      case 'sites':               return hasPermission('settings.sites')        ? <SitesTab />         : null
      case 'conference_rooms':    return hasPermission('settings.conference_rooms') ? <ConferenceRoomsTab /> : null
      default:                    return <ComingSoon label={activeItem?.label} />
    }
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* Left sidebar nav */}
      <div style={{
        width: 240, flexShrink: 0, borderRight: '1px solid var(--border)',
        overflowY: 'auto', padding: '12px 0 24px', background: 'var(--bg-base)',
      }}>
        {NAV_STRUCTURE.map(({ section, items }) => {
          const visible = items.filter(isVisible)
          if (!visible.some(i => i.type !== 'group')) return null
          return (
            <div key={section} style={{ marginBottom: 6 }}>
              <div style={{
                padding: '10px 16px 4px',
                fontSize: '0.63rem', fontWeight: 700, color: 'var(--text-muted)',
                textTransform: 'uppercase', letterSpacing: '0.1em',
              }}>
                {section}
              </div>
              {visible.map(item => {
                if (item.type === 'group') {
                  return (
                    <div key={item.id} style={{
                      padding: '8px 16px 3px 22px',
                      fontSize: '0.61rem', fontWeight: 700, color: 'var(--text-muted)',
                      textTransform: 'uppercase', letterSpacing: '0.07em', opacity: 0.6,
                    }}>
                      {item.label}
                    </div>
                  )
                }
                const isActive = activeId === item.id
                return (
                  <button key={item.id} onClick={() => setActiveId(item.id)} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    width: '100%', padding: '6px 12px 6px 22px',
                    background: isActive ? 'rgba(6,182,212,0.08)' : 'transparent',
                    border: 'none', borderLeft: `2px solid ${isActive ? 'var(--cyan)' : 'transparent'}`,
                    cursor: 'pointer', textAlign: 'left',
                    color: isActive ? 'var(--cyan)' : 'var(--text-secondary)',
                    fontSize: '0.84rem', fontWeight: isActive ? 600 : 400,
                    fontFamily: 'var(--font-sans)', transition: 'all 0.12s',
                  }}>
                    <span>{item.label}</span>
                    {item.soon && (
                      <span style={{
                        fontSize: '0.6rem', fontWeight: 600, color: 'var(--text-muted)',
                        background: 'var(--bg-elevated)', padding: '1px 5px', borderRadius: 3,
                        border: '1px solid var(--border)', flexShrink: 0, marginLeft: 4,
                      }}>
                        Soon
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>

      {/* Content area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Page header breadcrumb */}
        <div style={{
          padding: '14px 28px 13px', borderBottom: '1px solid var(--border)',
          flexShrink: 0, background: 'var(--bg-base)',
        }}>
          {activeSection && (
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600 }}>
              {activeSection.section}
            </div>
          )}
          <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            {activeItem?.label ?? 'Settings'}
          </div>
        </div>

        {/* Panel content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: activeId === 'clients' ? 0 : 28 }}>
          {renderContent()}
        </div>
      </div>
    </div>
  )
}
