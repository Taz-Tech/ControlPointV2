import { useState, useEffect, useRef } from 'react'
import { getMaps, getMap, deleteMap, getSwitches, addSeat, updateSeat, deleteSeat, updateMapRotation, importSeats, getZones, createZone, updateZone, deleteZone, getAssignments, upsertAssignment, deleteAssignment, addAP, updateAP, deleteAP } from '../../api/client.js'
import { Document, Page, pdfjs } from 'react-pdf'
import * as xlsx from 'xlsx'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

const SNAP_PCT = 2.5   // % distance from first vertex that snaps/closes a polygon

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

// Ray-casting point-in-polygon for custom zone shapes
function pointInPolygon(x, y, points) {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x, yi = points[i].y
    const xj = points[j].x, yj = points[j].y
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi))
      inside = !inside
  }
  return inside
}

// Ensure every zone has polygon points — synthesise from rect coords if missing
function withPoints(zone) {
  if (zone.points?.length >= 3) return zone
  const l = Math.min(zone.x1_pct, zone.x2_pct), r = Math.max(zone.x1_pct, zone.x2_pct)
  const t = Math.min(zone.y1_pct, zone.y2_pct), b = Math.max(zone.y1_pct, zone.y2_pct)
  return { ...zone, points: [{ x: l, y: t }, { x: r, y: t }, { x: r, y: b }, { x: l, y: b }] }
}

// ── Seat Pin on Map ───────────────────────────────────────────────────────────
function SeatPin({ seat, selected, onClick, onPointerDown, assigned, onHover, portStatus }) {
  const colors = {
    mapped:   'var(--cyan)',
    selected: 'var(--orange)',
    assigned: '#22c55e',
    up:       '#22c55e',
    down:     '#ef4444',
    unknown:  '#f59e0b',
  }
  const color = selected
    ? colors.selected
    : portStatus === 'up'      ? colors.up
    : portStatus === 'down'    ? colors.down
    : portStatus === 'unknown' ? colors.unknown
    : assigned ? colors.assigned : colors.mapped
  return (
    <div
      data-seat-id={seat.id}
      className={`seat-pin${selected ? ' selected' : ''}`}
      style={{ left: `${seat.x_pct}%`, top: `${seat.y_pct}%`, color, zIndex: 10 }}
      onPointerDown={(e) => onPointerDown && onPointerDown(e, seat)}
      onMouseEnter={(e) => onHover?.(e, seat)}
      onMouseMove={(e)  => onHover?.(e, seat)}
      onMouseLeave={()  => onHover?.(null)}
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

// ── AP Pin on Map ─────────────────────────────────────────────────────────────
function APPin({ ap, selected, onPointerDown }) {
  return (
    <div
      data-ap-id={ap.id}
      style={{
        position: 'absolute',
        left: `${ap.x_pct}%`,
        top: `${ap.y_pct}%`,
        transform: 'translate(-50%, -50%)',
        zIndex: 12,
        cursor: onPointerDown ? 'move' : 'pointer',
        userSelect: 'none',
      }}
      onPointerDown={onPointerDown ? (e) => onPointerDown(e, ap) : undefined}
    >
      <div style={{
        width: 28, height: 28, borderRadius: '50%',
        background: selected ? 'var(--orange)' : '#6366f1',
        border: `2px solid ${selected ? '#fff' : 'rgba(255,255,255,0.5)'}`,
        boxShadow: selected
          ? '0 0 0 3px var(--orange), 0 2px 8px rgba(0,0,0,0.4)'
          : '0 0 0 2px rgba(99,102,241,0.4), 0 2px 8px rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '0.85rem', transition: 'all 0.12s',
      }}>
        📡
      </div>
      <div style={{
        position: 'absolute', top: '110%', left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(0,0,0,0.8)', color: '#fff',
        fontSize: '0.62rem', padding: '2px 5px', borderRadius: 3,
        whiteSpace: 'nowrap', pointerEvents: 'none',
      }}>
        {ap.name || ap.device_name || 'AP'}
      </div>
    </div>
  )
}

// ── AP Form ───────────────────────────────────────────────────────────────────
function APForm({ siteAPs, onSave, onCancel, initial }) {
  const [devId, setDevId] = useState(initial?.unifi_device_id ? String(initial.unifi_device_id) : '')
  const selected = siteAPs.find(d => String(d.id) === devId)
  return (
    <div className="card" style={{ border: '1px solid #6366f1', boxShadow: '0 0 8px rgba(99,102,241,0.3)' }}>
      <div className="card-header">
        <h4>{initial ? 'Edit AP Pin' : 'Place AP'}</h4>
      </div>
      <div className="card-body">
        {siteAPs.length === 0 ? (
          <p className="text-sm text-muted">No APs are synced for this site. Sync UniFi devices first.</p>
        ) : (
          <div className="form-group">
            <label>Access Point</label>
            <select className="select" value={devId} onChange={e => setDevId(e.target.value)} autoFocus>
              <option value="">— Select an AP —</option>
              {siteAPs.map(d => (
                <option key={d.id} value={d.id}>
                  {d.name || d.mac}{d.ip ? ` — ${d.ip}` : ''}{d.model ? ` (${d.model})` : ''}
                </option>
              ))}
            </select>
            {selected?.state && (
              <div style={{ marginTop: 5, fontSize: '0.75rem', color: selected.state === 'online' ? '#22c55e' : '#ef4444' }}>
                ● {selected.state}
              </div>
            )}
          </div>
        )}
        <div className="flex gap-3" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button
            className="btn btn-primary"
            style={{ background: '#6366f1', borderColor: '#6366f1' }}
            onClick={() => onSave({ unifi_device_id: parseInt(devId), name: selected?.name || selected?.mac || '' })}
            disabled={!devId}
          >
            {initial ? 'Update AP' : 'Next: click map to place'}
          </button>
        </div>
      </div>
    </div>
  )
}

const ZONE_TYPE_PRESETS = [
  'Conference Room',
  'Huddle Room',
  'Open Workspace',
  'Break Room',
  'Private Office',
  'Lobby',
  'Server Room',
  'Training Room',
]

// ── Zone Config Form ──────────────────────────────────────────────────────────
function ZoneConfigForm({ onSave, onCancel, initial }) {
  const [name,     setName]     = useState(initial?.name || '')
  const [teamName, setTeamName] = useState(initial?.team_name || '')
  const [zoneType, setZoneType] = useState(initial?.zone_type || '')
  const [color,    setColor]    = useState(initial?.color || ZONE_COLORS[0])

  // If the saved type is a custom value (not in presets), pre-fill the custom input
  const isCustom = zoneType && !ZONE_TYPE_PRESETS.includes(zoneType)
  const [customType, setCustomType] = useState(isCustom ? zoneType : '')
  const [showCustom, setShowCustom] = useState(isCustom)

  const handleTypeSelect = (t) => {
    if (t === '__custom__') {
      setShowCustom(true)
      setZoneType(customType)
    } else {
      setShowCustom(false)
      setCustomType('')
      setZoneType(t)
    }
  }

  const effectiveType = showCustom ? customType : zoneType

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
              placeholder="Main Conference, Huddle A…"
              autoFocus
            />
          </div>
          <div className="form-group">
            <label>Team / Label</label>
            <input
              className="input"
              value={teamName}
              onChange={e => setTeamName(e.target.value)}
              placeholder="Engineering, IT, HR…"
            />
          </div>
        </div>

        {/* Zone Type */}
        <div className="form-group">
          <label>Zone Type <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: '0.75rem' }}>— used for filtering on the map</span></label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: showCustom ? 8 : 0 }}>
            {ZONE_TYPE_PRESETS.map(t => (
              <button key={t} type="button"
                onClick={() => handleTypeSelect(t)}
                style={{
                  padding: '4px 10px', borderRadius: 20, fontSize: '0.75rem', cursor: 'pointer',
                  border: `1px solid ${(!showCustom && zoneType === t) ? color : 'var(--border)'}`,
                  background: (!showCustom && zoneType === t) ? `${color}22` : 'transparent',
                  color: (!showCustom && zoneType === t) ? color : 'var(--text-secondary)',
                  fontWeight: (!showCustom && zoneType === t) ? 600 : 400,
                  transition: 'all 0.12s',
                }}>
                {t}
              </button>
            ))}
            <button type="button"
              onClick={() => handleTypeSelect('__custom__')}
              style={{
                padding: '4px 10px', borderRadius: 20, fontSize: '0.75rem', cursor: 'pointer',
                border: `1px solid ${showCustom ? color : 'var(--border)'}`,
                background: showCustom ? `${color}22` : 'transparent',
                color: showCustom ? color : 'var(--text-secondary)',
                fontWeight: showCustom ? 600 : 400,
                transition: 'all 0.12s',
              }}>
              Custom…
            </button>
          </div>
          {showCustom && (
            <input className="input" style={{ fontSize: '0.85rem', marginTop: 2 }}
              placeholder="Enter custom zone type…"
              value={customType}
              onChange={e => { setCustomType(e.target.value); setZoneType(e.target.value) }}
            />
          )}
        </div>

        <div className="form-group">
          <label>Color</label>
          <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
            {ZONE_COLORS.map(c => (
              <button key={c} type="button"
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
            onClick={() => onSave({ name: name.trim(), team_name: teamName.trim(), zone_type: effectiveType.trim(), color })}
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
function SeatAssignCard({ seat, assignment, color, onAssign, onUnassign, readOnly }) {
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
      {editing && !readOnly ? (
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
          {!readOnly && (
            <div className="flex gap-1" style={{ marginTop: 5 }}>
              <button className="btn btn-ghost" style={{ fontSize: '0.68rem', padding: '2px 7px' }} onClick={handleEdit}>
                ✏️ Edit
              </button>
              <button className="btn btn-danger" style={{ fontSize: '0.68rem', padding: '2px 7px' }} onClick={onUnassign}>
                Remove
              </button>
            </div>
          )}
        </div>
      ) : !readOnly ? (
        <button
          className="btn btn-ghost"
          style={{ fontSize: '0.72rem', padding: '3px 8px', borderColor: `${color}60`, color: color }}
          onClick={() => setEditing(true)}
        >
          + Assign Employee
        </button>
      ) : (
        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Unassigned</span>
      )}
    </div>
  )
}

// ── Zone Detail Panel ─────────────────────────────────────────────────────────
function ZoneDetailPanel({ zone, seats, assignments, onAssign, onUnassign, onEdit, onDelete, onClose, readOnly }) {
  const zoneSeats = seats.filter(s => {
    if (zone.points?.length >= 3) return pointInPolygon(s.x_pct, s.y_pct, zone.points)
    const x1 = Math.min(zone.x1_pct, zone.x2_pct), x2 = Math.max(zone.x1_pct, zone.x2_pct)
    const y1 = Math.min(zone.y1_pct, zone.y2_pct), y2 = Math.max(zone.y1_pct, zone.y2_pct)
    return s.x_pct >= x1 && s.x_pct <= x2 && s.y_pct >= y1 && s.y_pct <= y2
  })
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
          {!readOnly && <button className="btn btn-ghost" style={{ fontSize: '0.75rem', padding: '3px 8px' }} onClick={onEdit}>✏️ Edit</button>}
          {!readOnly && <button className="btn btn-danger" style={{ fontSize: '0.75rem', padding: '3px 8px' }} onClick={onDelete}>🗑️ Delete</button>}
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
function ZoneOverlay({ zones, selectedZoneId, drawingPolygon, polygonCursor, readOnly, highlightedTypes }) {
  const svgRef = useRef(null)
  const [dim, setDim] = useState({ w: 1, h: 1 })

  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const obs = new ResizeObserver(entries => {
      const r = entries[0].contentRect
      setDim({ w: r.width || 1, h: r.height || 1 })
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const px = v => (v / 100) * dim.w
  const py = v => (v / 100) * dim.h
  const polyPts = pts => pts.map(p => `${px(p.x)},${py(p.y)}`).join(' ')

  const filterActive  = highlightedTypes && highlightedTypes.length > 0

  return (
    <svg
      ref={svgRef}
      style={{
        position: 'absolute', top: 0, left: 0,
        width: '100%', height: '100%',
        overflow: 'visible', zIndex: 5,
        pointerEvents: 'none',
      }}
    >
      <defs>
        <style>{`
          @keyframes zoneAnts { to { stroke-dashoffset: -24; } }
          .zone-ants { animation: zoneAnts 0.55s linear infinite; }
          @keyframes zoneGlow { 0%,100% { fill-opacity: 0.38; } 50% { fill-opacity: 0.60; } }
          .zone-glow-fill { animation: zoneGlow 1.8s ease-in-out infinite; }
        `}</style>
        {/* Per-zone glow filter for highlighted types */}
        {filterActive && zones.map(zone => {
          const isHighlighted = highlightedTypes.includes(zone.zone_type)
          if (!isHighlighted) return null
          return (
            <filter key={`gf-${zone.id}`} id={`zone-glow-${zone.id}`} x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="10" result="blur" />
              <feFlood floodColor={zone.color} floodOpacity="0.55" result="color" />
              <feComposite in="color" in2="blur" operator="in" result="shadow" />
              <feMerge><feMergeNode in="shadow" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          )
        })}
      </defs>

      {zones.map(zone => {
        const isPoly  = zone.points?.length >= 3
        const selected = zone.id === selectedZoneId
        const isHighlighted = filterActive && highlightedTypes.includes(zone.zone_type)
        const isDimmed      = filterActive && !isHighlighted

        // Geometry
        const rx = Math.min(zone.x1_pct, zone.x2_pct)
        const ry = Math.min(zone.y1_pct, zone.y2_pct)
        const rw = Math.abs(zone.x2_pct - zone.x1_pct)
        const rh = Math.abs(zone.y2_pct - zone.y1_pct)

        // Label center
        const lx = isPoly
          ? zone.points.reduce((s, p) => s + p.x, 0) / zone.points.length
          : rx + rw / 2
        const ly = isPoly
          ? zone.points.reduce((s, p) => s + p.y, 0) / zone.points.length
          : ry + rh / 2

        const fillOpacity = isDimmed ? 0.03 : isHighlighted ? 0.38 : (selected ? 0.28 : 0.12)
        const showLabel   = selected || isHighlighted
        const glowFilter  = isHighlighted ? `url(#zone-glow-${zone.id})` : undefined

        const shapeProps = isPoly
          ? { as: 'polygon', points: polyPts(zone.points) }
          : { as: 'rect', x: `${rx}%`, y: `${ry}%`, width: `${rw}%`, height: `${rh}%`, rx: '4' }

        return (
          <g key={zone.id} opacity={isDimmed ? 0.4 : 1}>
            {/* Glow halo — blurred duplicate behind main fill for highlighted zones */}
            {isHighlighted && (
              isPoly ? (
                <polygon points={polyPts(zone.points)} fill={zone.color} fillOpacity={0.22}
                  filter={glowFilter} stroke="none" style={{ pointerEvents: 'none' }} />
              ) : (
                <rect x={`${rx}%`} y={`${ry}%`} width={`${rw}%`} height={`${rh}%`} rx="4"
                  fill={zone.color} fillOpacity={0.22}
                  filter={glowFilter} stroke="none" style={{ pointerEvents: 'none' }} />
              )
            )}

            {/* Main fill — pulsing when highlighted */}
            {isPoly ? (
              <polygon points={polyPts(zone.points)} fill={zone.color} fillOpacity={fillOpacity}
                stroke="none" className={isHighlighted ? 'zone-glow-fill' : undefined} />
            ) : (
              <rect x={`${rx}%`} y={`${ry}%`} width={`${rw}%`} height={`${rh}%`} rx="4"
                fill={zone.color} fillOpacity={fillOpacity}
                stroke="none" className={isHighlighted ? 'zone-glow-fill' : undefined} />
            )}

            {/* Highlighted border (solid, not marching ants) */}
            {isHighlighted && !selected && (
              isPoly ? (
                <polygon points={polyPts(zone.points)} fill="none"
                  stroke={zone.color} strokeWidth="2.5" strokeOpacity="0.85"
                  style={{ pointerEvents: 'none' }} />
              ) : (
                <rect x={`${rx}%`} y={`${ry}%`} width={`${rw}%`} height={`${rh}%`} rx="4"
                  fill="none" stroke={zone.color} strokeWidth="2.5" strokeOpacity="0.85"
                  style={{ pointerEvents: 'none' }} />
              )
            )}

            {selected && (
              <>
                {/* Marching ants border */}
                {isPoly ? (
                  <>
                    <polygon points={polyPts(zone.points)} fill="none" stroke="rgba(255,255,255,0.65)" strokeWidth="2.5" style={{ pointerEvents: 'none' }} />
                    <polygon points={polyPts(zone.points)} fill="none" stroke={zone.color} strokeWidth="2.5" strokeDasharray="10,6" className="zone-ants" style={{ pointerEvents: 'none' }} />
                  </>
                ) : (
                  <>
                    <rect x={`${rx}%`} y={`${ry}%`} width={`${rw}%`} height={`${rh}%`} fill="none" stroke="rgba(255,255,255,0.65)" strokeWidth="2.5" rx="4" style={{ pointerEvents: 'none' }} />
                    <rect x={`${rx}%`} y={`${ry}%`} width={`${rw}%`} height={`${rh}%`} fill="none" stroke={zone.color} strokeWidth="2.5" strokeDasharray="10,6" rx="4" className="zone-ants" style={{ pointerEvents: 'none' }} />
                  </>
                )}

                {/* Vertex handles — admin only */}
                {isPoly && !readOnly && (
                  <>
                    {zone.points.map((pt, i) => {
                      const next = zone.points[(i + 1) % zone.points.length]
                      return (
                        <line key={`edge-${i}`}
                          x1={px(pt.x)} y1={py(pt.y)} x2={px(next.x)} y2={py(next.y)}
                          stroke="white" strokeOpacity="0.01" strokeWidth="14"
                          data-edge-insert={i} style={{ cursor: 'cell', pointerEvents: 'stroke' }} />
                      )
                    })}
                    {zone.points.map((pt, i) => (
                      <circle key={`v-${i}`}
                        cx={px(pt.x)} cy={py(pt.y)} r="6"
                        fill="white" stroke={zone.color} strokeWidth="2"
                        data-vertex-handle={i} style={{ cursor: 'move', pointerEvents: 'all' }} />
                    ))}
                  </>
                )}
              </>
            )}

            {/* Zone label — shown when selected OR highlighted by filter */}
            {showLabel && (
              <text x={px(lx)} y={py(ly)} textAnchor="middle" dominantBaseline="central"
                style={{ pointerEvents: 'none', userSelect: 'none' }}>
                <tspan x={px(lx)}
                  dy={zone.team_name || zone.zone_type ? '-0.75em' : '0'}
                  fill={zone.color} fontSize={isHighlighted ? '14' : '13'} fontWeight="700"
                  style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.95))' }}>
                  {zone.name}
                </tspan>
                {zone.zone_type && (
                  <tspan x={px(lx)} dy="1.35em"
                    fill={zone.color} fontSize="11" fontWeight="600" opacity="0.9"
                    style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.9))' }}>
                    {zone.zone_type}
                  </tspan>
                )}
                {zone.team_name && (
                  <tspan x={px(lx)} dy={zone.zone_type ? '1.25em' : '1.35em'}
                    fill={zone.color} fontSize="11" opacity="0.75"
                    style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.9))' }}>
                    {zone.team_name}
                  </tspan>
                )}
              </text>
            )}
          </g>
        )
      })}

      {/* Live polygon while drawing */}
      {drawingPolygon.length > 0 && (() => {
        const allPts   = polygonCursor ? [...drawingPolygon, polygonCursor] : drawingPolygon
        const first    = drawingPolygon[0]
        const canClose = drawingPolygon.length >= 3
        const snapping = canClose && polygonCursor &&
          Math.hypot(polygonCursor.x - first.x, polygonCursor.y - first.y) < SNAP_PCT
        return (
          <g style={{ pointerEvents: 'none' }}>
            {/* Filled preview (3+ vertices) */}
            {drawingPolygon.length >= 3 && (
              <polygon
                points={drawingPolygon.map(p => `${px(p.x)},${py(p.y)}`).join(' ')}
                fill="rgba(59,130,246,0.10)"
                stroke="none"
              />
            )}
            {/* Edge lines including preview to cursor */}
            {allPts.length >= 2 && (
              <polyline
                points={allPts.map(p => `${px(p.x)},${py(p.y)}`).join(' ')}
                fill="none"
                stroke="#3b82f6"
                strokeWidth="2"
                strokeDasharray="7,4"
              />
            )}
            {/* Closing line back to first vertex when snapping */}
            {snapping && (
              <line
                x1={px(polygonCursor.x)} y1={py(polygonCursor.y)}
                x2={px(first.x)}        y2={py(first.y)}
                stroke="#22c55e" strokeWidth="2" strokeDasharray="5,3"
              />
            )}
            {/* Placed vertex dots */}
            {drawingPolygon.map((pt, i) => {
              const isFirst  = i === 0
              const closeHit = isFirst && snapping
              return (
                <circle
                  key={i}
                  cx={px(pt.x)} cy={py(pt.y)}
                  r={closeHit ? 9 : isFirst && canClose ? 7 : 5}
                  fill={closeHit ? '#22c55e' : '#3b82f6'}
                  stroke="white" strokeWidth="2"
                />
              )
            })}
            {/* Live cursor dot */}
            {polygonCursor && !snapping && (
              <circle
                cx={px(polygonCursor.x)} cy={py(polygonCursor.y)}
                r="4" fill="white" stroke="#3b82f6" strokeWidth="2"
              />
            )}
          </g>
        )
      })()}
    </svg>
  )
}

// ── Main FloorMapManager ──────────────────────────────────────────────────────
export default function FloorMapManager({ switches, onSwitchesChange, currentMap, onMapChange, onSeatSelect, selectedSeat, siteMapIds, siteActive, readOnly = false, hideSelector = false, fullScreen = false, highlightedTypes = [], portStatuses = {}, portClients = {}, siteAPs = [] }) {
  const [maps, setMaps]             = useState([])
  const [pinMode, setPinMode]       = useState(false)
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
  const [zoneMode, setZoneMode]               = useState(false)
  const [drawingPolygon, setDrawingPolygon]   = useState([])    // vertices placed so far
  const [polygonCursor,  setPolygonCursor]    = useState(null)  // live cursor position for preview line
  const [pendingZonePolygon, setPendingZonePolygon] = useState(null)  // closed polygon awaiting ZoneConfigForm
  const [selectedZone, setSelectedZone]       = useState(null)
  const [editingZone, setEditingZone]         = useState(null)
  const editingVertexRef = useRef(null)  // { zoneId, vertexIndex }

  // Keyboard: Escape cancels polygon drawing, Enter closes it
  useEffect(() => {
    if (!zoneMode) return
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setDrawingPolygon([])
        setPolygonCursor(null)
      } else if (e.key === 'Enter' && drawingPolygon.length >= 3) {
        setPendingZonePolygon([...drawingPolygon])
        setDrawingPolygon([])
        setPolygonCursor(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoneMode, drawingPolygon])

  // Export State
  const [exporting, setExporting] = useState(false)

  // AP State
  const [apMode,          setApMode]          = useState(false)
  const [apDeviceToPlace, setApDeviceToPlace] = useState(null)   // device selected; waiting for map click
  const [editingAP,       setEditingAP]       = useState(null)
  const [selectedAP,      setSelectedAP]      = useState(null)
  const [draggingAP,      setDraggingAP]      = useState(null)

  // Hover tooltip
  const [hoveredSeat, setHoveredSeat] = useState(null)
  const [tooltipPos,  setTooltipPos]  = useState({ x: 0, y: 0 })

  const handlePinHover = (e, seat) => {
    if (!seat) { setHoveredSeat(null); return }
    const rect = wrapperRef.current?.getBoundingClientRect()
    if (!rect) return
    setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
    setHoveredSeat(seat)
  }

  const wrapperRef     = useRef(null)
  const contentRef     = useRef(null)
  const rotateRef      = useRef(null)
  const excelRef       = useRef(null)
  const draggingPinRef     = useRef(null)
  const pointerDownSeatId  = useRef(null)  // seat ID captured at pointerdown for readOnly clicks
  const draggingAPRef      = useRef(null)
  const pointerDownAPIdRef = useRef(null)
  // Ref keeps rotation current inside rAF callbacks without stale-closure issues
  const rotationRef    = useRef(currentMap?.rotation ?? 0)

  // Sync rotation when map changes and schedule a fit once the new image is in the DOM
  useEffect(() => {
    const newRotation = currentMap?.rotation ?? 0
    rotationRef.current = newRotation
    setRotation(newRotation)
    setTransform({ x: 0, y: 0, scale: 1 })
    if (!currentMap?.id) return
    // Retry until both the wrapper and the image have non-zero dimensions.
    // The wrapper may not have its flex height yet (first paint) and the image
    // may still be loading — poll up to 30 frames before giving up.
    let attempts = 0
    let rafId
    const tryFit = () => {
      const wW = wrapperRef.current?.clientWidth
      const wH = wrapperRef.current?.clientHeight
      const cW = rotateRef.current?.offsetWidth
      const cH = rotateRef.current?.offsetHeight
      if (!wW || !wH || !cW || !cH) {
        if (++attempts < 30) rafId = requestAnimationFrame(tryFit)
        return
      }
      fitToPage()
    }
    rafId = requestAnimationFrame(tryFit)
    return () => cancelAnimationFrame(rafId)
  }, [currentMap?.id])

  // Load zones and assignments when map changes
  useEffect(() => {
    if (!currentMap?.id) { setZones([]); setAssignments({}); return }
    getZones(currentMap.id)
      .then(r => setZones(r.data.map(withPoints)))
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
      setZones(r.data.map(withPoints))
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
    const cW = rotateRef.current.offsetWidth   // DOM width  (pre-rotation)
    const cH = rotateRef.current.offsetHeight  // DOM height (pre-rotation)
    if (!cW || !cH || !wW || !wH) return
    // For 90°/270° the visual width and height are swapped vs the DOM dimensions,
    // so we invert them when computing the scale — but keep the centering formula
    // the same (it stays correct after the swap; verified geometrically).
    const r = rotationRef.current
    const isSwapped = r === 90 || r === 270
    const scale = isSwapped ? Math.min(wW / cH, wH / cW) : Math.min(wW / cW, wH / cH)
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
    rotationRef.current = newRotation
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
  const togglePinMode = () => {
    setPinMode(p => !p)
    setPendingPin(null)
    setEditingSeat(null)
    setZoneMode(false)
    setDrawingPolygon([])
    setPolygonCursor(null)
    setPendingZonePolygon(null)
    setSelectedZone(null)
    setEditingZone(null)
    setApMode(false)
    setApDeviceToPlace(null)
    setSelectedAP(null)
    setEditingAP(null)
  }

  const toggleZoneMode = () => {
    setZoneMode(z => !z)
    setDrawingPolygon([])
    setPolygonCursor(null)
    setPendingZonePolygon(null)
    setSelectedZone(null)
    setEditingZone(null)
    setApMode(false)
    setApDeviceToPlace(null)
    setSelectedAP(null)
    setEditingAP(null)
    setPinMode(false)
    setPendingPin(null)
  }

  const toggleAPMode = () => {
    if (!apMode && siteAPs.length === 0) {
      setError('No APs synced for this site. Sync UniFi devices first.')
      return
    }
    setApMode(a => !a)
    setApDeviceToPlace(null)
    setSelectedAP(null)
    setEditingAP(null)
    setZoneMode(false)
    setDrawingPolygon([])
    setPolygonCursor(null)
    setPendingZonePolygon(null)
    setSelectedZone(null)
    setEditingZone(null)
    setPinMode(false)
    setPendingPin(null)
  }

  const handleSaveZone = async (form) => {
    try {
      if (editingZone) {
        await updateZone(editingZone.id, form)
        setEditingZone(null)
        setSelectedZone(null)
      } else if (pendingZonePolygon) {
        const pts  = pendingZonePolygon
        const xs   = pts.map(p => p.x), ys = pts.map(p => p.y)
        await createZone({
          ...form,
          floor_map_id: currentMap.id,
          x1_pct: Math.min(...xs), y1_pct: Math.min(...ys),
          x2_pct: Math.max(...xs), y2_pct: Math.max(...ys),
          points: pts,
        })
        setPendingZonePolygon(null)
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

  // ── AP Handlers ────────────────────────────────────────────────────────────
  const handlePlaceAP = async (x_pct, y_pct) => {
    if (!currentMap || !apDeviceToPlace) return
    try {
      await addAP(currentMap.id, {
        name:            apDeviceToPlace.name || '',
        unifi_device_id: apDeviceToPlace.unifi_device_id || null,
        x_pct, y_pct,
      })
      setApDeviceToPlace(null)   // reset so form shows again for next placement
      const res = await getMap(currentMap.id)
      onMapChange(res.data)
    } catch(e) { setError(e.response?.data?.detail || 'Failed to place AP') }
  }

  const handleSaveAP = async (form) => {
    if (!currentMap || !editingAP) return
    try {
      await updateAP(currentMap.id, editingAP.id, {
        name:            form.name || '',
        unifi_device_id: form.unifi_device_id || null,
        x_pct: editingAP.x_pct,
        y_pct: editingAP.y_pct,
      })
      setEditingAP(null)
      const res = await getMap(currentMap.id)
      onMapChange(res.data)
    } catch(e) { setError(e.response?.data?.detail || 'Failed to update AP') }
  }

  const handleDeleteAP = async (ap) => {
    if (!currentMap) return
    try {
      await deleteAP(currentMap.id, ap.id)
      setSelectedAP(null)
      const res = await getMap(currentMap.id)
      onMapChange(res.data)
    } catch(e) { setError('Failed to delete AP') }
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

    if (!readOnly && selectedZone) {
      // Drag an existing vertex
      const vIdx = e.target.getAttribute?.('data-vertex-handle')
      if (typeof vIdx === 'string') {
        editingVertexRef.current = { zoneId: selectedZone.id, vertexIndex: parseInt(vIdx) }
        if (wrapperRef.current) wrapperRef.current.style.cursor = 'move'
        return
      }

      // Click directly on an edge line → insert vertex at the exact click position
      const eIdx = e.target.getAttribute?.('data-edge-insert')
      if (typeof eIdx === 'string') {
        const insertAfter = parseInt(eIdx)
        const { x_pct, y_pct } = screenToMap(e.clientX, e.clientY)
        const pts    = [...(selectedZone.points || [])]
        const newPts = [...pts.slice(0, insertAfter + 1), { x: x_pct, y: y_pct }, ...pts.slice(insertAfter + 1)]
        setZones(prev => prev.map(z => z.id === selectedZone.id ? { ...z, points: newPts } : z))
        setSelectedZone(prev => prev ? { ...prev, points: newPts } : prev)
        editingVertexRef.current = { zoneId: selectedZone.id, vertexIndex: insertAfter + 1 }
        if (wrapperRef.current) wrapperRef.current.style.cursor = 'move'
        return
      }
    }

    // Zone draw mode: click to place polygon vertices
    if (zoneMode) {
      if (!rotateRef.current || !wrapperRef.current) return
      const { x_pct, y_pct } = screenToMap(e.clientX, e.clientY)
      // Snap to first vertex to close the polygon (need at least 3 vertices)
      if (drawingPolygon.length >= 3) {
        const first = drawingPolygon[0]
        if (Math.hypot(x_pct - first.x, y_pct - first.y) < SNAP_PCT) {
          setPendingZonePolygon([...drawingPolygon])
          setDrawingPolygon([])
          setPolygonCursor(null)
          return
        }
      }
      setDrawingPolygon(prev => [...prev, { x: x_pct, y: y_pct }])
      return
    }

    // apMode: drag existing AP, or place at click coords once a device is selected
    if (apMode && !readOnly) {
      const apPinEl = e.target.closest('[data-ap-id]')
      if (apPinEl) {
        const ap = currentMap.aps?.find(a => a.id === parseInt(apPinEl.dataset.apId))
        if (ap) { draggingAPRef.current = ap; setDraggingAP(ap) }
        return
      }
      if (!apDeviceToPlace) return   // no device selected yet — ignore map clicks
      if (!rotateRef.current || !wrapperRef.current) return
      const { x_pct, y_pct } = screenToMap(e.clientX, e.clientY)
      handlePlaceAP(x_pct, y_pct)
      return
    }

    // Non-apMode: check for AP pin to select/drag (not interactive in readOnly)
    const apPinEl = e.target.closest('[data-ap-id]')
    if (apPinEl && !readOnly) {
      const ap = currentMap.aps?.find(a => a.id === parseInt(apPinEl.dataset.apId))
      if (ap) { draggingAPRef.current = ap; setDraggingAP(ap) }
      return
    }

    const seatPinEl = e.target.closest('[data-seat-id]')
    if (seatPinEl && !readOnly) {
      pointerDownSeatId.current = parseInt(seatPinEl.dataset.seatId)
      return
    }
    pointerDownSeatId.current = null
    setIsPanning(true)
  }

  const handlePointerMove = (e) => {
    if (!currentMap) return

    const dx = e.clientX - panStart.x
    const dy = e.clientY - panStart.y

    // Vertex drag
    if (editingVertexRef.current) {
      if (!rotateRef.current || !wrapperRef.current) return
      const { x_pct, y_pct } = screenToMap(e.clientX, e.clientY)
      const { zoneId, vertexIndex } = editingVertexRef.current
      setZones(prev => prev.map(z => {
        if (z.id !== zoneId || !z.points) return z
        const pts = z.points.map((p, i) => i === vertexIndex ? { x: x_pct, y: y_pct } : p)
        return { ...z, points: pts }
      }))
      setSelectedZone(prev => {
        if (!prev || prev.id !== zoneId || !prev.points) return prev
        const pts = prev.points.map((p, i) => i === vertexIndex ? { x: x_pct, y: y_pct } : p)
        return { ...prev, points: pts }
      })
      return
    }

    // Zone draw mode: track cursor for preview line
    if (zoneMode) {
      if (!rotateRef.current || !wrapperRef.current) return
      const { x_pct, y_pct } = screenToMap(e.clientX, e.clientY)
      setPolygonCursor({ x: x_pct, y: y_pct })
      return
    }

    if (draggingAPRef.current) {
      if (!hasDraggedMap && Math.abs(dx) < 3 && Math.abs(dy) < 3) return
      setHasDraggedMap(true)
      if (!rotateRef.current || !wrapperRef.current) return
      const { x_pct, y_pct } = screenToMap(e.clientX, e.clientY)
      onMapChange({
        ...currentMap,
        aps: currentMap.aps?.map(a => a.id === draggingAPRef.current.id ? { ...a, x_pct, y_pct } : a),
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

    // Finalize vertex drag — save updated polygon points
    if (editingVertexRef.current) {
      const { zoneId } = editingVertexRef.current
      editingVertexRef.current = null
      if (wrapperRef.current) wrapperRef.current.style.cursor = ''
      const zone = zones.find(z => z.id === zoneId)
      if (zone?.points?.length >= 3) {
        try {
          await updateZone(zoneId, { points: zone.points })
        } catch(err) {
          setError('Failed to save zone shape')
          await refreshZones()
        }
      }
      return
    }

    // Zone draw mode — pointer up does nothing (vertices are placed on pointer-down)
    if (zoneMode) return

    if (isPanning) {
      setIsPanning(false)
    }

    if (draggingAPRef.current) {
      const ap = draggingAPRef.current
      if (!hasDraggedMap && e.type === 'pointerup') {
        setSelectedAP(prev => prev?.id === ap.id ? null : (currentMap?.aps?.find(a => a.id === ap.id) || ap))
        setEditingAP(null)
      } else if (hasDraggedMap) {
        const finalAP = currentMap.aps?.find(a => a.id === ap.id)
        if (finalAP) {
          try {
            await updateAP(currentMap.id, finalAP.id, { x_pct: finalAP.x_pct, y_pct: finalAP.y_pct })
          } catch { setError('Failed to save AP position.') }
        }
      }
      draggingAPRef.current = null
      setDraggingAP(null)
    } else if (draggingPinRef.current) {
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
      if (pointerDownAPIdRef.current !== null) {
        const apId = pointerDownAPIdRef.current
        pointerDownAPIdRef.current = null
        const ap = currentMap?.aps?.find(a => a.id === apId)
        if (ap) setSelectedAP(prev => prev?.id === ap.id ? null : ap)
        return
      }
      if (pointerDownSeatId.current !== null) {
        const seatId = pointerDownSeatId.current
        pointerDownSeatId.current = null
        if (readOnly) {
          const seat = currentMap?.seats?.find(s => s.id === seatId)
          if (seat) handleSeatClick(seat)
        }
        return
      }
      if (!rotateRef.current || !wrapperRef.current) return

      const { x_pct, y_pct } = screenToMap(e.clientX, e.clientY)

      // Check if click lands inside any zone → select it (works in readOnly too)
      const clickedZone = zones.find(zone => {
        if (zone.points?.length >= 3) return pointInPolygon(x_pct, y_pct, zone.points)
        const zx1 = Math.min(zone.x1_pct, zone.x2_pct), zx2 = Math.max(zone.x1_pct, zone.x2_pct)
        const zy1 = Math.min(zone.y1_pct, zone.y2_pct), zy2 = Math.max(zone.y1_pct, zone.y2_pct)
        return x_pct >= zx1 && x_pct <= zx2 && y_pct >= zy1 && y_pct <= zy2
      })

      if (clickedZone) {
        setSelectedZone(z => z?.id === clickedZone.id ? null : clickedZone)
        setPendingPin(null)
        setEditingSeat(null)
        onSeatSelect(null)
        return
      }

      // Empty space click → deselect everything; only pinMode creates new pins
      setSelectedZone(null)
      if (readOnly) { onSeatSelect(null); return }
      if (apMode || !pinMode) return

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

  // ── PNG Export ─────────────────────────────────────────────────────────────
  // Renders the floor plan + zone overlays + seat pins onto an offscreen canvas
  // then triggers a PNG download.  Each pin shows seat_label.slice(-6) so that
  const handleExportPNG = async () => {
    if (!currentMap) return
    setExporting(true)
    try {
      const canvas = document.createElement('canvas')
      const ctx    = canvas.getContext('2d')

      // ── Draw base map ──────────────────────────────────────────────────────
      if (isPdfMap) {
        // Use the already-loaded pdfjs worker to rasterise page 1
        const loadingTask = pdfjs.getDocument(`/uploads/${currentMap.filename}`)
        const pdf  = await loadingTask.promise
        const page = await pdf.getPage(1)
        const viewport = page.getViewport({ scale: 2 })  // 2× for quality
        canvas.width  = viewport.width
        canvas.height = viewport.height
        await page.render({ canvasContext: ctx, viewport }).promise
      } else {
        const img = await new Promise((resolve, reject) => {
          const i = new Image()
          i.crossOrigin = 'anonymous'
          i.onload  = () => resolve(i)
          i.onerror = reject
          i.src = `/uploads/${currentMap.filename}`
        })
        canvas.width  = img.naturalWidth
        canvas.height = img.naturalHeight
        ctx.drawImage(img, 0, 0)
      }

      const W = canvas.width
      const H = canvas.height
      // Scale pins and text relative to image size so they look right
      // regardless of whether the floor plan is 800px or 8000px wide.
      const ref   = Math.max(W, H) / 1000   // 1.0 at 1000px, 4.0 at 4000px

      // ── Draw zone overlays ─────────────────────────────────────────────────
      zones.forEach(zone => {
        const x1 = Math.min(zone.x1_pct, zone.x2_pct) / 100 * W
        const y1 = Math.min(zone.y1_pct, zone.y2_pct) / 100 * H
        const zW = Math.abs(zone.x2_pct - zone.x1_pct) / 100 * W
        const zH = Math.abs(zone.y2_pct - zone.y1_pct) / 100 * H

        ctx.save()
        ctx.globalAlpha = 0.15
        ctx.fillStyle   = zone.color
        ctx.fillRect(x1, y1, zW, zH)
        ctx.globalAlpha = 1
        ctx.strokeStyle = zone.color
        ctx.lineWidth   = Math.max(2, ref * 2)
        ctx.setLineDash([ref * 8, ref * 4])
        ctx.strokeRect(x1, y1, zW, zH)
        ctx.setLineDash([])

        ctx.restore()
      })

      // ── Draw seat pins ─────────────────────────────────────────────────────
      currentMap.seats?.forEach(seat => {
        const sx       = (seat.x_pct / 100) * W
        const sy       = (seat.y_pct / 100) * H
        const label    = seat.seat_label
        const assigned = assignments[seat.id]
        const pinColor = assigned ? '#22c55e' : '#06b6d4'
        const dotR     = Math.max(5, ref * 4)   // small dot — doesn't grow with label length
        const lfs      = Math.max(6, ref * 5.5) // label tag font size
        const pad      = Math.max(3, ref * 2.5)

        ctx.save()

        // ── Small dot ──
        ctx.shadowColor   = 'rgba(0,0,0,0.55)'
        ctx.shadowBlur    = dotR * 0.6
        ctx.shadowOffsetY = dotR * 0.15
        ctx.beginPath()
        ctx.arc(sx, sy, dotR, 0, 2 * Math.PI)
        ctx.fillStyle = pinColor
        ctx.fill()
        ctx.shadowBlur    = 0
        ctx.shadowOffsetY = 0
        ctx.strokeStyle = 'rgba(255,255,255,0.7)'
        ctx.lineWidth   = Math.max(1, dotR * 0.25)
        ctx.stroke()

        // ── Seat label pill below the dot ──
        ctx.font = `bold ${lfs}px monospace`
        const lw  = ctx.measureText(label).width
        const tagW = lw + pad * 2
        const tagH = lfs + pad * 2
        const tagX = sx - tagW / 2
        const tagY = sy + dotR + Math.max(3, ref * 2)

        // Pill background
        ctx.fillStyle = 'rgba(0,0,0,0.72)'
        const r = Math.max(3, tagH * 0.35)
        ctx.beginPath()
        ctx.roundRect(tagX, tagY, tagW, tagH, r)
        ctx.fill()

        // Label text
        ctx.fillStyle    = '#fff'
        ctx.textAlign    = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(label, sx, tagY + tagH / 2)

        // ── Employee name tag below the label pill (if assigned) ──
        if (assigned?.user_display_name || assigned?.user_email) {
          const name  = (assigned.user_display_name || assigned.user_email).slice(0, 28)
          const nfs   = Math.max(5, ref * 4.5)
          ctx.font    = `${nfs}px sans-serif`
          const nw    = ctx.measureText(name).width
          const nTagW = nw + pad * 2
          const nTagH = nfs + pad * 2
          const nTagX = sx - nTagW / 2
          const nTagY = tagY + tagH + Math.max(2, ref * 1.5)

          ctx.fillStyle = 'rgba(255,255,255,0.88)'
          ctx.beginPath()
          ctx.roundRect(nTagX, nTagY, nTagW, nTagH, Math.max(2, nTagH * 0.3))
          ctx.fill()

          ctx.fillStyle    = '#111'
          ctx.textBaseline = 'middle'
          ctx.fillText(name, sx, nTagY + nTagH / 2)
        }

        ctx.restore()
      })

      // ── Trigger download ───────────────────────────────────────────────────
      const safeName = currentMap.name.replace(/[^a-z0-9._-]/gi, '_')
      const link = document.createElement('a')
      link.download = `${safeName}-seats.png`
      link.href = canvas.toDataURL('image/png')
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)

    } catch(e) {
      setError('Export failed: ' + (e.message || 'unknown error'))
    } finally {
      setExporting(false)
    }
  }

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
          {(currentMap.aps?.length || 0) > 0 && !apMode && (
            <span className="badge" style={{ background: 'rgba(99,102,241,0.15)', color: '#6366f1', border: '1px solid rgba(99,102,241,0.35)' }}>
              {currentMap.aps.length} AP{currentMap.aps.length !== 1 ? 's' : ''}
            </span>
          )}
          {!readOnly && (
            <>
              <button className="btn btn-ghost" style={{ fontSize: '0.75rem', padding: '3px 10px' }} onClick={() => handleRotate('ccw')} title="Rotate 90° counter-clockwise">↺ CCW</button>
              <button className="btn btn-ghost" style={{ fontSize: '0.75rem', padding: '3px 10px' }} onClick={() => handleRotate('cw')}  title="Rotate 90° clockwise">↻ CW</button>
              {rotation !== 0 && <span style={{ fontSize: '0.7rem', color: 'var(--cyan)' }}>{rotation}°</span>}
              <button
                className={`btn ${pinMode ? 'btn-primary' : 'btn-ghost'}`}
                style={{ fontSize: '0.75rem', padding: '3px 10px', ...(pinMode ? {} : { borderColor: 'var(--cyan)', color: 'var(--cyan)' }) }}
                onClick={togglePinMode}
                title={pinMode ? 'Cancel pin placement' : 'Place a seat pin on the map'}
              >
                {pinMode ? '✕ Cancel' : '📍 Place Pin'}
              </button>
              <button
                className={`btn ${zoneMode ? 'btn-primary' : 'btn-ghost'}`}
                style={{ fontSize: '0.75rem', padding: '3px 10px', ...(zoneMode ? {} : { borderColor: '#a855f7', color: '#a855f7' }) }}
                onClick={toggleZoneMode}
                title={zoneMode ? 'Cancel zone drawing' : 'Draw a zone overlay'}
              >
                {zoneMode ? '✕ Cancel' : '▭ Draw Zone'}
              </button>
              <button
                className={`btn ${apMode ? 'btn-primary' : 'btn-ghost'}`}
                style={{ fontSize: '0.75rem', padding: '3px 10px', ...(apMode ? {} : { borderColor: '#6366f1', color: '#6366f1' }) }}
                onClick={toggleAPMode}
                title={apMode ? 'Cancel AP placement' : 'Place AP on map'}
              >
                {apMode ? '✕ Cancel' : '📡 Place AP'}
              </button>
            </>
          )}
          <button
            className="btn btn-ghost"
            style={{ fontSize: '0.75rem', padding: '3px 10px' }}
            onClick={handleExportPNG}
            disabled={exporting}
            title="Export map as PNG with seat labels"
          >
            {exporting ? '⏳ Exporting…' : '⬇ Export PNG'}
          </button>
        </div>
        <span className="text-xs text-muted" style={{ textAlign: 'right' }}>
          {zoneMode
            ? drawingPolygon.length === 0
              ? 'Click to place first vertex'
              : drawingPolygon.length < 3
                ? `${drawingPolygon.length} point${drawingPolygon.length > 1 ? 's' : ''} — keep clicking to add vertices`
                : 'Click first point (green) or press Enter to close · Escape to cancel'
            : apMode
              ? apDeviceToPlace
                ? `Click on map to place ${apDeviceToPlace.name || 'AP'}`
                : 'Select an AP from the panel below'
              : pinMode
                ? 'Click on map to place a pin'
                : readOnly
                  ? 'Scroll to zoom · Drag to pan · Click pin to select'
                  : 'Scroll to zoom · Drag to pan · Click a pin to select it'}
        </span>
      </div>

      {/* Canvas */}
      <div
        ref={wrapperRef}
        className="map-canvas-wrapper"
        style={{
          ...(fullScreen ? { flex: 1, height: 'auto' } : {}),
          cursor: (zoneMode || apMode || pinMode) ? 'crosshair' : undefined,
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
                <Page pageNumber={1} renderTextLayer={false} renderAnnotationLayer={false} onRenderSuccess={() => requestAnimationFrame(fitToPage)} />
              </Document>
            ) : (
              <img key={currentMap.id} src={`/uploads/${currentMap.filename}`} alt="Floor plan" onLoad={() => requestAnimationFrame(fitToPage)} />
            )}

            {/* Zone overlay — rendered above image, below seat pins */}
            <ZoneOverlay
              zones={zones}
              selectedZoneId={selectedZone?.id}
              drawingPolygon={drawingPolygon}
              polygonCursor={polygonCursor}
              readOnly={readOnly}
              highlightedTypes={highlightedTypes}
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
                portStatus={portStatuses[seat.id]}
                onPointerDown={readOnly ? undefined : (e, s) => { draggingPinRef.current = s; setDraggingPin(s) }}
                onHover={handlePinHover}
              />
            ))}
            {currentMap.aps?.map(ap => (
              <APPin
                key={ap.id}
                ap={ap}
                selected={selectedAP?.id === ap.id}
                onPointerDown={readOnly ? undefined : (e, a) => { draggingAPRef.current = a; setDraggingAP(a) }}
              />
            ))}
          </div>
        </div>

        {/* ── Hover tooltip — outside transform chain, inside wrapper ── */}
        {hoveredSeat && (
          <div style={{
            position: 'absolute',
            left: tooltipPos.x + 14,
            top:  tooltipPos.y - 10,
            zIndex: 200,
            pointerEvents: 'none',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
            padding: '7px 11px',
            minWidth: 140,
            maxWidth: 260,
          }}>
            <div style={{ fontWeight: 700, fontSize: '0.82rem', color: 'var(--text-primary)', marginBottom: 2 }}>
              {hoveredSeat.seat_label}
            </div>
            {assignments[hoveredSeat.id] && (
              <div style={{ fontSize: '0.75rem', color: '#22c55e', marginBottom: 2 }}>
                👤 {assignments[hoveredSeat.id].user_display_name || assignments[hoveredSeat.id].user_email}
              </div>
            )}
            {hoveredSeat.switch_name && (
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                🔌 {hoveredSeat.switch_name} · {hoveredSeat.port}
              </div>
            )}
            {portClients[hoveredSeat.id] ? (
              <div style={{ marginTop: 4, paddingTop: 4, borderTop: '1px solid var(--border)' }}>
                <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>
                  Connected Device
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-primary)', fontWeight: 600 }}>
                  💻 {portClients[hoveredSeat.id].name || portClients[hoveredSeat.id].hostname || portClients[hoveredSeat.id].mac}
                </div>
                {portClients[hoveredSeat.id].ip && (
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    {portClients[hoveredSeat.id].ip}
                  </div>
                )}
                {portClients[hoveredSeat.id].mac && (
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                    {portClients[hoveredSeat.id].mac}
                  </div>
                )}
              </div>
            ) : (
              !assignments[hoveredSeat.id] && (
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Unassigned</div>
              )
            )}
          </div>
        )}
      </div>
    </>
  )

  // ── Shared bottom forms ────────────────────────────────────────────────────
  const bottomForms = (
    <>
      {pendingZonePolygon && (
        <ZoneConfigForm
          onSave={handleSaveZone}
          onCancel={() => { setPendingZonePolygon(null); setDrawingPolygon([]); setPolygonCursor(null) }}
        />
      )}
      {editingZone && (
        <ZoneConfigForm
          initial={editingZone}
          onSave={handleSaveZone}
          onCancel={() => setEditingZone(null)}
        />
      )}
      {selectedZone && !editingZone && !pendingZonePolygon && (
        <ZoneDetailPanel
          zone={selectedZone}
          seats={currentMap?.seats || []}
          assignments={assignments}
          readOnly={readOnly}
          onAssign={handleAssign}
          onUnassign={handleUnassign}
          onEdit={() => { setEditingZone(selectedZone) }}
          onDelete={() => handleDeleteZone(selectedZone)}
          onClose={() => setSelectedZone(null)}
        />
      )}
      {(pendingPin || editingSeat) && !pendingZonePolygon && !editingZone && (
        <SeatForm
          switches={switches}
          onSave={handleSaveSeat}
          onCancel={() => { setPendingPin(null); setEditingSeat(null) }}
          initial={editingSeat ? { seat_label: editingSeat.seat_label, port: editingSeat.port, switch_id: editingSeat.switch_id || '' } : null}
        />
      )}
      {apMode && !apDeviceToPlace && !editingAP && (
        <APForm
          siteAPs={siteAPs.filter(d => !currentMap?.aps?.some(a => a.unifi_device_id === d.id))}
          onSave={(form) => setApDeviceToPlace(form)}
          onCancel={toggleAPMode}
          initial={null}
        />
      )}
      {editingAP && (
        <APForm
          siteAPs={siteAPs.filter(d => !currentMap?.aps?.some(a => a.unifi_device_id === d.id && a.id !== editingAP.id))}
          onSave={handleSaveAP}
          onCancel={() => setEditingAP(null)}
          initial={{ name: editingAP.name, unifi_device_id: editingAP.unifi_device_id }}
        />
      )}
      {selectedAP && !editingAP && !pendingAP && (
        <div className="alert alert-info" style={{ justifyContent: 'space-between' }}>
          <span>
            📡 <strong>{selectedAP.name || selectedAP.device_name || 'AP'}</strong>
            {selectedAP.device_ip    && <span style={{ marginLeft: 8, color: 'var(--text-muted)', fontSize: '0.8rem' }}>{selectedAP.device_ip}</span>}
            {selectedAP.device_model && <span style={{ marginLeft: 8, color: 'var(--text-muted)', fontSize: '0.8rem' }}>{selectedAP.device_model}</span>}
            {selectedAP.device_state && (
              <span style={{ marginLeft: 8, fontSize: '0.8rem', color: selectedAP.device_state === 'online' ? '#22c55e' : '#ef4444' }}>
                ● {selectedAP.device_state}
              </span>
            )}
          </span>
          <div className="flex gap-2">
            {!readOnly && (
              <>
                <button className="btn btn-ghost" style={{ fontSize: '0.75rem', padding: '4px 10px' }}
                  onClick={() => { setEditingAP(selectedAP); setSelectedAP(null) }}>
                  ✏️ Edit
                </button>
                <button className="btn btn-danger" style={{ fontSize: '0.75rem', padding: '4px 10px' }}
                  onClick={() => handleDeleteAP(selectedAP)}>
                  🗑️ Delete
                </button>
              </>
            )}
            <button className="btn btn-ghost" style={{ fontSize: '0.75rem', padding: '4px 10px' }} onClick={() => setSelectedAP(null)}>✕</button>
          </div>
        </div>
      )}
      {!fullScreen && selectedSeat && !editingSeat && !pendingPin && !selectedZone && !pendingZonePolygon && !editingZone && (
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

        {/* Map + optional seat detail panel */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'row', minHeight: 0, overflow: 'hidden' }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {mapCanvas}
          </div>

          {/* Seat detail panel — right side */}
          {selectedSeat && !pendingZonePolygon && !editingZone && (
            <div style={{
              width: 272,
              flexShrink: 0,
              borderLeft: '1px solid var(--border)',
              background: 'var(--bg-surface)',
              display: 'flex',
              flexDirection: 'column',
              overflowY: 'auto',
              padding: '16px',
              gap: 14,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  Seat Details
                </span>
                <div className="flex gap-1">
                  {!readOnly && (
                    <>
                      <button
                        className="btn btn-ghost"
                        style={{ padding: '2px 8px', fontSize: '0.72rem' }}
                        onClick={() => handleStartEditSeat(selectedSeat)}
                      >
                        ✏️ Edit
                      </button>
                      <button
                        className="btn btn-danger"
                        style={{ padding: '2px 8px', fontSize: '0.72rem' }}
                        onClick={() => handleDeleteSeat(selectedSeat)}
                      >
                        🗑️ Delete
                      </button>
                    </>
                  )}
                  <button
                    className="btn btn-ghost"
                    style={{ padding: '2px 8px', fontSize: '0.72rem' }}
                    onClick={() => onSeatSelect(null)}
                  >
                    ✕
                  </button>
                </div>
              </div>

              <div>
                <div style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Seat Label</div>
                <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--cyan)' }}>📍 {selectedSeat.seat_label}</div>
              </div>

              {selectedSeat.switch_name && (
                <div>
                  <div style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Switch</div>
                  <div style={{ fontSize: '0.82rem', fontFamily: 'monospace', color: 'var(--text-primary)', wordBreak: 'break-all' }}>{selectedSeat.switch_name}</div>
                </div>
              )}

              {selectedSeat.port && (
                <div>
                  <div style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Port</div>
                  <div style={{ fontSize: '0.82rem', fontFamily: 'monospace', color: 'var(--text-primary)', wordBreak: 'break-all' }}>{selectedSeat.port}</div>
                </div>
              )}

              <div>
                <div style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Assigned To</div>
                {assignments[selectedSeat.id] ? (
                  <div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#22c55e' }}>
                      👤 {assignments[selectedSeat.id].user_display_name || assignments[selectedSeat.id].user_email}
                    </div>
                    {assignments[selectedSeat.id].user_display_name && assignments[selectedSeat.id].user_email && (
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>{assignments[selectedSeat.id].user_email}</div>
                    )}
                  </div>
                ) : (
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Unassigned</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Forms pinned at bottom */}
        {(pendingPin || editingSeat || pendingZonePolygon || editingZone || selectedZone || (apMode && !apDeviceToPlace) || editingAP || selectedAP) && (
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
