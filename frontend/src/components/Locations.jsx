import { useState, useEffect } from 'react'
import FloorMapManager from './PortSecurity/FloorMapManager.jsx'
import { getSites, getMap } from '../api/client.js'

export default function Locations() {
  const [sites, setSites]                   = useState([])
  const [selectedSiteId, setSelectedSiteId] = useState('')
  const [currentMap, setCurrentMap]         = useState(null)
  const [selectedMapId, setSelectedMapId]   = useState('')
  const [loading, setLoading]               = useState(false)

  useEffect(() => {
    getSites().then(r => setSites(r.data)).catch(() => {})
  }, [])

  const selectedSite = sites.find(s => s.id === parseInt(selectedSiteId)) || null

  const handleSiteChange = async (id) => {
    setSelectedSiteId(id)
    setCurrentMap(null)
    setSelectedMapId('')
    const site = sites.find(s => s.id === parseInt(id))
    if (site?.maps?.length > 0) {
      setLoading(true)
      try {
        const res = await getMap(site.maps[0].id)
        setCurrentMap(res.data)
        setSelectedMapId(String(site.maps[0].id))
      } catch(e) {}
      setLoading(false)
    }
  }

  const handleMapTabChange = async (mapId) => {
    if (String(mapId) === selectedMapId) return
    setSelectedMapId(String(mapId))
    setLoading(true)
    try {
      const res = await getMap(mapId)
      setCurrentMap(res.data)
    } catch(e) {}
    setLoading(false)
  }

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

      {/* ── Left panel: site / floor selectors ── */}
      <div style={{
        width: 232,
        flexShrink: 0,
        background: 'var(--bg-surface)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
        padding: '20px 16px',
        gap: 24,
      }}>

        {/* Site selector */}
        <div>
          <div style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>
            Site
          </div>
          <select
            className="select"
            value={selectedSiteId}
            onChange={e => handleSiteChange(e.target.value)}
            style={{ width: '100%' }}
          >
            <option value="">— Choose a site —</option>
            {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        {/* Floor / map tabs */}
        {selectedSite?.maps?.length > 0 && (
          <div>
            <div style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>
              Floor
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {selectedSite.maps.map(m => (
                <button
                  key={m.id}
                  onClick={() => handleMapTabChange(m.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 10px', borderRadius: 'var(--radius-sm)',
                    border: selectedMapId === String(m.id) ? '1px solid var(--cyan)' : '1px solid transparent',
                    background: selectedMapId === String(m.id) ? 'var(--cyan-dim, rgba(6,182,212,0.1))' : 'transparent',
                    color: selectedMapId === String(m.id) ? 'var(--cyan)' : 'var(--text-secondary)',
                    fontSize: '0.82rem', fontWeight: selectedMapId === String(m.id) ? 600 : 400,
                    cursor: 'pointer', textAlign: 'left', width: '100%',
                    transition: 'all 0.15s',
                  }}
                >
                  <span style={{ fontSize: '0.9rem' }}>🗺️</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Stats strip when map is loaded */}
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
            </div>
          </div>
        )}

        {/* Empty state */}
        {!selectedSiteId && (
          <div style={{ marginTop: 8 }}>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
              Select a site to view its floor map and zone assignments.
            </p>
          </div>
        )}

        {selectedSiteId && !loading && !currentMap && (
          <div style={{ marginTop: 8 }}>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
              No floor maps configured for this site.
            </p>
          </div>
        )}
      </div>

      {/* ── Map area: fills all remaining space ── */}
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
            onSeatSelect={() => {}}
            selectedSeat={null}
            hideSelector
            readOnly
            fullScreen
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
