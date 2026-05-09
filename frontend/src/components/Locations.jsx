import { useState, useEffect, useContext } from 'react'
import FloorMapManager from './PortSecurity/FloorMapManager.jsx'
import { getSites, getMap, getZones, getUnifiHosts, getPortStatuses, getPortClients } from '../api/client.js'
import { ClientContext } from '../ClientContext.js'

export default function Locations() {
  const { selectedClient } = useContext(ClientContext)
  const [sites,          setSites]          = useState([])
  const [selectedSiteId, setSelectedSiteId] = useState('')
  const [currentMap,     setCurrentMap]     = useState(null)
  const [selectedMapId,  setSelectedMapId]  = useState('')
  const [selectedSeat,   setSelectedSeat]   = useState(null)
  const [loading,        setLoading]        = useState(false)
  const [zones,          setZones]          = useState([])      // zones for current map
  const [activeTypes,    setActiveTypes]    = useState([])      // zone types in the active filter
  const [unifiHosts,     setUnifiHosts]     = useState([])
  const [portStatuses,   setPortStatuses]   = useState({})
  const [portClients,    setPortClients]    = useState({})

  useEffect(() => {
    getSites(selectedClient?.id ?? null).then(r => setSites(r.data)).catch(() => {})
    getUnifiHosts().then(r => setUnifiHosts(r.data)).catch(() => {})
    setSelectedSiteId('')
    setCurrentMap(null)
    setSelectedMapId('')
  }, [selectedClient])

  const selectedSite = sites.find(s => s.id === parseInt(selectedSiteId)) || null

  // Load map + zones together
  const loadMap = async (mapId, siteId) => {
    setLoading(true)
    setZones([])
    setActiveTypes([])
    setPortStatuses({})
    setPortClients({})
    try {
      const [mapRes, zonesRes] = await Promise.all([
        getMap(mapId),
        getZones(mapId),
      ])
      setCurrentMap(mapRes.data)
      setZones(zonesRes.data || [])
      if (siteId) {
        getPortStatuses(siteId, mapId).then(r => setPortStatuses(r.data || {})).catch(() => {})
        getPortClients(siteId, mapId).then(r => setPortClients(r.data || {})).catch(() => {})
      }
    } catch {}
    setLoading(false)
  }

  const handleSiteChange = async (id) => {
    setSelectedSiteId(id)
    setCurrentMap(null)
    setSelectedMapId('')
    setSelectedSeat(null)
    setZones([])
    setActiveTypes([])
    const site = sites.find(s => s.id === parseInt(id))
    if (site?.maps?.length > 0) {
      setSelectedMapId(String(site.maps[0].id))
      await loadMap(site.maps[0].id, parseInt(id))
    }
  }

  const handleMapTabChange = async (mapId) => {
    if (String(mapId) === selectedMapId) return
    setSelectedMapId(String(mapId))
    setSelectedSeat(null)
    await loadMap(mapId, selectedSiteId ? parseInt(selectedSiteId) : null)
  }

  const toggleType = (type) => {
    setActiveTypes(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    )
  }

  // Unique zone types that exist on the current map (excluding empty)
  const availableTypes = [...new Set(zones.map(z => z.zone_type).filter(Boolean))].sort()

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

      {/* ── Left panel ── */}
      <div style={{
        width: 232, flexShrink: 0,
        background: 'var(--bg-surface)', borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', overflowY: 'auto',
        padding: '20px 16px', gap: 24,
      }}>

        {/* Site selector */}
        <div>
          <div style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>
            Site
          </div>
          <select className="select" value={selectedSiteId}
            onChange={e => handleSiteChange(e.target.value)} style={{ width: '100%' }}>
            <option value="">— Choose a site —</option>
            {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        {/* UniFi network badge */}
        {selectedSite?.unifi_host_id && (() => {
          const host = unifiHosts.find(h => h.id === selectedSite.unifi_host_id)
          if (!host) return null
          const state   = host.reportedState || {}
          const devices = state.devices
          const clients = state.clients
          const totalDevices = typeof devices === 'object' && devices !== null
            ? (devices.total ?? Object.values(devices).reduce((s, v) => s + (typeof v === 'object' ? (v.online ?? 0) : 0), 0))
            : null
          const totalClients = typeof clients === 'object' && clients !== null
            ? (clients.total ?? clients.wifi ?? null)
            : (typeof clients === 'number' ? clients : null)
          return (
            <div style={{ background: 'rgba(6,182,212,0.07)', border: '1px solid rgba(6,182,212,0.25)', borderRadius: 'var(--radius-sm)', padding: '10px 12px' }}>
              <div style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--cyan)', textTransform: 'uppercase', marginBottom: 6 }}>Network</div>
              <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                📡 {host.name || host.id}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {totalDevices !== null && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Devices</span>
                    <span className="badge" style={{ background: 'rgba(6,182,212,0.12)', color: 'var(--cyan)', border: '1px solid rgba(6,182,212,0.2)', fontSize: '0.7rem' }}>{totalDevices}</span>
                  </div>
                )}
                {totalClients !== null && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Clients</span>
                    <span className="badge" style={{ background: 'rgba(6,182,212,0.12)', color: 'var(--cyan)', border: '1px solid rgba(6,182,212,0.2)', fontSize: '0.7rem' }}>{totalClients}</span>
                  </div>
                )}
              </div>
            </div>
          )
        })()}

        {/* Floor / map tabs */}
        {selectedSite?.maps?.length > 0 && (
          <div>
            <div style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>
              Floor
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {selectedSite.maps.map(m => (
                <button key={m.id} onClick={() => handleMapTabChange(m.id)} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 10px', borderRadius: 'var(--radius-sm)',
                  border: selectedMapId === String(m.id) ? '1px solid var(--cyan)' : '1px solid transparent',
                  background: selectedMapId === String(m.id) ? 'var(--cyan-dim, rgba(6,182,212,0.1))' : 'transparent',
                  color: selectedMapId === String(m.id) ? 'var(--cyan)' : 'var(--text-secondary)',
                  fontSize: '0.82rem', fontWeight: selectedMapId === String(m.id) ? 600 : 400,
                  cursor: 'pointer', textAlign: 'left', width: '100%', transition: 'all 0.15s',
                }}>
                  <span style={{ fontSize: '0.9rem' }}>🗺️</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Zone type filter */}
        {availableTypes.length > 0 && (
          <div>
            <div style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>
              Filter by Zone Type
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {/* "All" clears the filter */}
              <button onClick={() => setActiveTypes([])} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '7px 10px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                border: activeTypes.length === 0 ? '1px solid var(--cyan)' : '1px solid transparent',
                background: activeTypes.length === 0 ? 'rgba(6,182,212,0.1)' : 'transparent',
                color: activeTypes.length === 0 ? 'var(--cyan)' : 'var(--text-secondary)',
                fontSize: '0.82rem', fontWeight: activeTypes.length === 0 ? 600 : 400,
                textAlign: 'left', width: '100%', transition: 'all 0.15s',
              }}>
                <span>🗂️</span> All zones
              </button>

              {availableTypes.map(type => {
                // Pick a representative color from zones of this type
                const typeZones  = zones.filter(z => z.zone_type === type)
                const typeColor  = typeZones[0]?.color || 'var(--cyan)'
                const isActive   = activeTypes.includes(type)
                const count      = typeZones.length
                return (
                  <button key={type} onClick={() => toggleType(type)} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '7px 10px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                    border: isActive ? `1px solid ${typeColor}` : '1px solid transparent',
                    background: isActive ? `${typeColor}18` : 'transparent',
                    color: isActive ? typeColor : 'var(--text-secondary)',
                    fontSize: '0.82rem', fontWeight: isActive ? 600 : 400,
                    textAlign: 'left', width: '100%', transition: 'all 0.15s',
                  }}>
                    <span style={{
                      width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                      background: typeColor,
                      boxShadow: isActive ? `0 0 0 2px ${typeColor}44` : 'none',
                    }} />
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {type}
                    </span>
                    <span style={{ fontSize: '0.7rem', color: isActive ? typeColor : 'var(--text-muted)', opacity: 0.8 }}>
                      {count}
                    </span>
                  </button>
                )
              })}
            </div>

            {activeTypes.length > 0 && (
              <button onClick={() => setActiveTypes([])} style={{
                marginTop: 8, fontSize: '0.72rem', color: 'var(--text-muted)',
                background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0',
              }}>
                ✕ Clear filter
              </button>
            )}
          </div>
        )}

        {/* Map info */}
        {currentMap && !loading && (
          <div>
            <div style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>
              Map Info
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Seats</span>
                <span className="badge badge-gray">{currentMap.seats?.length ?? 0}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Zones</span>
                <span className="badge badge-gray">{zones.length}</span>
              </div>
            </div>
          </div>
        )}

        {/* Empty states */}
        {!selectedSiteId && (
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Select a site to view its floor map and zone assignments.
          </p>
        )}
        {selectedSiteId && !loading && !currentMap && (
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            No floor maps configured for this site.
          </p>
        )}
      </div>

      {/* ── Map area ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0, minHeight: 0 }}>
        {loading && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: 'var(--text-muted)' }}>
            <div style={{ fontSize: '2.5rem' }}>⏳</div>
            <span style={{ fontSize: '0.95rem' }}>Loading map…</span>
          </div>
        )}

        {!loading && currentMap && (
          <FloorMapManager
            switches={[]}
            onSwitchesChange={() => {}}
            currentMap={currentMap}
            onMapChange={setCurrentMap}
            onSeatSelect={setSelectedSeat}
            selectedSeat={selectedSeat}
            hideSelector
            readOnly
            fullScreen
            highlightedTypes={activeTypes}
            portStatuses={portStatuses}
            portClients={portClients}
            siteAPs={selectedSite?.unifi_devices?.filter(d => d.device_type === 'ap') || []}
          />
        )}

        {!loading && !currentMap && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: 'var(--text-muted)' }}>
            <div style={{ fontSize: '3rem', opacity: 0.4 }}>🗺️</div>
            <span style={{ fontSize: '0.95rem' }}>
              {selectedSiteId ? 'No floor maps configured for this site' : 'Select a site to view its floor map'}
            </span>
          </div>
        )}
      </div>

    </div>
  )
}
