import { useState, useEffect, useRef } from 'react'
import { getMaps, getMap, deleteMap, getSwitches, addSeat, updateSeat, deleteSeat, updateMapRotation, importSeats } from '../../api/client.js'
import { Document, Page, pdfjs } from 'react-pdf'
import * as xlsx from 'xlsx'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

// ── Seat Pin on Map ───────────────────────────────────────────────────────────
function SeatPin({ seat, selected, onClick, onPointerDown }) {
  const colors = { mapped: 'var(--cyan)', selected: 'var(--orange)' }
  const color = selected ? colors.selected : colors.mapped
  return (
    <div
      className={`seat-pin${selected ? ' selected' : ''}`}
      style={{ left: `${seat.x_pct}%`, top: `${seat.y_pct}%`, color }}
      onPointerDown={(e) => onPointerDown && onPointerDown(e, seat)}
      title={`${seat.seat_label} → ${seat.switch_name || 'unassigned'} ${seat.port}`}
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
  const [importResult, setImportResult] = useState(null)  // { updated, unmatched }

  const wrapperRef  = useRef(null)   // .map-canvas-wrapper
  const contentRef  = useRef(null)   // pan/zoom div (.map-content)
  const rotateRef   = useRef(null)   // inner rotation div (image + pins)
  const excelRef    = useRef(null)
  const draggingPinRef = useRef(null)

  // Sync rotation when map changes
  useEffect(() => {
    setRotation(currentMap?.rotation ?? 0)
    setTransform({ x: 0, y: 0, scale: 1 })
  }, [currentMap?.id])

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
  // Convert screen (clientX, clientY) → layout percentages, accounting for
  // pan, zoom, and rotation. Uses the wrapper rect (stable) + inverts the
  // transform so coordinates never drift with zoom level.
  const screenToMap = (clientX, clientY) => {
    const wRect = wrapperRef.current.getBoundingClientRect()
    // Undo pan + scale
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

    // Undo rotation (CSS rotates around the element's center)
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

  // Separated out so reader.onload stays synchronous — an async onload handler
  // causes Chrome to interpret the returned Promise as a message-channel response,
  // which then throws "message channel closed" when the await resolves.
  const _processImportRows = async (rows) => {
    if (!rows.length) return

    // If no map is loaded yet, just queue everything as unplaced pins
    if (!currentMap) {
      setUnplacedPins(prev => [...prev, ...rows])
      return
    }

    try {
      const payload = rows.map(({ seat_label, port, switch_name }) => ({ seat_label, port, switch_name }))
      const res = await importSeats(currentMap.id, payload)
      const { updated, unmatched } = res.data

      // Refresh the map so updated seats reflect new port/switch immediately
      if (updated.length > 0) {
        const mapRes = await getMap(currentMap.id)
        onMapChange(mapRes.data)
      }

      // Unmatched rows become unplaced pins to drag onto the map
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
    // Keep onload synchronous — an async handler makes Chrome think it's a
    // message-channel responder and throws when awaits are still pending.
    reader.onload = (evt) => {
      const wb   = xlsx.read(evt.target.result, { type: 'binary' })
      const ws   = wb.Sheets[wb.SheetNames[0]]
      const data = xlsx.utils.sheet_to_json(ws, { defval: '' })
      const rows = data.map((row, i) => {
        const r = Object.fromEntries(Object.entries(row).map(([k, v]) => [k.toLowerCase().trim(), String(v ?? '').trim()]))

        // Seat label — accept many common header names from real-world exports
        const seat_label =
          r['seat label'] || r['seat'] || r['label'] || r['name'] ||
          r['location']   || r['desk'] || r['workstation'] || r['station'] ||
          r['room']       || r['endpoint'] || r['node'] || r['asset'] ||
          r['pc name']    || r['computer'] || r['device name'] || ''

        // Port column — accept common network-port header names
        const colA =
          r['port']       || r['interface']       || r['port number']   ||
          r['jack']       || r['interface name']  || r['network port']  ||
          r['connection'] || r['port id']         || ''

        // Switch column — accept IP addresses, hostnames, and description fields
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

      // Defer async work so the event handler itself returns synchronously
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
    if (e.target.closest('.seat-pin')) return
    setIsPanning(true)
  }

  const handlePointerMove = (e) => {
    if (!currentMap) return

    const dx = e.clientX - panStart.x
    const dy = e.clientY - panStart.y

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
          {!readOnly && (
            <>
              <button className="btn btn-ghost" style={{ fontSize: '0.75rem', padding: '3px 10px' }} onClick={() => handleRotate('ccw')} title="Rotate 90° counter-clockwise">↺ CCW</button>
              <button className="btn btn-ghost" style={{ fontSize: '0.75rem', padding: '3px 10px' }} onClick={() => handleRotate('cw')}  title="Rotate 90° clockwise">↻ CW</button>
              {rotation !== 0 && <span style={{ fontSize: '0.7rem', color: 'var(--cyan)' }}>{rotation}°</span>}
            </>
          )}
        </div>
        <span className="text-xs text-muted" style={{ textAlign: 'right' }}>
          {readOnly
            ? 'Scroll to zoom · Drag to pan · Click pin to select'
            : 'Scroll to zoom · Drag map to pan · Drag pins to move · Click to add pin'}
        </span>
      </div>

      {/* Canvas */}
      <div
        ref={wrapperRef}
        className="map-canvas-wrapper"
        style={fullScreen ? { flex: 1, height: 'auto' } : {}}
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
          {/* Rotation layer — image + pins rotate together */}
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
      {(pendingPin || editingSeat) && (
        <SeatForm
          switches={switches}
          onSave={handleSaveSeat}
          onCancel={() => { setPendingPin(null); setEditingSeat(null) }}
          initial={editingSeat ? { seat_label: editingSeat.seat_label, port: editingSeat.port, switch_id: editingSeat.switch_id || '' } : null}
        />
      )}
      {selectedSeat && !editingSeat && !pendingPin && (
        <div className="alert alert-info" style={{ justifyContent: 'space-between' }}>
          <span>📍 Selected: <strong>{selectedSeat.seat_label}</strong> → {selectedSeat.switch_name || '?'} : <span className="font-mono">{selectedSeat.port}</span></span>
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
        {(pendingPin || editingSeat || (selectedSeat && !editingSeat && !pendingPin)) && (
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
