import { useState, useEffect, useRef, useCallback } from 'react'
import { getSites, syncUnifiDevices, getDevicePorts, getDeviceClients } from '../api/client.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function portColor(port) {
  if (port.is_uplink) return '#58a6ff'
  if (!port.up)       return '#21262d'
  return '#3fb950'
}

function fmtBytes(n) {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++ }
  return `${n.toFixed(1)} ${units[i]}`
}

// ── Port components ───────────────────────────────────────────────────────────

function PortBox({ port, selected, hasClient, onClick }) {
  const bg     = portColor(port)
  const border = hasClient
    ? '1.5px solid #d2a8ff'
    : `1.5px solid ${bg === '#21262d' ? '#30363d' : bg}`
  return (
    <div
      onClick={() => onClick(port)}
      title={`Port ${port.port_idx}${port.name ? ` – ${port.name}` : ''} — ${port.up ? `${port.speed || '?'} Mbps` : 'down'}`}
      style={{
        width: 22, height: 22, borderRadius: 3,
        background: bg, border,
        cursor: 'pointer',
        outline: selected ? '2px solid #f0f6fc' : 'none',
        transform: selected ? 'scale(1.25)' : 'none',
        transition: 'transform 0.1s',
      }}
    />
  )
}

function PortDetail({ port, client, onClose }) {
  return (
    <div style={{
      marginTop: 10, padding: '12px 14px',
      background: 'var(--bg-base)', border: '1px solid var(--border)',
      borderRadius: 6, fontSize: '0.8rem', color: 'var(--text-secondary)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.85rem' }}>
          Port {port.port_idx}{port.name ? ` — ${port.name}` : ''}
        </span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1rem', lineHeight: 1 }}>✕</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px' }}>
        <span>State</span>
        <span style={{ color: port.up ? '#3fb950' : '#f85149' }}>{port.up ? 'Up' : 'Down'}</span>
        {port.speed != null       && <><span>Speed</span>  <span>{port.speed} Mbps</span></>}
        {port.full_duplex != null && <><span>Duplex</span> <span>{port.full_duplex ? 'Full' : 'Half'}</span></>}
        {port.poe_enable  != null && (
          <><span>PoE</span>
          <span>{port.poe_enable ? (port.poe_good ? `${port.poe_power?.toFixed(1) ?? '?'} W` : 'fault') : 'off'}</span></>
        )}
        {port.vlan       && <><span>VLAN</span>   <span>{port.vlan}</span></>}
        {port.tx_bytes != null && <><span>TX</span><span>{fmtBytes(port.tx_bytes)}</span></>}
        {port.rx_bytes != null && <><span>RX</span><span>{fmtBytes(port.rx_bytes)}</span></>}
        {(port.tx_errors > 0 || port.rx_errors > 0) && (
          <><span style={{ color: '#f85149' }}>Errors</span>
          <span style={{ color: '#f85149' }}>TX {port.tx_errors} / RX {port.rx_errors}</span></>
        )}
        {port.lldp_system_name && (
          <><span>LLDP</span><span style={{ wordBreak: 'break-all' }}>{port.lldp_system_name}</span></>
        )}
      </div>
      {client && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
          <span style={{ color: '#d2a8ff', fontWeight: 600 }}>Client: </span>
          {client.hostname || client.mac}{client.ip ? ` · ${client.ip}` : ''}
        </div>
      )}
    </div>
  )
}

// ── Port slot (proper component so React reconciles clicks correctly) ──────────

function PortSlot({ port, isSelected, hasClient, onPortClick }) {
  const bg = portColor(port)
  return (
    <div
      onClick={() => onPortClick(port)}
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, cursor: 'pointer' }}
    >
      <div
        title={`Port ${port.port_idx}${port.name ? ` – ${port.name}` : ''} — ${port.up ? `${port.speed || '?'} Mbps` : 'down'}`}
        style={{
          width: 22, height: 22, borderRadius: 3,
          background: bg,
          border: hasClient ? '2px solid #d2a8ff' : `1.5px solid ${bg === '#21262d' ? '#30363d' : bg}`,
          outline: isSelected ? '2px solid #f0f6fc' : 'none',
          outlineOffset: '1px',
          transform: isSelected ? 'scale(1.2)' : 'none',
          transition: 'transform 0.1s',
        }}
      />
      <span style={{ fontSize: '0.55rem', color: isSelected ? '#f0f6fc' : '#6e7681', lineHeight: 1, userSelect: 'none' }}>
        {port.port_idx}
      </span>
    </div>
  )
}

// ── Switch face (ports in paired columns: top=odd slot, bottom=even slot) ─────

function SwitchFace({ ports, clients }) {
  const [selectedPort, setSelectedPort] = useState(null)

  const handlePortClick = p =>
    setSelectedPort(prev => prev?.port_idx === p.port_idx ? null : p)

  const sorted  = [...ports].sort((a, b) => a.port_idx - b.port_idx)
  const regular = sorted.filter(p => !p.sfp)
  const sfp     = sorted.filter(p =>  p.sfp)

  const buildColumns = list => {
    const cols = []
    for (let i = 0; i < list.length; i += 2) {
      const top = list[i]
      const bot = list[i + 1]
      cols.push(
        <div key={top.port_idx} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <PortSlot
            port={top}
            isSelected={selectedPort?.port_idx === top.port_idx}
            hasClient={!!clients[String(top.port_idx)]}
            onPortClick={handlePortClick}
          />
          {bot ? (
            <PortSlot
              port={bot}
              isSelected={selectedPort?.port_idx === bot.port_idx}
              hasClient={!!clients[String(bot.port_idx)]}
              onPortClick={handlePortClick}
            />
          ) : <div style={{ width: 22, height: 32 }} />}
        </div>
      )
    }
    return cols
  }

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>

      {/* Left: bezel + stats */}
      <div style={{ flex: '0 0 auto', minWidth: 0 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          background: '#1c2128', border: '2px solid #30363d',
          borderRadius: 6, padding: '10px 14px',
          overflowX: 'auto',
        }}>
          <div style={{ display: 'flex', gap: 10 }}>{buildColumns(regular)}</div>
          {sfp.length > 0 && (
            <>
              <div style={{ width: 1, alignSelf: 'stretch', background: '#30363d', flexShrink: 0 }} />
              <div style={{ display: 'flex', gap: 10 }}>{buildColumns(sfp)}</div>
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: 12, marginTop: 7, fontSize: '0.72rem', color: '#6e7681' }}>
          <span style={{ color: '#3fb950' }}>● {ports.filter(p => p.up && !p.is_uplink).length} up</span>
          <span>○ {ports.filter(p => !p.up).length} down</span>
          {ports.some(p => p.is_uplink) && (
            <span style={{ color: '#58a6ff' }}>↑ {ports.filter(p => p.is_uplink).length} uplink</span>
          )}
          {Object.keys(clients).length > 0 && (
            <span style={{ color: '#d2a8ff' }}>◆ {Object.keys(clients).length} clients</span>
          )}
        </div>
      </div>

      {/* Right: port detail panel */}
      {selectedPort && (
        <div style={{
          flex: '1 1 240px', minWidth: 200,
          background: 'var(--bg-base)', border: '1px solid var(--border)',
          borderRadius: 8, padding: '12px 14px', fontSize: '0.8rem', color: 'var(--text-secondary)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.85rem' }}>
              Port {selectedPort.port_idx}{selectedPort.name ? ` — ${selectedPort.name}` : ''}
            </span>
            <button onClick={() => setSelectedPort(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1rem', lineHeight: 1, padding: 0 }}>✕</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px 14px' }}>
            <span>State</span>
            <span style={{ color: selectedPort.up ? '#3fb950' : '#f85149' }}>{selectedPort.up ? 'Up' : 'Down'}</span>
            {selectedPort.speed != null       && <><span>Speed</span>  <span>{selectedPort.speed} Mbps</span></>}
            {selectedPort.full_duplex != null && <><span>Duplex</span> <span>{selectedPort.full_duplex ? 'Full' : 'Half'}</span></>}
            {selectedPort.poe_enable  != null && (
              <><span>PoE</span>
              <span>{selectedPort.poe_enable ? (selectedPort.poe_good ? `${selectedPort.poe_power?.toFixed(1) ?? '?'} W` : 'fault') : 'off'}</span></>
            )}
            {selectedPort.vlan       && <><span>VLAN</span>   <span>{selectedPort.vlan}</span></>}
            {selectedPort.tx_bytes != null && <><span>TX</span><span>{fmtBytes(selectedPort.tx_bytes)}</span></>}
            {selectedPort.rx_bytes != null && <><span>RX</span><span>{fmtBytes(selectedPort.rx_bytes)}</span></>}
            {(selectedPort.tx_errors > 0 || selectedPort.rx_errors > 0) && (
              <><span style={{ color: '#f85149' }}>Errors</span>
              <span style={{ color: '#f85149' }}>TX {selectedPort.tx_errors} / RX {selectedPort.rx_errors}</span></>
            )}
            {selectedPort.lldp_system_name && (
              <><span>LLDP</span><span style={{ wordBreak: 'break-all' }}>{selectedPort.lldp_system_name}</span></>
            )}
          </div>
          {clients[String(selectedPort.port_idx)] && (
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
              <span style={{ color: '#d2a8ff', fontWeight: 600 }}>Client: </span>
              {clients[String(selectedPort.port_idx)].hostname || clients[String(selectedPort.port_idx)].mac}
              {clients[String(selectedPort.port_idx)].ip ? ` · ${clients[String(selectedPort.port_idx)].ip}` : ''}
            </div>
          )}
        </div>
      )}

    </div>
  )
}


// ── Rack unit (switch or gateway) ─────────────────────────────────────────────

function RackUnit({ device, siteId, unitNum, isDragOver, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd }) {
  const [expanded, setExpanded] = useState(false)
  const [ports,    setPorts]    = useState([])
  const [clients,  setClients]  = useState({})
  const [loading,  setLoading]  = useState(false)
  const isSwitch = device.device_type === 'switch'
  const dotColor = device.state === 'online' ? '#3fb950' : device.state === 'offline' ? '#f85149' : '#6e7681'

  useEffect(() => {
    if (!expanded || ports.length > 0 || !isSwitch) return
    setLoading(true)
    Promise.all([
      getDevicePorts(siteId, device.unifi_id),
      getDeviceClients(siteId, device.unifi_id),
    ]).then(([pr, cr]) => {
      setPorts(pr.data?.ports || [])
      setClients(cr.data || {})
    }).catch(() => {}).finally(() => setLoading(false))
  }, [expanded, siteId, device.id, isSwitch, ports.length])

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      style={{
        borderBottom: '1px solid #21262d',
        borderLeft: `3px solid ${isDragOver ? '#58a6ff' : 'transparent'}`,
        background: isDragOver ? 'rgba(88,166,255,0.05)' : 'transparent',
        transition: 'border-color 0.1s, background 0.1s',
      }}
    >
      <div
        onClick={() => isSwitch && setExpanded(e => !e)}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: isSwitch ? 'pointer' : 'default' }}
      >
        <span
          title="Drag to reorder"
          draggable
          onDragStart={e => { e.stopPropagation(); onDragStart(e) }}
          onClick={e => e.stopPropagation()}
          style={{ color: '#6e7681', cursor: 'grab', fontSize: '0.85rem', flexShrink: 0 }}
        >⠿</span>

        <span style={{ fontSize: '0.68rem', color: '#6e7681', width: 20, textAlign: 'right', flexShrink: 0 }}>{unitNum}</span>

        <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, flexShrink: 0, display: 'inline-block' }} />

        <span style={{
          fontSize: '0.65rem', padding: '1px 6px', borderRadius: 4, flexShrink: 0,
          background: device.device_type === 'gateway' ? 'rgba(210,168,255,0.15)' : 'rgba(88,166,255,0.15)',
          color:      device.device_type === 'gateway' ? '#d2a8ff' : '#58a6ff',
          fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
        }}>{device.device_type === 'gateway' ? 'GW' : 'SW'}</span>

        <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {device.name}
        </span>
        {device.model && <span style={{ fontSize: '0.75rem', color: '#6e7681', flexShrink: 0 }}>{device.model}</span>}
        {device.ip    && <span style={{ fontSize: '0.75rem', color: '#6e7681', flexShrink: 0 }}>{device.ip}</span>}
        {isSwitch && <span style={{ color: '#6e7681', fontSize: '0.7rem', flexShrink: 0 }}>{expanded ? '▲' : '▼'}</span>}
      </div>

      {expanded && (
        <div style={{ padding: '8px 14px 14px 14px' }}>
          {loading ? (
            <div style={{ color: '#6e7681', fontSize: '0.8rem', padding: '6px 0' }}>Loading ports…</div>
          ) : ports.length === 0 ? (
            <div style={{ color: '#6e7681', fontSize: '0.8rem', padding: '6px 0' }}>No port data — sync the site to refresh</div>
          ) : (
            <SwitchFace ports={ports} clients={clients} />
          )}
        </div>
      )}
    </div>
  )
}

// ── AP card ───────────────────────────────────────────────────────────────────

function APCard({ device }) {
  const dotColor = device.state === 'online' ? '#3fb950' : device.state === 'offline' ? '#f85149' : '#6e7681'
  return (
    <div style={{
      padding: '10px 12px', background: 'var(--bg-surface)',
      border: '1px solid var(--border)', borderRadius: 6,
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <span style={{ fontSize: '1rem', flexShrink: 0 }}>📡</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {device.name}
        </div>
        <div style={{ fontSize: '0.73rem', color: '#6e7681' }}>
          {device.model}{device.ip ? ` · ${device.ip}` : ''}
        </div>
      </div>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, flexShrink: 0, display: 'inline-block' }} />
    </div>
  )
}

// ── Site detail (rack + AP panel) ─────────────────────────────────────────────

function NetworkSiteDetail({ site, onBack, onSync, syncing }) {
  const devices      = site.unifi_devices ?? []
  const rackDevices  = devices.filter(d => d.device_type === 'switch' || d.device_type === 'gateway')
  const aps          = devices.filter(d => d.device_type === 'ap')
  const online       = devices.filter(d => d.state === 'online').length
  const total        = devices.length
  const switchCount  = rackDevices.filter(d => d.device_type === 'switch').length
  const gatewayCount = rackDevices.filter(d => d.device_type === 'gateway').length

  const [rackOrder, setRackOrder] = useState(() => {
    try {
      const saved = localStorage.getItem(`rack_order_${site.id}`)
      return saved ? JSON.parse(saved) : rackDevices.map(d => d.id)
    } catch { return rackDevices.map(d => d.id) }
  })
  const [dragOver, setDragOver] = useState(null)
  const dragItem                = useRef(null)

  const orderedRack = [
    ...rackOrder.map(id => rackDevices.find(d => d.id === id)).filter(Boolean),
    ...rackDevices.filter(d => !rackOrder.includes(d.id)),
  ]

  const handleDrop = targetId => {
    setDragOver(null)
    if (!dragItem.current || dragItem.current === targetId) return
    const items   = [...orderedRack]
    const fromIdx = items.findIndex(d => d.id === dragItem.current)
    const toIdx   = items.findIndex(d => d.id === targetId)
    if (fromIdx < 0 || toIdx < 0) return
    items.splice(toIdx, 0, items.splice(fromIdx, 1)[0])
    const ids = items.map(d => d.id)
    setRackOrder(ids)
    localStorage.setItem(`rack_order_${site.id}`, JSON.stringify(ids))
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <button
          onClick={onBack}
          style={{
            padding: '6px 12px', borderRadius: 6,
            background: 'var(--bg-surface)', border: '1px solid var(--border)',
            color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.85rem', fontFamily: 'var(--font-sans)',
          }}
        >← Back</button>

        <span style={{ fontSize: '1.1rem' }}>🏢</span>
        <h2 style={{ margin: 0, fontWeight: 700, fontSize: '1.3rem', color: 'var(--text-primary)' }}>{site.name}</h2>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {switchCount > 0 && (
            <span style={{ fontSize: '0.73rem', padding: '2px 8px', borderRadius: 4, background: 'rgba(88,166,255,0.12)', color: '#58a6ff', fontWeight: 600 }}>
              🔀 {switchCount} switch{switchCount !== 1 ? 'es' : ''}
            </span>
          )}
          {aps.length > 0 && (
            <span style={{ fontSize: '0.73rem', padding: '2px 8px', borderRadius: 4, background: 'rgba(63,185,80,0.12)', color: '#3fb950', fontWeight: 600 }}>
              📡 {aps.length} AP{aps.length !== 1 ? 's' : ''}
            </span>
          )}
          {gatewayCount > 0 && (
            <span style={{ fontSize: '0.73rem', padding: '2px 8px', borderRadius: 4, background: 'rgba(210,168,255,0.12)', color: '#d2a8ff', fontWeight: 600 }}>
              🌐 {gatewayCount} gateway{gatewayCount !== 1 ? 's' : ''}
            </span>
          )}
          {total > 0 && (
            <span style={{
              fontSize: '0.73rem', padding: '2px 8px', borderRadius: 4, fontWeight: 600,
              background: online === total ? 'rgba(63,185,80,0.12)' : 'rgba(248,81,73,0.1)',
              color: online === total ? '#3fb950' : '#f85149',
            }}>{online}/{total} online</span>
          )}
        </div>

        <button
          onClick={() => onSync(site.id)}
          disabled={syncing}
          style={{
            marginLeft: 'auto', padding: '6px 14px', borderRadius: 6, fontSize: '0.82rem',
            background: 'rgba(88,166,255,0.1)', border: '1px solid rgba(88,166,255,0.3)',
            color: '#58a6ff', fontWeight: 600, cursor: syncing ? 'default' : 'pointer',
            opacity: syncing ? 0.6 : 1, fontFamily: 'var(--font-sans)',
          }}
        >{syncing ? 'Syncing…' : '↻ Sync'}</button>
      </div>

      {/* Body: rack + AP panel */}
      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>

        {/* Rack */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-primary)' }}>Network Rack</span>
            <span style={{ fontSize: '0.73rem', color: '#6e7681' }}>drag ⠿ to reorder · click switch to view ports</span>
          </div>

          <div style={{ border: '2px solid #30363d', borderRadius: 8, background: '#0d1117', overflow: 'hidden' }}>
            <div style={{
              padding: '6px 14px', background: '#161b22', borderBottom: '1px solid #30363d',
              fontSize: '0.68rem', color: '#6e7681', display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <span style={{ width: 14 }} />
              <span style={{ width: 20, textAlign: 'right' }}>U</span>
              <span style={{ width: 8 }} />
              <span style={{ width: 30 }} />
              <span>Device</span>
            </div>

            {orderedRack.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center', color: '#6e7681', fontSize: '0.85rem' }}>
                No switches or gateways found — sync the site first
              </div>
            ) : orderedRack.map((device, i) => (
              <RackUnit
                key={device.id}
                device={device}
                siteId={site.id}
                unitNum={i + 1}
                isDragOver={dragOver === device.id}
                onDragStart={() => { dragItem.current = device.id }}
                onDragOver={e => { e.preventDefault(); setDragOver(device.id) }}
                onDragLeave={() => setDragOver(null)}
                onDrop={() => handleDrop(device.id)}
                onDragEnd={() => { dragItem.current = null; setDragOver(null) }}
              />
            ))}
          </div>
        </div>

        {/* AP panel */}
        <div style={{ width: 240, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
            <span style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-primary)' }}>Access Points</span>
            <span style={{ fontSize: '0.73rem', color: '#6e7681' }}>
              {aps.filter(d => d.state === 'online').length}/{aps.length} online
            </span>
          </div>
          {aps.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: '#6e7681', fontSize: '0.83rem', border: '1px dashed var(--border)', borderRadius: 6 }}>
              No APs found
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {aps.map(ap => <APCard key={ap.id} device={ap} />)}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}

// ── Site card ─────────────────────────────────────────────────────────────────

function SiteCard({ site, onSelect, onSync, syncing }) {
  const devices  = site.unifi_devices ?? []
  const switches = devices.filter(d => d.device_type === 'switch')
  const aps      = devices.filter(d => d.device_type === 'ap')
  const gateways = devices.filter(d => d.device_type === 'gateway')
  const online   = devices.filter(d => d.state === 'online').length
  const total    = devices.length
  const barColor = online === total && total > 0 ? '#3fb950' : online > 0 ? '#d29922' : total > 0 ? '#f85149' : '#30363d'

  return (
    <div
      onClick={() => onSelect(site)}
      style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 10, padding: '18px 20px', cursor: 'pointer',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        display: 'flex', flexDirection: 'column',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = '#58a6ff'; e.currentTarget.style.boxShadow = '0 0 0 1px rgba(88,166,255,0.2)' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.boxShadow = 'none' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: '1.1rem' }}>🏢</span>
          <span style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)' }}>{site.name}</span>
        </div>
        {site.unifi_host_id && (
          <span style={{ fontSize: '0.65rem', padding: '2px 6px', borderRadius: 4, background: 'rgba(63,185,80,0.1)', color: '#3fb950', fontWeight: 600 }}>UniFi</span>
        )}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
        {switches.length > 0 && (
          <span style={{ fontSize: '0.73rem', padding: '3px 8px', borderRadius: 4, background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
            🔀 {switches.length} switch{switches.length !== 1 ? 'es' : ''}
          </span>
        )}
        {aps.length > 0 && (
          <span style={{ fontSize: '0.73rem', padding: '3px 8px', borderRadius: 4, background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
            📡 {aps.length} AP{aps.length !== 1 ? 's' : ''}
          </span>
        )}
        {gateways.length > 0 && (
          <span style={{ fontSize: '0.73rem', padding: '3px 8px', borderRadius: 4, background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
            🌐 {gateways.length} gateway{gateways.length !== 1 ? 's' : ''}
          </span>
        )}
        {total === 0 && (
          <span style={{ fontSize: '0.73rem', color: '#6e7681' }}>No devices — sync to discover</span>
        )}
      </div>

      {total > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.73rem', color: '#6e7681', marginBottom: 5 }}>
            <span>{online} online</span><span>{total} total</span>
          </div>
          <div style={{ height: 4, background: 'var(--bg-base)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${total > 0 ? (online / total) * 100 : 0}%`, background: barColor, borderRadius: 2, transition: 'width 0.3s' }} />
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto' }}>
        <span style={{ fontSize: '0.78rem', color: '#58a6ff', fontWeight: 600 }}>View rack →</span>
        <button
          onClick={e => { e.stopPropagation(); onSync(site.id) }}
          disabled={syncing}
          style={{
            padding: '4px 10px', borderRadius: 5, fontSize: '0.75rem',
            background: 'transparent', border: '1px solid var(--border)',
            color: 'var(--text-muted)', cursor: syncing ? 'default' : 'pointer',
            opacity: syncing ? 0.55 : 1, fontFamily: 'var(--font-sans)',
          }}
        >{syncing ? 'Syncing…' : '↻ Sync'}</button>
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function Network() {
  const [view,         setView]         = useState('list')
  const [selectedSite, setSelectedSite] = useState(null)
  const [sites,        setSites]        = useState([])
  const [loading,      setLoading]      = useState(true)
  const [syncing,      setSyncing]      = useState({})
  const [syncingAll,   setSyncingAll]   = useState(false)

  const loadSites = useCallback(async () => {
    const r = await getSites()
    setSites(r.data)
    return r.data
  }, [])

  useEffect(() => { loadSites().finally(() => setLoading(false)) }, [loadSites])

  const handleSync = useCallback(async siteId => {
    setSyncing(s => ({ ...s, [siteId]: true }))
    try {
      await syncUnifiDevices(siteId)
      const updated = await loadSites()
      setSelectedSite(prev => prev?.id === siteId ? (updated.find(s => s.id === siteId) ?? prev) : prev)
    } finally {
      setSyncing(s => ({ ...s, [siteId]: false }))
    }
  }, [loadSites])

  const handleSyncAll = useCallback(async () => {
    setSyncingAll(true)
    try {
      await Promise.all(sites.map(s => syncUnifiDevices(s.id).catch(() => {})))
      await loadSites()
    } finally { setSyncingAll(false) }
  }, [sites, loadSites])

  if (view === 'site' && selectedSite) {
    return (
      <NetworkSiteDetail
        site={sites.find(s => s.id === selectedSite.id) ?? selectedSite}
        onBack={() => { setView('list'); setSelectedSite(null) }}
        onSync={handleSync}
        syncing={!!syncing[selectedSite.id]}
      />
    )
  }

  const totalDevices = sites.reduce((n, s) => n + (s.unifi_devices?.length ?? 0), 0)
  const totalOnline  = sites.reduce((n, s) => n + (s.unifi_devices?.filter(d => d.state === 'online').length ?? 0), 0)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h2 style={{ margin: 0, fontWeight: 700, fontSize: '1.3rem', color: 'var(--text-primary)' }}>Network Overview</h2>
          {!loading && (
            <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: '#6e7681' }}>
              {sites.length} site{sites.length !== 1 ? 's' : ''} · {totalOnline}/{totalDevices} devices online
            </p>
          )}
        </div>
        <button
          onClick={handleSyncAll}
          disabled={syncingAll || loading}
          style={{
            padding: '7px 16px', borderRadius: 6, fontSize: '0.82rem',
            background: 'rgba(88,166,255,0.1)', border: '1px solid rgba(88,166,255,0.3)',
            color: '#58a6ff', fontWeight: 600,
            cursor: syncingAll || loading ? 'default' : 'pointer',
            opacity: syncingAll || loading ? 0.6 : 1, fontFamily: 'var(--font-sans)',
          }}
        >{syncingAll ? 'Syncing…' : '↻ Sync All Sites'}</button>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60, color: '#6e7681' }}>
          <div className="spinner" />
        </div>
      ) : sites.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#6e7681', fontSize: '0.9rem' }}>
          No sites configured — add one in Settings → Sites.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {sites.map(site => (
            <SiteCard
              key={site.id}
              site={site}
              onSelect={s => { setSelectedSite(s); setView('site') }}
              onSync={handleSync}
              syncing={!!syncing[site.id]}
            />
          ))}
        </div>
      )}
    </div>
  )
}
