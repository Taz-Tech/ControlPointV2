import { useState, useEffect, useCallback, useRef } from 'react'
import { getConferenceRooms, getRoomSchedule, getRoomConfigs, getMap } from '../api/client.js'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(dtStr) {
  if (!dtStr) return ''
  try {
    return new Date(dtStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch { return '' }
}

function formatDuration(startStr, endStr) {
  if (!startStr || !endStr) return ''
  const diff = (new Date(endStr) - new Date(startStr)) / 60000
  if (diff < 60) return `${diff}m`
  const h = Math.floor(diff / 60), m = diff % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusBadge({ status, label }) {
  const colors = {
    available:     { bg: 'rgba(63,185,80,0.12)',  color: '#3fb950', dot: '#3fb950' },
    in_use:        { bg: 'rgba(248,81,73,0.12)',   color: '#f85149', dot: '#f85149' },
    starting_soon: { bg: 'rgba(210,153,34,0.15)',  color: '#d9a520', dot: '#d9a520' },
  }
  const s = colors[status] || colors.available
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      fontSize: '0.7rem', fontWeight: 700, padding: '3px 9px',
      borderRadius: 20, background: s.bg, color: s.color,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.dot, flexShrink: 0 }} />
      {label}
    </span>
  )
}

function EventRow({ event, isCurrent }) {
  if (!event) return null
  const label = event.isPrivate ? 'Private Meeting' : (event.subject || 'Meeting')
  return (
    <div style={{
      padding: '6px 8px', borderRadius: 6, fontSize: '0.75rem',
      background: isCurrent ? 'rgba(248,81,73,0.08)' : 'rgba(255,255,255,0.04)',
      border: `1px solid ${isCurrent ? 'rgba(248,81,73,0.2)' : 'var(--border)'}`,
    }}>
      <div style={{ fontWeight: 600, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
      <div style={{ color: 'var(--text-muted)', display: 'flex', gap: 8 }}>
        <span>{formatTime(event.start)} – {formatTime(event.end)}</span>
        <span>({formatDuration(event.start, event.end)})</span>
        {event.organizer && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>· {event.organizer}</span>}
      </div>
    </div>
  )
}

// ── Seat Map Modal ────────────────────────────────────────────────────────────

function SeatMapModal({ seat, mapId, onClose }) {
  const [mapData,   setMapData]   = useState(null)
  const [loading,   setLoading]   = useState(true)
  const [ready,     setReady]     = useState(false)  // image/pdf has rendered
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 })
  const [isPanning, setIsPanning] = useState(false)
  const [panStart,  setPanStart]  = useState({ x: 0, y: 0 })

  const wrapperRef  = useRef(null)
  const contentRef  = useRef(null)  // the div containing the image + pins

  useEffect(() => {
    getMap(mapId)
      .then(r => setMapData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [mapId])

  // Once the image/PDF renders, center on the seat
  useEffect(() => {
    if (!ready) return
    // Defer two frames so the DOM has painted and has real dimensions
    const id = requestAnimationFrame(() => requestAnimationFrame(() => centerOnSeat()))
    return () => cancelAnimationFrame(id)
  }, [ready])

  const centerOnSeat = () => {
    if (!wrapperRef.current || !contentRef.current) return
    const wW   = wrapperRef.current.clientWidth
    const wH   = wrapperRef.current.clientHeight
    const imgW = contentRef.current.offsetWidth
    const imgH = contentRef.current.offsetHeight
    if (!wW || !wH || !imgW || !imgH) return

    // Seat position in un-rotated image space
    const sx = (seat.x_pct / 100) * imgW
    const sy = (seat.y_pct / 100) * imgH

    // Apply the same rotation the CSS uses (around image center) to get visual position
    const rot = (mapData?.rotation ?? 0) * Math.PI / 180
    const cx  = imgW / 2, cy = imgH / 2
    const dx  = sx - cx,  dy = sy - cy
    const vx  = dx * Math.cos(rot) - dy * Math.sin(rot) + cx
    const vy  = dx * Math.sin(rot) + dy * Math.cos(rot) + cy

    const scale = Math.min(wW / imgW, wH / imgH) * 2.5
    setTransform({ scale, x: wW / 2 - vx * scale, y: wH / 2 - vy * scale })
  }

  // Wheel zoom
  useEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    const onWheel = (e) => {
      e.preventDefault()
      setTransform(prev => {
        const factor   = -e.deltaY * 0.001
        const newScale = Math.min(Math.max(prev.scale * (1 + factor), 0.2), 8)
        const rect     = el.getBoundingClientRect()
        const mx = e.clientX - rect.left
        const my = e.clientY - rect.top
        const ratio = newScale / prev.scale
        return { scale: newScale, x: mx - (mx - prev.x) * ratio, y: my - (my - prev.y) * ratio }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [loading])

  const onPointerDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    setIsPanning(true)
    setPanStart({ x: e.clientX, y: e.clientY })
  }
  const onPointerMove = (e) => {
    if (!isPanning) return
    setTransform(prev => ({ ...prev, x: prev.x + e.clientX - panStart.x, y: prev.y + e.clientY - panStart.y }))
    setPanStart({ x: e.clientX, y: e.clientY })
  }
  const onPointerUp = (e) => { try { e.currentTarget.releasePointerCapture(e.pointerId) } catch {} setIsPanning(false) }

  const isPdf = mapData?.filename?.toLowerCase().endsWith('.pdf')
  const rotation = mapData?.rotation ?? 0

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(4px)', display: 'flex', flexDirection: 'column' }}
      onClick={onClose}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}
        onClick={e => e.stopPropagation()}>
        <div>
          <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>📍 {seat.label}</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>
            {mapData?.name}{seat.switch_name ? ` · ${seat.switch_name}` : ''}{seat.port ? ` · ${seat.port}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" style={{ fontSize: '0.78rem' }} onClick={e => { e.stopPropagation(); centerOnSeat() }}>⊕ Re-center</button>
          <button className="btn btn-ghost" style={{ fontSize: '0.78rem' }} onClick={onClose}>✕ Close</button>
        </div>
      </div>

      {/* Map area */}
      <div ref={wrapperRef}
        style={{ flex: 1, overflow: 'hidden', cursor: isPanning ? 'grabbing' : 'grab', position: 'relative', background: 'var(--bg-base)' }}
        onClick={e => e.stopPropagation()}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}>

        {/* Loading */}
        {(loading || (!ready && mapData)) && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--text-muted)', zIndex: 10 }}>
            <div className="spinner" /> Loading map…
          </div>
        )}

        {/* Map content */}
        {mapData && (
          <div style={{
            position: 'absolute', transformOrigin: '0 0',
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          }}>
            {/* Rotation wrapper */}
            <div ref={contentRef} style={{ transform: rotation ? `rotate(${rotation}deg)` : undefined, transformOrigin: '50% 50%', position: 'relative', display: 'inline-block' }}>
              {isPdf ? (
                <Document file={`/uploads/${mapData.filename}`} loading="">
                  <Page pageNumber={1} renderTextLayer={false} renderAnnotationLayer={false}
                    onRenderSuccess={() => setReady(true)} />
                </Document>
              ) : (
                <img src={`/uploads/${mapData.filename}`} alt="Floor plan"
                  style={{ display: 'block', userSelect: 'none', maxWidth: 'none' }}
                  onLoad={() => setReady(true)} draggable={false} />
              )}

              {/* Pins */}
              {ready && mapData.seats?.map(s => {
                const isTarget = s.id === seat.id
                return (
                  <div key={s.id} style={{
                    position: 'absolute', left: `${s.x_pct}%`, top: `${s.y_pct}%`,
                    transform: 'translate(-50%, -100%)',
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    zIndex: isTarget ? 20 : 5,
                    opacity: isTarget ? 1 : 0.25,
                    pointerEvents: 'none',
                  }}>
                    {isTarget && (
                      <div style={{
                        background: 'var(--bg-surface)', border: '1px solid var(--orange)',
                        borderRadius: 4, padding: '2px 8px', fontSize: '0.7rem', fontWeight: 700,
                        color: 'var(--orange)', whiteSpace: 'nowrap', marginBottom: 4,
                        boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
                        transform: rotation ? `rotate(${-rotation}deg)` : undefined,
                      }}>{s.seat_label}</div>
                    )}
                    <div style={{
                      width: isTarget ? 24 : 14, height: isTarget ? 24 : 14, borderRadius: '50%',
                      background: isTarget ? 'var(--orange)' : 'var(--cyan)',
                      boxShadow: isTarget ? '0 0 0 5px rgba(255,150,50,0.35), 0 0 16px rgba(255,150,50,0.5)' : 'none',
                      border: '2px solid rgba(255,255,255,0.4)',
                    }} />
                    <div style={{ width: 2, height: isTarget ? 10 : 5, background: isTarget ? 'var(--orange)' : 'var(--cyan)', opacity: 0.8 }} />
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function RoomCard({ room, onClick, selected }) {
  const hasLogitech = room.logitech?.matched
  const deviceCount = room.logitech?.devices?.length ?? 0

  return (
    <div
      onClick={() => onClick(room)}
      style={{
        background: 'var(--bg-elevated)',
        border: `1px solid ${selected ? 'var(--cyan)' : 'var(--border)'}`,
        borderRadius: 'var(--radius-md)',
        padding: 14,
        cursor: 'pointer',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        boxShadow: selected ? '0 0 0 1px var(--cyan)' : 'none',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{room.name}</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>
            {[room.building, room.floor ? `Floor ${room.floor}` : null, room.capacity ? `${room.capacity} people` : null].filter(Boolean).join(' · ')}
            {room.config?.site_name && (
              <span style={{ color: 'var(--cyan)', fontWeight: 600 }}> · {room.config.site_name}</span>
            )}
          </div>
        </div>
        <StatusBadge status={room.availability} label={room.availabilityLabel} />
      </div>

      {/* Current event */}
      {room.currentEvent && <EventRow event={room.currentEvent} isCurrent />}

      {/* Next event if available */}
      {!room.currentEvent && room.upcomingEvent && (
        <div>
          <div style={{ fontSize: '0.67rem', color: 'var(--text-muted)', marginBottom: 4 }}>NEXT</div>
          <EventRow event={room.upcomingEvent} isCurrent={false} />
        </div>
      )}

      {/* No events */}
      {!room.currentEvent && !room.upcomingEvent && (
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>No more meetings today</div>
      )}

      {/* Logitech equipment status */}
      {hasLogitech && deviceCount > 0 && (() => {
        const offlineDevices = room.logitech.devices.filter(d => d.status && d.status !== 'Online' && d.status !== 'In Use' && d.status !== 'InUse')
        const offlineCount = offlineDevices.length
        const isAllOnline = offlineCount === 0
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.72rem', fontWeight: 600,
            color: isAllOnline ? '#3fb950' : '#f85149' }}>
            <span>{isAllOnline ? '●' : '⚠'}</span>
            {isAllOnline
              ? `${deviceCount} AV device${deviceCount > 1 ? 's' : ''} online`
              : `${offlineCount} device${offlineCount > 1 ? 's' : ''} offline`}
          </div>
        )
      })()}
      {hasLogitech && deviceCount === 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.72rem', color: 'var(--text-muted)' }}>
          <span>●</span> No devices linked
        </div>
      )}
    </div>
  )
}

function RoomDetailPanel({ room, onClose }) {
  const [schedule,  setSchedule]  = useState(null)
  const [loading,   setLoading]   = useState(true)
  const [showMap,   setShowMap]   = useState(false)

  useEffect(() => {
    if (!room) return
    setLoading(true)
    getRoomSchedule(room.email)
      .then(r => setSchedule(r.data))
      .catch(() => setSchedule(null))
      .finally(() => setLoading(false))
  }, [room?.email])

  if (!room) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: '1rem' }}>{room.name}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{room.email}</div>
        </div>
        <button className="btn btn-ghost" style={{ fontSize: '0.75rem', padding: '4px 10px' }} onClick={onClose}>✕ Close</button>
      </div>

      {/* Room info */}
      <div className="card" style={{ padding: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {[
            ['Building',   room.building  || '—'],
            ['Floor',      room.floor     || '—'],
            ['Capacity',   room.capacity  ? `${room.capacity} people` : '—'],
            ['Status',     room.availabilityLabel],
            ['Accessible', room.isWheelChairAccessible ? 'Yes' : 'No'],
            ['Phone',      room.phone     || '—'],
            ...(room.config?.site_name       ? [['Site',   room.config.site_name]]       : []),
            ...(room.config?.seat?.port      ? [['Port',   room.config.seat.port]]        : []),
            ...(room.config?.seat?.switch_name ? [['Switch', room.config.seat.switch_name]] : []),
          ].map(([label, val]) => (
            <div key={label}>
              <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</div>
              <div style={{ fontSize: '0.82rem', marginTop: 2 }}>{val}</div>
            </div>
          ))}
        </div>

        {/* Seat location — clickable to open map */}
        {room.config?.seat?.label && room.config?.seat?.map_id && (
          <button
            onClick={() => setShowMap(true)}
            style={{
              marginTop: 10, width: '100%', display: 'flex', alignItems: 'center', gap: 8,
              background: 'rgba(33,212,253,0.06)', border: '1px solid rgba(33,212,253,0.2)',
              borderRadius: 8, padding: '8px 12px', cursor: 'pointer', transition: 'background 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(33,212,253,0.12)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(33,212,253,0.06)'}
          >
            <span style={{ fontSize: '1rem' }}>📍</span>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--cyan)' }}>{room.config.seat.label}</div>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Click to view on floor map</div>
            </div>
            <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--text-muted)' }}>↗</span>
          </button>
        )}

        {showMap && room.config?.seat && (
          <SeatMapModal
            seat={room.config.seat}
            mapId={room.config.seat.map_id}
            onClose={() => setShowMap(false)}
          />
        )}
      </div>

      {/* Today's schedule */}
      <div className="card" style={{ padding: 14 }}>
        <div style={{ fontSize: '0.75rem', fontWeight: 700, marginBottom: 10 }}>Today's Schedule</div>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            <div className="spinner" /> Loading…
          </div>
        ) : !schedule?.events?.length ? (
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No meetings scheduled today</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {schedule.events.map((ev, i) => (
              <EventRow key={i} event={ev} isCurrent={room.currentEvent?.start === ev.start} />
            ))}
          </div>
        )}
      </div>

      {/* Logitech AV equipment */}
      {room.logitech?.matched && (
        <div className="card" style={{ padding: 14 }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, marginBottom: 10 }}>AV Equipment</div>
          {room.logitech.devices?.length === 0 ? (
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No devices linked in Logitech Sync</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {room.logitech.devices.map((d, i) => (
                <div key={d.id || i} style={{ background: 'var(--bg-base)', borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: '0.82rem' }}>{d.name || d.model || 'Device'}</span>
                    <span style={{
                      fontSize: '0.65rem', fontWeight: 600, padding: '2px 7px', borderRadius: 10,
                      background: (d.status === 'online' || d.status === 'Online') ? 'rgba(63,185,80,0.12)'
                               : (d.status === 'In Use' || d.status === 'InUse') ? 'rgba(88,166,255,0.12)'
                               : 'rgba(255,255,255,0.06)',
                      color: (d.status === 'online' || d.status === 'Online') ? '#3fb950'
                           : (d.status === 'In Use' || d.status === 'InUse') ? '#58a6ff'
                           : 'var(--text-muted)',
                    }}>
                      {(d.status === 'In Use' || d.status === 'InUse') ? 'In Use — Meeting Active' : (d.status || 'Unknown')}
                    </span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 12px', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    {d.serialNumber && <span>S/N: {d.serialNumber}</span>}
                    {d.firmware     && <span>FW: {d.firmware}</span>}
                    {d.ip           && <span>IP: {d.ip}</span>}
                    {d.mac          && <span>MAC: {d.mac}</span>}
                    {d.hostName     && <span style={{ gridColumn: 'span 2' }}>Host: {d.hostName}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ConferenceRooms() {
  const [data,     setData]     = useState(null)
  const [configs,  setConfigs]  = useState({})   // email → config
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)
  const [selected, setSelected] = useState(null)
  const [filter,   setFilter]   = useState('all')
  const [search,   setSearch]   = useState('')
  const [date,     setDate]     = useState(todayStr())
  const refreshRef = useRef(null)

  const load = useCallback(async (d) => {
    setLoading(true)
    setError(null)
    try {
      const [roomsRes, configsRes] = await Promise.all([
        getConferenceRooms(d || date),
        getRoomConfigs(),
      ])
      const configMap = {}
      configsRes.data.forEach(c => { configMap[c.room_email] = c })
      setData(roomsRes.data)
      setConfigs(configMap)
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to load conference rooms')
    } finally {
      setLoading(false)
    }
  }, [date])

  useEffect(() => {
    load()
    refreshRef.current = setInterval(() => load(), 5 * 60 * 1000)
    return () => clearInterval(refreshRef.current)
  }, [load])

  const handleDateChange = (d) => {
    setDate(d)
    setSelected(null)
    load(d)
  }

  // Merge configs into rooms
  const rooms = (data?.rooms || [])
    .map(r => ({ ...r, config: configs[r.email] || null }))
    .filter(r => {
      if (filter !== 'all' && r.availability !== filter) return false
      if (search) {
        const q = search.toLowerCase()
        return (r.name || '').toLowerCase().includes(q) ||
               (r.building || '').toLowerCase().includes(q)
      }
      return true
    })

  // Group by building
  const byBuilding = rooms.reduce((acc, r) => {
    const key = r.building || 'Other'
    if (!acc[key]) acc[key] = []
    acc[key].push(r)
    return acc
  }, {})

  return (
    <div style={{ display: 'flex', gap: 20, height: '100%', minHeight: 0 }}>

      {/* Left panel */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>Conference Rooms</h2>
            {data && (
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 3 }}>
                {data.total} rooms · {data.available} available · {data.inUse} in use · {data.startingSoon} starting soon
                {data.logitechConnected && !data.logitechError && <span style={{ color: 'var(--cyan)', marginLeft: 8 }}>● Logitech Sync</span>}
                {data.logitechConnected && data.logitechError && <span style={{ color: '#f85149', marginLeft: 8 }}>⚠ Logitech: {data.logitechError}</span>}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="date"
              className="input"
              value={date}
              onChange={e => handleDateChange(e.target.value)}
              style={{ fontSize: '0.8rem', padding: '5px 10px', width: 145 }}
            />
            <button className="btn btn-ghost" style={{ fontSize: '0.78rem', padding: '5px 12px' }}
              onClick={() => load()} disabled={loading}>
              {loading ? <span className="spinner" style={{ width: 12, height: 12 }} /> : '↺ Refresh'}
            </button>
          </div>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            className="input"
            placeholder="Search rooms…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ fontSize: '0.8rem', padding: '5px 10px', width: 200 }}
          />
          {[
            ['all',           'All'],
            ['available',     '🟢 Available'],
            ['in_use',        '🔴 In Use'],
            ['starting_soon', '🟡 Starting Soon'],
          ].map(([val, label]) => (
            <button
              key={val}
              onClick={() => setFilter(val)}
              style={{
                fontSize: '0.75rem', padding: '4px 12px', borderRadius: 20, border: '1px solid',
                cursor: 'pointer', transition: 'all 0.15s',
                borderColor: filter === val ? 'var(--cyan)' : 'var(--border)',
                background:  filter === val ? 'rgba(33,212,253,0.1)' : 'transparent',
                color:       filter === val ? 'var(--cyan)' : 'var(--text-secondary)',
              }}>
              {label}
            </button>
          ))}
        </div>

        {/* Errors / permission warnings */}
        {error && <div className="alert alert-error" style={{ fontSize: '0.82rem' }}>{error}</div>}
        {data?.roomsHint && (
          <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(210,153,34,0.1)', border: '1px solid rgba(210,153,34,0.3)', fontSize: '0.8rem', color: '#d9a520' }}>
            ⚠ {data.roomsHint}
          </div>
        )}

        {/* Loading skeleton */}
        {loading && !data && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} style={{ height: 140, borderRadius: 'var(--radius-md)', background: 'var(--bg-elevated)', opacity: 0.5 }} />
            ))}
          </div>
        )}

        {/* Room grid grouped by building */}
        {!loading || data ? (
          Object.keys(byBuilding).length === 0 && !loading ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              No rooms match the current filter.
            </div>
          ) : (
            Object.entries(byBuilding).map(([building, bRooms]) => (
              <div key={building}>
                {Object.keys(byBuilding).length > 1 && (
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                    {building}
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                  {bRooms.map(room => (
                    <RoomCard
                      key={room.id || room.email}
                      room={room}
                      selected={selected?.email === room.email}
                      onClick={r => setSelected(selected?.email === r.email ? null : r)}
                    />
                  ))}
                </div>
              </div>
            ))
          )
        ) : null}
      </div>

      {/* Right detail panel */}
      {selected && (
        <div style={{
          width: 340, flexShrink: 0,
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding: 16,
          overflowY: 'auto',
          alignSelf: 'flex-start',
          position: 'sticky',
          top: 0,
        }}>
          <RoomDetailPanel
            room={selected}
            onClose={() => setSelected(null)}
          />
        </div>
      )}
    </div>
  )
}
