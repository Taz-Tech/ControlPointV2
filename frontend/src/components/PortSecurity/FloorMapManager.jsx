import { useState, useEffect, useRef } from 'react'
import { getMaps, getMap, deleteMap, getSwitches, addSeat, updateSeat, deleteSeat, updateMapRotation, importSeats, getZones, createZone, updateZone, deleteZone, getAssignments, upsertAssignment, deleteAssignment } from '../../api/client.js'
import { Document, Page, pdfjs } from 'react-pdf'
import * as xlsx from 'xlsx'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

const ZONE_COLORS = [
  '#3b82f6', // blue
  '#22c55e', // green
  '#f97316', // orange
  '#a855f7', // purple
  '#ef4444', // red
  '#06b6d4', // cyan
  '#eab308', // yellow
  '#ec4899', // pink
]

// ── Seat Pin on Map ───────────────────────────────────────────────────────────
function SeatPin({ seat, selected, onClick, onPointerDown, assigned }) {
  const colors = { mapped: 'var(--cyan)', selected: 'var(--orange)', assigned: '#22c55e' }
  const color = selected ? colors.selected : assigned ? colors.assigned : colors.mapped
  return (
    <div
      className={`seat-pin${selected ? ' selected' : ''}`}
      style={{ left: `${seat.x_pct}%`, top: `${seat.y_pct}%`, color, zIndex: 10 }}
      onPointerDown={(e) => onPointerDown && onPointerDown(e, seat)}
      title={`${seat.seat_label} → ${seat.switch_name || 'unassigned'} ${seat.port}${assigned ? ` · ${assigned.user_display_name || assigned.user_email}` : ''}`}
    >
      {selected && <div className="pin-label">{seat.seat_label}</div>}
      <div className="pin-circle" style={{ background: color }}>{seat.seat_label.slice(0, 2)}</div>
      <div className="pin-tail" />
    </div>
  )
}

// ── Add/Edit Seat Form ────────────────────────────────────────────────────────
function SeatForm({ switches, onSave, onCancel, initial }) {
  const [form, setForm] = useState(initial || { seat_label: '', port: '', switch_id: '' })
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))
  return (
    <div className="card" style={{ border: '1px solid var(--cyan)', boxShadow: 'var(--cyan-glow)' }}>
      <div className="card-header">
        <h4>{initial ? 'Edit Seat Pin' : 'New Seat Pin'}</h4>
      </div>
      <div className="card-body">
        <div className="form-row">
          <div className="form-group">
            <label>Seat Label</label>
            <input id="seat-label" className="input" value={form.seat_label} onChange={set('seat_label')} placeholder="A1, Desk-05…" />
          </div>
          <div className="form-group">
            <label>Port</label>
            <input id="seat-port" className="input" value={form.port} onChange={set('port')} placeholder="GigabitEthernet1/0/5" />
          </div>
        </div>
        <div className="form-group">
          <label>Switch</label>
          <select id="seat-switch" className="select" value={form.switch_id} onChange={set('switch_id')}>
            <option value="">— Select switch —</option>
            {switches.map(sw => (
              <option key={sw.id} value={sw.id}>{sw.name} ({sw.ip_address})</option>
            ))}
          </select>
        </div>
        <div className="flex gap-3" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button id="seat-save-btn" className="btn btn-primary" onClick={() => onSave(form)} disabled={!form.seat_label || !form.port || !form.switch_id}>
            {initial ? 'Update Pin' : 'Place Pin'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Zone Config Form ──────────────────────────────────────────────────────────
function ZoneConfigForm({ onSave, onCancel, initial }) {
  const [name, setName]         = useState(initial?.name || '')
  const [teamName, setTeamName] = useState(initial?.team_name || '')
  const [color, setColor]       = useState(initial?.color || ZONE_COLORS[0])

  return (
    <div className="card" style={{ border: `1px solid ${color}`, boxShadow: `0 0 8px ${color}40` }}>
      <div className="card-header">
        <h4>{initial ? 'Edit Zone' : 'New Zone'}</h4>
      </div>
      <div className="card-body">
        <div className="form-row">
          <div className="form-group">
            <label>Zone Name</label>
            <input
              className="input"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Zone A, Engineering, Sales…"
              autoFocus
            />
          </div>
          <div className="form-group">
            <label>Team</label>
            <input
              className="input"
              value={teamName}
              onChange={e => setTeamName(e.target.value)}
              placeholder="Engineering, IT, HR…"
            />
          </div>
        </div>
        <div className="form-group">
          <label>Color</label>
          <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
            {ZONE_COLORS.map(c => (
              <button
                key={c}
                onClick={() => setColor(c)}
                style={{
                  width: 26, height: 26, borderRadius: '50%',
                  background: c, border: 'none', cursor: 'pointer',
                  outline: color === c ? `3px solid ${c}` : '2px solid transparent',
                  outlineOffset: 2,
                }}
                title={c}
              />
            ))}
          </div>
        </div>
        <div className="flex gap-3" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button
            className="btn btn-primary"
            style={{ background: color, borderColor: color }}
            onClick={() => onSave({ name: name.trim(), team_name: teamName.trim(), color })}
            disabled={!name.trim()}
          >
            {initial ? 'Update Zone' : 'Create Zone'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Seat Assignment Card ──────────────────────────────────────────────────────
function SeatAssignCard({ seat, assignment, color, onAssign, onUnassign }) {
  const [editing, setEditing] = useState(false)
  const [name, setName]       = useState('')
  const [email, setEmail]     = useState('')

  const handleSave = () => {
    if (!name.trim() && !email.trim()) return
    onAssign({ user_display_name: name.trim() || null, user_email: email.trim() || null, user_id: null })
    setEditing(false)
    setName('')
    setEmail('')
  }

  const handleEdit = () => {
    setName(assignment?.user_display_name || '')
    setEmail(assignment?.user_email || '')
    setEditing(true)
  }

  return (
    <div style={{
      border: `1px solid ${color}30`,
      borderRadius: 6,
      padding: '8px 10px',
      background: 'var(--bg-elevated)',
    }}>
      <div style={{ fontWeight: 600, fontSize: '0.8rem', marginBottom: 5, color: 'var(--text-primary)' }}>
        📍 {seat.seat_label}
        {seat.port && <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: '0.7rem', marginLeft: 4 }}>{seat.port}</span>}
      </div>
      {editing ? (
        <div>
          <input
            className="input"
            style={{ fontSize: '0.75rem', padding: '4px 6px', marginBottom: 4 }}
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Employee name"
          />
          <input
            className="input"
            style={{ fontSize: '0.75rem', padding: '4px 6px', marginBottom: 6 }}
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="Email (optional)"
          />
          <div className="flex gap-1">
            <button className="btn btn-primary" style={{ fontSize: '0.7rem', padding: '3px 10px' }} onClick={handleSave} disabled={!name.trim() && !email.trim()}>
              Save
            </button>
            <button className="btn btn-ghost" style={{ fontSize: '0.7rem', padding: '3px 8px' }} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : assignment ? (
        <div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-primary)' }}>
            {assignment.user_display_name || assignment.user_email || 'Assigned'}
          </div>
          {assignment.user_email && assignment.user_display_name && (
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{assignment.user_email}</div>
          )}
          <div className="flex gap-1" style={{ marginTop: 5 }}>
            <button className="btn btn-ghost" style={{ fontSize: '0.68rem', padding: '2px 7px' }} onClick={handleEdit}>
              ✏️ Edit
            </button>
            <button className="btn btn-danger" style={{ fontSize: '0.68rem', padding: '2px 7px' }} onClick={onUnassign}>
              Remove
            </button>
          </div>
        </div>
      ) : (
        <button
          className="btn btn-ghost"
          style={{ fontSize: '0.72rem', padding: '3px 8px', borderColor: `${color}60`, color: color }}
          onClick={() => setEditing(true)}
        >
          + Assign Employee
        </button>
      )}
    </div>
  )
}

// ── Zone Detail Panel ─────────────────────────────────────────────────────────
function ZoneDetailPanel({ zone, seats, assignments, onAssign, onUnassign, onEdit, onDelete, onClose }) {
  const x1 = Math.min(zone.x1_pct, zone.x2_pct)
  const x2 = Math.max(zone.x1_pct, zone.x2_pct)
  const y1 = Math.min(zone.y1_pct, zone.y2_pct)
  const y2 = Math.max(zone.y1_pct, zone.y2_pct)
  const zoneSeats = seats.filter(s => s.x_pct >= x1 && s.x_pct <= x2 && s.y_pct >= y1 && s.y_pct <= y2)
  const assignedCount = zoneSeats.filter(s => assignments[s.id]).length

  return (
    <div className="card" style={{ border: `1px solid ${zone.color}`, boxShadow: `0 0 10px ${zone.color}30` }}>
      <div className="card-header" style={{ justifyContent: 'space-between' }}>
        <div>
          <h4 style={{ color: zone.color, marginBottom: 0 }}>{zone.name}</h4>
          {zone.team_name && <span className="text-sm text-muted">{zone.team_name}</span>}
        </div>
        <div className="flex gap-2" style={{ alignItems: 'center' }}>
          <span className="badge badge-gray">{assignedCount}/{zoneSeats.length} seats filled</span>
          <button className="btn btn-ghost" style={{ fontSize: '0.75rem', padding: '3px 8px' }} onClick={onEdit}>✏️ Edit</button>
          <button className="btn btn-danger" style={{ fontSize: '0.75rem', padding: '3px 8px' }} onClick={onDelete}>🗑️ Delete</button>
          <button className="btn btn-ghost" style={{ fontSize: '0.75rem', padding: '3px 8px' }} onClick={onClose}>✕</button>
        </div>
      </div>
      <div className="card-body">
        {zoneSeats.length === 0 ? (
          <p className="text-sm text-muted">No seat pins are inside this zone yet. Place pins on the map to assign employees.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
            {zoneSeats.map(seat => (
              <SeatAssignCard
                key={seat.id}
                seat={seat}
                assignment={assignments[seat.id]}
                color={zone.color}
                onAssign={data => onAssign(seat.id, data)}
                onUnassign={() => onUnassign(seat.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Zone SVG Overlay ──────────────────────────────────────────────────────────
function ZoneOverlay({ zones, selectedZoneId, drawingZone, zoneMode }) {
  return (
    <svg
      style={{
        position: 'absolute', top: 0, left: 0,
        width: '100%', height: '100%',
        overflow: 'visible', zIndex: 5,
        pointerEvents: 'none',
      }}
    >
      {zones.map(zone => {
        const x = Math.min(zone.x1_pct, zone.x2_pct)
        const y = Math.min(zone.y1_pct, zone.y2_pct)
        const w = Math.abs(zone.x2_pct - zone.x1_pct)
        const h = Math.abs(zone.y2_pct - zone.y1_pct)
        const selected = zone.id === selectedZoneId
        return (
          <g key={zone.id}>
            <rect
              x={`${x}%`} y={`${y}%`}
              width={`${w}%`} height={`${h}%`}
              fill={zone.color}
              fillOpacity={selected ? 0.28 : 0.12}
              stroke={zone.color}
              strokeWidth={selected ? 2.5 : 1.5}
              strokeDasharray={selected ? undefined : '7,4'}
              rx="4"
            />
            <text
              x={`${x + w * 0.5}%`}
              y={`${y + h * 0.5}%`}
              textAnchor="middle"
              dominantBaseline="central"
              style={{ pointerEvents: 'none', userSelect: 'none' }}
            >
              <tspan
                x={`${x + w * 0.5}%`}
                dy={zone.team_name ? '-0.65em' : '0'}
                fill={zone.color}
                fontSize="13"
                fontWeight="700"
                style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.9))' }}
              >
                {zone.name}
              </tspan>
              {zone.team_name && (
                <tspan
                  x={`${x + w * 0.5}%`}
                  dy="1.4em"
                  fill={zone.color}
                  fontSize="11"
                  opacity="0.8"
                  style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.9))' }}
                >
                  {zone.team_name}
                </tspan>
              )}
            </text>
          </g>
        )
      })}

      {/* Live rectangle while drawing */}
      {drawingZone && (
        <rect
          x={`${Math.min(drawingZone.x1_pct, drawingZone.x2_pct)}%`}
          y={`${Math.min(drawingZone.y1_pct, drawingZone.y2_pct)}%`}
          width={`${Math.abs(drawingZone.x2_pct - drawingZone.x1_pct)}%`}
          height={`${Math.abs(drawingZone.y2_pct - drawingZone.y1_pct)}%`}
          fill="rgba(59,130,246,0.12)"
          stroke="#3b82f6"
          strokeWidth="2"
          strokeDasharray="8,4"
          rx="4"
        />
      )}
    </svg>
  )
}

// ── Main FloorMapManager ──────────────────────────────────────────────────────
export default function FloorMapManager({ switches, onSwitchesChange, currentMap, onMapChange, onSeatSelect, selectedSeat, siteMapIds, siteActive, readOnly = false, hideSelector = false, fullScreen = false }) {
  const [maps, setMaps]             = useState([])
  const [pendingPin, setPendingPin] = useState(null)
  const [editingSeat, setEditingSeat] = useState(null)
  const [error, setError]           = useState(null)
  const [rotation, setRotation]     = useState(currentMap?.rotation ?? 0)

  // Transform and Dragging State
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 })
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState({ x: 0, y: 0 })
  const [draggingPin, setDraggingPin] = useState(null)
  const [hasDraggedMap, setHasDraggedMap] = useState(false)

  // Excel Import State
  const [unplacedPins, setUnplacedPins] = useState([])
  const [draggedUnplacedPin, setDraggedUnplacedPin] = useState(null)
  const [importResult, setImportResult] = useState(null)

  // Zone State
  const [zones, setZones]               = useState([])
  const [assignments, setAssignments]   = useState({})  // seat_id → assignment
  const [zoneMode, setZoneMode]         = useState(false)
  const [drawingZone, setDrawingZone]   = useState(null)
  const [pendingZoneRect, setPendingZoneRect] = useState(null)  // rect coords waiting for ZoneConfigForm
  const [selectedZone, setSelectedZone] = useState(null)
  const [editingZone, setEditingZone]   = useState(null)
  const zoneDrawStart = useRef(null)

  const wrapperRef  = useRef(null)
  const contentRef  = useRef(null)
  const rotateRef   = useRef(null)
  const excelRef    = useRef(null)
  const draggingPinRef = useRef(null)

  // Sync rotation when map changes
  useEffect(() => {
    setRotation(currentMap?.rotation ?? 0)
    setTransform({ x: 0, y: 0, scale: 1 })
  }, [currentMap?.id])

  // Load zones and assignments when map changes
  useEffect(() => {
    if (!currentMap?.id) { setZones([]); setAssignments({}); return }
    getZones(currentMap.id)
      .then(r => setZones(r.data))
      .catch(() => {})
    getAssignments(currentMap.id)
      .then(r => {
        const map = {}
        r.data.forEach(a => { map[a.seat_id] = a })
        setAssignments(map)
      })
      .catch(() => {})
  }, [currentMap?.id])

  const refreshZones = async () => {
    if (!currentMap?.id) return
    try {
      const r = await getZones(currentMap.id)
      setZones(r.data)
    } catch(e) {}
  }

  const refreshAssignments = async () => {
    if (!currentMap?.id) return
    try {
      const r = await getAssignments(currentMap.id)
      const map = {}
      r.data.forEach(a => { map[a.seat_id] = a })
      setAssignments(map)
    } catch(e) {}
  }

  const fitToPage = () => {
    if (!wrapperRef.current || !rotateRef.current) return
    const wW = wrapperRef.current.clientWidth
    const wH = wrapperRef.current.clientHeight
    const cW = rotateRef.current.offsetWidth
    const cH = rotateRef.current.offsetHeight
    if (!cW || !cH || !wW || !wH) return
    const scale = Math.min(wW / cW, wH / cH) * 0.95
    const x = (wW - cW * scale) / 2
    const y = (wH - cH * scale) / 2
    setTransform({ x, y, scale })
  }

  const refreshSwitches = async () => {
    try { const res = await getSwitches(); onSwitchesChange(res.data) } catch(e) {}
  }

  const refreshMaps = async () => {
    try {
      const res = await getMaps()
      setMaps(res.data)
    } catch(e) { setError('Could not load floor maps.') }
  }

  useEffect(() => {
    refreshMaps()
    refreshSwitches()
  }, [])

  // ── Coordinate conversion ──────────────────────────────────────────────────
  const screenToMap = (clientX, clientY) => {
    const wRect = wrapperRef.current.getBoundingClientRect()
    const lx = (clientX - wRect.left - transform.x) / transform.scale
    const ly = (clientY - wRect.top  - transform.y) / transform.scale

    const w = rotateRef.current.offsetWidth
    const h = rotateRef.current.offsetHeight

    if (rotation === 0) {
      return {
        x_pct: Math.max(0, Math.min(100, (lx / w) * 100)),
        y_pct: Math.max(0, Math.min(100, (ly / h) * 100)),
      }
    }

    const cx = w / 2, cy = h / 2
    const dx = lx - cx, dy = ly - cy
    const θ  = -rotation * Math.PI / 180
    const cos = Math.cos(θ), sin = Math.sin(θ)
    return {
      x_pct: Math.max(0, Math.min(100, ((dx * cos - dy * sin + cx) / w) * 100)),
      y_pct: Math.max(0, Math.min(100, ((dx * sin + dy * cos + cy) / h) * 100)),
    }
  }

  // ── Rotation ───────────────────────────────────────────────────────────────
  const handleRotate = async (dir) => {
    if (!currentMap) return
    const newRotation = ((rotation + (dir === 'cw' ? 90 : -90)) + 360) % 360
    setRotation(newRotation)
    setTransform({ x: 0, y: 0, scale: 1 })
    try {
      await updateMapRotation(currentMap.id, newRotation)
      onMapChange({ ...currentMap, rotation: newRotation })
    } catch(e) {
      setError('Failed to save rotation')
    }
  }

  // ── Excel Import ───────────────────────────────────────────────────────────
  const handleDownloadTemplate = () => {
    const ws = xlsx.utils.aoa_to_sheet([
      ['Seat Label', 'Port', 'Switch'],
      ['A1', 'GigabitEthernet1/0/1', 'SW-Floor1'],
      ['A2', 'GigabitEthernet1/0/2', '192.168.1.1'],
    ])
    const wb = xlsx.utils.book_new()
    xlsx.utils.book_append_sheet(wb, ws, 'Seats')
    xlsx.writeFile(wb, 'seat-import-template.xlsx')
  }

  const _processImportRows = async (rows) => {
    if (!rows.length) return
    if (!currentMap) {
      setUnplacedPins(prev => [...prev, ...rows])
      return
    }
    try {
      const payload = rows.map(({ seat_label, port, switch_name }) => ({ seat_label, port, switch_name }))
      const res = await importSeats(currentMap.id, payload)
      const { updated, unmatched } = res.data
      if (updated.length > 0) {
        const mapRes = await getMap(currentMap.id)
        onMapChange(mapRes.data)
      }
      if (unmatched.length > 0) {
        const ts = Date.now()
        setUnplacedPins(prev => [
          ...prev,
          ...unmatched.map((r, i) => ({ ...r, id: `unplaced-${i}-${ts}` })),
        ])
      }
      setImportResult({ updated: updated.length, unmatched: unmatched.length })
    } catch (err) {
      setError(err.response?.data?.detail || 'Import failed')
    }
  }

  const handleExcelUpload = (e) => {
    const file = e.target.files[0]
    if (!file) return
    e.target.value = ''

    const looksLikeSwitch = v => /\d+\.\d+\.\d+\.\d+/.test(v) || / - /.test(v)
    const looksLikePort   = v => /^(gi|te|fa|eth|gigabit|tengig|fastethernet|tenGigabit)/i.test(v)

    const reader = new FileReader()
    reader.onload = (evt) => {
      const wb   = xlsx.read(evt.target.result, { type: 'binary' })
      const ws   = wb.Sheets[wb.SheetNames[0]]
      const data = xlsx.utils.sheet_to_json(ws, { defval: '' })
      const rows = data.map((row, i) => {
        const r = Object.fromEntries(Object.entries(row).map(([k, v]) => [k.toLowerCase().trim(), String(v ?? '').trim()]))

        const seat_label =
          r['seat label'] || r['seat'] || r['label'] || r['name'] ||
          r['location']   || r['desk'] || r['workstation'] || r['station'] ||
          r['room']       || r['endpoint'] || r['node'] || r['asset'] ||
          r['pc name']    || r['computer'] || r['device name'] || ''

        const colA =
          r['port']       || r['interface']       || r['port number']   ||
          r['jack']       || r['interface name']  || r['network port']  ||
          r['connection'] || r['port id']         || ''

        const colB =
          r['switch']         || r['switch name']   || r['switch ip']    ||
          r['device']         || r['network device']|| r['hostname']     ||
          r['switch address'] || r['switch id']     || r['appliance']    || ''

        let port, switch_name
        if      (looksLikeSwitch(colA) && !looksLikeSwitch(colB)) { switch_name = colA; port = colB }
        else if (looksLikeSwitch(colB) && !looksLikeSwitch(colA)) { switch_name = colB; port = colA }
        else if (looksLikePort(colA))                              { port = colA; switch_name = colB }
        else                                                        { port = colA; switch_name = colB }

        return { id: `unplaced-${i}-${Date.now()}`, seat_label, port, switch_name }
      }).filter(p => p.seat_label)

      if (rows.length === 0) {
        const found = data.length > 0
          ? `Found ${data.length} row${data.length !== 1 ? 's' : ''} but none had a recognised seat label column. ` +
            `Detected columns: ${Object.keys(data[0] || {}).join(', ') || 'none'}. `
          : 'The file appears to be empty. '
        setError(
          found +
          'Expected a seat label column named "Seat Label", "Location", "Desk", "Name", etc. ' +
          'Port and Switch are optional. Download the template for a working example.'
        )
        return
      }

      _processImportRows(rows).catch(err => setError(err.message || 'Import failed'))
    }
    reader.readAsBinaryString(file)
  }

  const handleSelectMap = async (mapId) => {
    if (!mapId) { onMapChange(null); return }
    try {
      const res = await getMap(parseInt(mapId))
      onMapChange(res.data)
      setTransform({ x: 0, y: 0, scale: 1 })
    } catch(e) { setError('Could not load map.') }
  }

  const handleDeleteMap = async () => {
    if (!currentMap) return
    if (!window.confirm(`Delete map "${currentMap.name}"? This removes all seat pins.`)) return
    await deleteMap(currentMap.id)
    onMapChange(null)
    await refreshMaps()
  }

  // ── Zone Handlers ──────────────────────────────────────────────────────────
  const toggleZoneMode = () => {
    setZoneMode(z => !z)
    setDrawingZone(null)
    zoneDrawStart.current = null
    setPendingZoneRect(null)
    setSelectedZone(null)
    setEditingZone(null)
  }

  const handleSaveZone = async (form) => {
    try {
      if (editingZone) {
        await updateZone(editingZone.id, form)
        setEditingZone(null)
        setSelectedZone(null)
      } else if (pendingZoneRect) {
        await createZone({ ...form, floor_map_id: currentMap.id, ...pendingZoneRect })
        setPendingZoneRect(null)
        setZoneMode(false)
      }
      await refreshZones()
    } catch(e) {
      setError(e.response?.data?.detail || 'Failed to save zone')
    }
  }

  const handleDeleteZone = async (zone) => {
    if (!window.confirm(`Delete zone "${zone.name}"? Employee assignments will also be removed.`)) return
    try {
      await deleteZone(zone.id)
      setSelectedZone(null)
      await refreshZones()
    } catch(e) {
      setError('Failed to delete zone')
    }
  }

  const handleAssign = async (seatId, data) => {
    try {
      await upsertAssignment(seatId, data)
      await refreshAssignments()
    } catch(e) {
      setError('Failed to save assignment')
    }
  }

  const handleUnassign = async (seatId) => {
    try {
      await deleteAssignment(seatId)
      await refreshAssignments()
    } catch(e) {
      setError('Failed to remove assignment')
    }
  }

  // ── Transform & Pan ────────────────────────────────────────────────────────
  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return

    const handleWheelNative = (e) => {
      if (!currentMap) return
      e.preventDefault()

      setTransform(prevTransform => {
        const zoomFactor = -e.deltaY * 0.001
        const newScale = Math.min(Math.max(prevTransform.scale * (1 + zoomFactor), 0.2), 5)

        const rect = wrapper.getBoundingClientRect()
        const mouseX = e.clientX - rect.left
        const mouseY = e.clientY - rect.top

        const ratio = newScale / prevTransform.scale
        const newX = mouseX - (mouseX - prevTransform.x) * ratio
        const newY = mouseY - (mouseY - prevTransform.y) * ratio

        return { x: newX, y: newY, scale: newScale }
      })
    }

    wrapper.addEventListener('wheel', handleWheelNative, { passive: false })
    return () => wrapper.removeEventListener('wheel', handleWheelNative)
  }, [currentMap])

  const handlePointerDown = (e) => {
    if (!currentMap) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setHasDraggedMap(false)
    setPanStart({ x: e.clientX, y: e.clientY })

    // Zone draw mode: start rectangle
    if (zoneMode) {
      if (!rotateRef.current || !wrapperRef.current) return
      const { x_pct, y_pct } = screenToMap(e.clientX, e.clientY)
      zoneDrawStart.current = { x_pct, y_pct }
      setDrawingZone({ x1_pct: x_pct, y1_pct: y_pct, x2_pct: x_pct, y2_pct: y_pct })
      return
    }

    if (e.target.closest('.seat-pin')) return
    setIsPanning(true)
  }

  const handlePointerMove = (e) => {
    if (!currentMap) return

    const dx = e.clientX - panStart.x
    const dy = e.clientY - panStart.y

    // Zone draw mode: update live rectangle
    if (zoneMode && zoneDrawStart.current) {
      if (!rotateRef.current || !wrapperRef.current) return
      const { x_pct, y_pct } = screenToMap(e.clientX, e.clientY)
      setDrawingZone({
        x1_pct: zoneDrawStart.current.x_pct,
        y1_pct: zoneDrawStart.current.y_pct,
        x2_pct: x_pct,
        y2_pct: y_pct,
      })
      return
    }

    if (isPanning) {
      if (!hasDraggedMap && Math.abs(dx) < 3 && Math.abs(dy) < 3) return
      setHasDraggedMap(true)
      setTransform(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }))
      setPanStart({ x: e.clientX, y: e.clientY })
    } else if (draggingPinRef.current) {
      if (!hasDraggedMap && Math.abs(dx) < 3 && Math.abs(dy) < 3) return
      setHasDraggedMap(true)

      if (!rotateRef.current || !wrapperRef.current) return
      const { x_pct, y_pct } = screenToMap(e.clientX, e.clientY)
      const updatedMap = {
        ...currentMap,
        seats: currentMap.seats.map(s => s.id === draggingPinRef.current.id ? { ...s, x_pct, y_pct } : s)
      }
      onMapChange(updatedMap)
    }
  }

  const handlePointerUp = async (e) => {
    if (!currentMap) return
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch(err) {}

    // Zone draw mode: finalize rectangle
    if (zoneMode && zoneDrawStart.current) {
      const rect = drawingZone
      zoneDrawStart.current = null
      setDrawingZone(null)
      // Only show the form if the drawn area is meaningful (> 2% in both directions)
      if (rect && Math.abs(rect.x2_pct - rect.x1_pct) > 2 && Math.abs(rect.y2_pct - rect.y1_pct) > 2) {
        setPendingZoneRect(rect)
      }
      return
    }

    if (isPanning) {
      setIsPanning(false)
    }

    if (draggingPinRef.current) {
      const pin = draggingPinRef.current
      if (!hasDraggedMap && e.type === 'pointerup') {
        handleSeatClick(pin)
      } else if (hasDraggedMap) {
        const finalSeat = currentMap.seats.find(s => s.id === pin.id)
        if (finalSeat) {
          try {
            await updateSeat(currentMap.id, finalSeat.id, { x_pct: finalSeat.x_pct, y_pct: finalSeat.y_pct })
          } catch(err) {
            setError('Failed to save pin movement.')
          }
        }
      }
      draggingPinRef.current = null
      setDraggingPin(null)
    } else if (!hasDraggedMap && e.type === 'pointerup') {
      if (e.target.closest('.seat-pin')) return
      if (readOnly) return

      if (!rotateRef.current || !wrapperRef.current) return
      const { x_pct, y_pct } = screenToMap(e.clientX, e.clientY)

      // Check if click lands inside any zone → select it instead of placing a pin
      const clickedZone = zones.find(zone => {
        const zx1 = Math.min(zone.x1_pct, zone.x2_pct)
        const zx2 = Math.max(zone.x1_pct, zone.x2_pct)
        const zy1 = Math.min(zone.y1_pct, zone.y2_pct)
        const zy2 = Math.max(zone.y1_pct, zone.y2_pct)
        return x_pct >= zx1 && x_pct <= zx2 && y_pct >= zy1 && y_pct <= zy2
      })

      if (clickedZone) {
        setSelectedZone(z => z?.id === clickedZone.id ? null : clickedZone)
        setPendingPin(null)
        setEditingSeat(null)
        onSeatSelect(null)
        return
      }

      // Empty space click → deselect zone, place new pin
      setSelectedZone(null)
      setPendingPin({ x_pct, y_pct })
      setEditingSeat(null)
      onSeatSelect(null)
    }
  }

  const handleDragUnplacedPinDrop = async (e) => {
    if (!currentMap || !draggedUnplacedPin || !rotateRef.current || !wrapperRef.current) return
    e.preventDefault()

    const { x_pct, y_pct } = screenToMap(e.clientX, e.clientY)

    let matchedSwitchId = null
    if (draggedUnplacedPin.switch_name) {
      const parts = draggedUnplacedPin.switch_name.split(/\s*-\s*/).map(p => p.trim().toLowerCase())
      const match = switches.find(sw => {
        const swName = sw.name.toLowerCase()
        const swIp   = sw.ip_address.toLowerCase()
        return parts.some(p => p === swName || p === swIp || p.includes(swName) || p.includes(swIp))
      })
      if (match) matchedSwitchId = match.id
    }

    try {
      const body = { seat_label: draggedUnplacedPin.seat_label, port: draggedUnplacedPin.port || '', x_pct, y_pct, switch_id: matchedSwitchId }
      await addSeat(currentMap.id, body)
      setUnplacedPins(prev => prev.filter(p => p.id !== draggedUnplacedPin.id))
      const res = await getMap(currentMap.id)
      onMapChange(res.data)
    } catch(err) {
      setError(err.response?.data?.detail || 'Failed to place pin')
    }
    setDraggedUnplacedPin(null)
  }

  const handleSeatClick = (seat) => {
    onSeatSelect(seat)
    setEditingSeat(null)
    setPendingPin(null)
  }

  const handleStartEditSeat = (seat) => {
    setEditingSeat(seat)
    setPendingPin(null)
  }

  const handleSaveSeat = async (form) => {
    if (!currentMap) return
    try {
      const body = {
        seat_label: form.seat_label,
        port: form.port,
        x_pct: pendingPin?.x_pct ?? editingSeat?.x_pct,
        y_pct: pendingPin?.y_pct ?? editingSeat?.y_pct,
        switch_id: form.switch_id ? parseInt(form.switch_id) : null,
      }
      if (editingSeat) {
        await updateSeat(currentMap.id, editingSeat.id, body)
      } else {
        await addSeat(currentMap.id, body)
      }
      setPendingPin(null)
      setEditingSeat(null)
      const res = await getMap(currentMap.id)
      onMapChange(res.data)
    } catch(e) { setError(e.response?.data?.detail || 'Save failed') }
  }

  const handleDeleteSeat = async (seat) => {
    if (!currentMap) return
    await deleteSeat(currentMap.id, seat.id)
    onSeatSelect(null)
    const res = await getMap(currentMap.id)
    onMapChange(res.data)
  }

  const isPdfMap = currentMap?.filename?.toLowerCase().endsWith('.pdf')

  // ── Shared map canvas ──────────────────────────────────────────────────────
  const mapCanvas = currentMap && (
    <>
      {/* Toolbar row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: fullScreen ? '8px 16px' : '0 0 8px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="badge badge-gray">{currentMap.seats?.length || 0} pins</span>
          {zones.length > 0 && !zoneMode && (
            <span className="badge badge-purple">{zones.length} zone{zones.length !== 1 ? 's' : ''}</span>
          )}
          {!readOnly && (
            <>
              <button className="btn btn-ghost" style={{ fontSize: '0.75rem', padding: '3px 10px' }} onClick={() => handleRotate('ccw')} title="Rotate 90° counter-clockwise">↺ CCW</button>
              <button className="btn btn-ghost" style={{ fontSize: '0.75rem', padding: '3px 10px' }} onClick={() => handleRotate('cw')}  title="Rotate 90° clockwise">↻ CW</button>
              {rotation !== 0 && <span style={{ fontSize: '0.7rem', color: 'var(--cyan)' }}>{rotation}°</span>}
              <button
                className={`btn ${zoneMode ? 'btn-primary' : 'btn-ghost'}`}
                style={{ fontSize: '0.75rem', padding: '3px 10px', ...(zoneMode ? {} : { borderColor: '#a855f7', color: '#a855f7' }) }}
                onClick={toggleZoneMode}
                title={zoneMode ? 'Cancel zone drawing' : 'Draw a zone overlay'}
              >
                {zoneMode ? '✕ Cancel' : '▭ Draw Zone'}
              </button>
            </>
          )}
        </div>
        <span className="text-xs text-muted" style={{ textAlign: 'right' }}>
          {zoneMode
            ? 'Click and drag to draw a zone'
            : readOnly
              ? 'Scroll to zoom · Drag to pan · Click pin to select'
              : 'Scroll to zoom · Drag map to pan · Drag pins to move · Click to add pin'}
        </span>
      </div>

      {/* Canvas */}
      <div
        ref={wrapperRef}
        className="map-canvas-wrapper"
        style={{
          ...(fullScreen ? { flex: 1, height: 'auto' } : {}),
          cursor: zoneMode ? 'crosshair' : undefined,
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onDragOver={e => e.preventDefault()}
        onDrop={handleDragUnplacedPinDrop}
      >
        {/* Pan / zoom layer */}
        <div
          ref={contentRef}
          className="map-content"
          style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})` }}
        >
          {/* Rotation layer — image + overlays + pins rotate together */}
          <div
            ref={rotateRef}
            style={{ transform: `rotate(${rotation}deg)`, transformOrigin: '50% 50%', position: 'relative' }}
          >
            {isPdfMap ? (
              <Document file={`/uploads/${currentMap.filename}`} loading="Loading PDF...">
                <Page pageNumber={1} renderTextLayer={false} renderAnnotationLayer={false} onRenderSuccess={fitToPage} />
              </Document>
            ) : (
              <img src={`/uploads/${currentMap.filename}`} alt="Floor plan" onLoad={fitToPage} />
            )}

            {/* Zone overlay — rendered above image, below seat pins */}
            <ZoneOverlay
              zones={zones}
              selectedZoneId={selectedZone?.id}
              drawingZone={drawingZone}
              zoneMode={zoneMode}
            />

            {pendingPin && (
              <div className="seat-pin" style={{ left: `${pendingPin.x_pct}%`, top: `${pendingPin.y_pct}%`, color: 'var(--yellow)', zIndex: 20 }}>
                <div className="pin-circle" style={{ background: 'var(--yellow)' }}>+</div>
                <div className="pin-tail" />
              </div>
            )}
            {currentMap.seats?.map(seat => (
              <SeatPin
                key={seat.id}
                seat={seat}
                selected={selectedSeat?.id === seat.id}
                assigned={assignments[seat.id]}
                onPointerDown={readOnly ? undefined : (e, s) => { draggingPinRef.current = s; setDraggingPin(s) }}
              />
            ))}
          </div>
        </div>
      </div>
    </>
  )

  // ── Shared bottom forms ────────────────────────────────────────────────────
  const bottomForms = (
    <>
      {pendingZoneRect && (
        <ZoneConfigForm
          onSave={handleSaveZone}
          onCancel={() => { setPendingZoneRect(null); setZoneMode(false) }}
        />
      )}
      {editingZone && (
        <ZoneConfigForm
          initial={editingZone}
          onSave={handleSaveZone}
          onCancel={() => setEditingZone(null)}
        />
      )}
      {selectedZone && !editingZone && !pendingZoneRect && (
        <ZoneDetailPanel
          zone={selectedZone}
          seats={currentMap?.seats || []}
          assignments={assignments}
          onAssign={handleAssign}
          onUnassign={handleUnassign}
          onEdit={() => { setEditingZone(selectedZone) }}
          onDelete={() => handleDeleteZone(selectedZone)}
          onClose={() => setSelectedZone(null)}
        />
      )}
      {(pendingPin || editingSeat) && !pendingZoneRect && !editingZone && (
        <SeatForm
          switches={switches}
          onSave={handleSaveSeat}
          onCancel={() => { setPendingPin(null); setEditingSeat(null) }}
          initial={editingSeat ? { seat_label: editingSeat.seat_label, port: editingSeat.port, switch_id: editingSeat.switch_id || '' } : null}
        />
      )}
      {selectedSeat && !editingSeat && !pendingPin && !selectedZone && !pendingZoneRect && !editingZone && (
        <div className="alert alert-info" style={{ justifyContent: 'space-between' }}>
          <span>📍 Selected: <strong>{selectedSeat.seat_label}</strong> → {selectedSeat.switch_name || '?'} : <span className="font-mono">{selectedSeat.port}</span>
            {assignments[selectedSeat.id] && (
              <span style={{ marginLeft: 10, color: '#22c55e' }}>
                · {assignments[selectedSeat.id].user_display_name || assignments[selectedSeat.id].user_email}
              </span>
            )}
          </span>
          {!readOnly && (
            <div className="flex gap-2">
              <button className="btn btn-ghost" style={{ fontSize: '0.75rem', padding: '4px 10px' }} onClick={() => handleStartEditSeat(selectedSeat)}>✏️ Edit</button>
              <button className="btn btn-danger" style={{ fontSize: '0.75rem', padding: '4px 10px' }} onClick={() => handleDeleteSeat(selectedSeat)}>🗑️ Delete</button>
            </div>
          )}
        </div>
      )}
    </>
  )

  // ── Full-screen layout ─────────────────────────────────────────────────────
  if (fullScreen) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-base)' }}>
        {error && <div className="alert alert-error" style={{ flexShrink: 0, margin: '8px 16px 0' }}>{error}</div>}

        {importResult && (
          <div className="alert alert-info" style={{ flexShrink: 0, margin: '8px 16px 0', justifyContent: 'space-between' }}>
            <span>
              Import complete — <strong>{importResult.updated}</strong> seat{importResult.updated !== 1 ? 's' : ''} updated in place
              {importResult.unmatched > 0 && <>, <strong>{importResult.unmatched}</strong> new pin{importResult.unmatched !== 1 ? 's' : ''} ready to place</>}
            </span>
            <button className="btn btn-ghost" style={{ padding: '2px 8px', fontSize: '0.75rem' }} onClick={() => setImportResult(null)}>✕</button>
          </div>
        )}

        {currentMap && !readOnly && (
          <div style={{ flexShrink: 0, padding: '8px 16px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
            <button className="btn btn-success" style={{ fontSize: '0.78rem' }} onClick={() => excelRef.current?.click()}>
              📊 Import pins (Excel/CSV)
            </button>
            <button className="btn btn-ghost" style={{ fontSize: '0.78rem' }} onClick={handleDownloadTemplate}>
              ⬇ Template
            </button>
            <input ref={excelRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={handleExcelUpload} />
            {unplacedPins.length > 0 && (
              <span className="text-sm text-green">{unplacedPins.length} pins ready to place</span>
            )}
          </div>
        )}

        {unplacedPins.length > 0 && (
          <div style={{ flexShrink: 0, margin: '8px 16px 0', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 10 }}>
            <div className="text-sm text-muted" style={{ marginBottom: 6 }}>
              Drag these onto the map:
              <button className="btn btn-ghost" style={{ float: 'right', padding: '0 8px', fontSize: '10px' }} onClick={() => setUnplacedPins([])}>Clear</button>
            </div>
            <div className="flex" style={{ gap: 8, flexWrap: 'wrap', maxHeight: 200, overflowY: 'auto' }}>
              {unplacedPins.map(pin => (
                <div key={pin.id} draggable onDragStart={() => setDraggedUnplacedPin(pin)}
                  className="badge badge-purple" style={{ cursor: 'grab', padding: '6px 10px', fontSize: '0.8rem' }}>
                  📍 {pin.seat_label} ({pin.port})
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Map canvas fills remaining space */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: '0 0 0 0' }}>
          {mapCanvas}
        </div>

        {/* Forms pinned at bottom */}
        {(pendingPin || editingSeat || pendingZoneRect || editingZone || selectedZone || (selectedSeat && !editingSeat && !pendingPin && !selectedZone)) && (
          <div style={{ flexShrink: 0, padding: '8px 16px' }}>
            {bottomForms}
          </div>
        )}
      </div>
    )
  }

  // ── Normal card layout ─────────────────────────────────────────────────────
  return (
    <div className="card">
      <div className="card-header">
        <h3>🗺️ Floor Map Manager</h3>
        <span className="badge badge-gray">{currentMap ? `Map: ${currentMap.name}` : 'No map selected'}</span>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

        {error && <div className="alert alert-error">{error}</div>}

        {importResult && (
          <div className="alert alert-info" style={{ justifyContent: 'space-between' }}>
            <span>
              Import complete — <strong>{importResult.updated}</strong> seat{importResult.updated !== 1 ? 's' : ''} updated in place
              {importResult.unmatched > 0 && <>, <strong>{importResult.unmatched}</strong> new pin{importResult.unmatched !== 1 ? 's' : ''} ready to place</>}
            </span>
            <button className="btn btn-ghost" style={{ padding: '2px 8px', fontSize: '0.75rem' }} onClick={() => setImportResult(null)}>✕</button>
          </div>
        )}

        {!hideSelector && (
          <div className="form-row" style={{ alignItems: 'flex-end' }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label>Active Map</label>
              <select id="map-selector" className="select" value={currentMap?.id || ''} onChange={e => handleSelectMap(e.target.value)}>
                <option value="">— Select a floor plan —</option>
                {(siteMapIds ? maps.filter(m => siteMapIds.has(m.id)) : maps).map(m => (
                  <option key={m.id} value={m.id}>{m.name} ({m.seat_count} seats)</option>
                ))}
              </select>
            </div>
            {currentMap && !readOnly && (
              <div className="form-group" style={{ maxWidth: 'max-content' }}>
                <label>&nbsp;</label>
                <button className="btn btn-danger" onClick={handleDeleteMap}>🗑️ Delete Map</button>
              </div>
            )}
          </div>
        )}

        {currentMap && !readOnly && (
          <div className="flex gap-4 items-center">
            <button className="btn btn-success" onClick={() => excelRef.current?.click()}>
              📊 Import seats (Excel/CSV)
            </button>
            <button className="btn btn-ghost" onClick={handleDownloadTemplate}>⬇ Template</button>
            <input ref={excelRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={handleExcelUpload} />
            {unplacedPins.length > 0 && <span className="text-sm text-green">{unplacedPins.length} pins loaded and ready to place!</span>}
          </div>
        )}

        {unplacedPins.length > 0 && (
          <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 12 }}>
            <div className="text-sm text-muted mb-4">Drag these badges onto the map to place them: <button className="btn btn-ghost" style={{float: 'right', padding: '0 8px', fontSize: '10px'}} onClick={() => setUnplacedPins([])}>Clear</button></div>
            <div className="flex" style={{ gap: 8, flexWrap: 'wrap', maxHeight: 120, overflowY: 'auto' }}>
              {unplacedPins.map(pin => (
                <div key={pin.id} draggable onDragStart={() => setDraggedUnplacedPin(pin)}
                  className="badge badge-purple" style={{ cursor: 'grab', padding: '6px 10px', fontSize: '0.8rem' }}>
                  📍 {pin.seat_label} ({pin.port})
                </div>
              ))}
            </div>
          </div>
        )}

        {mapCanvas}
        {bottomForms}
      </div>
    </div>
  )
}
