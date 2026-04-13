import { useState, useEffect } from 'react'
import FloorMapManager from './PortSecurity/FloorMapManager.jsx'
import { getSites, getMap } from '../api/client.js'

export default function Locations() {
  const [sites, setSites]               = useState([])
  const [selectedSiteId, setSelectedSiteId] = useState('')
  const [currentMap, setCurrentMap]     = useState(null)
  const [selectedMapId, setSelectedMapId] = useState('')
  const [loading, setLoading]           = useState(false)

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
    <div>
      {/* ── Site / Map selector ── */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <h3>Site</h3>
          <span className="badge badge-cyan">Floor Maps</span>
        </div>
        <div className="card-body">
          <div className="form-row">
            <div className="form-group" style={{ flex: 1 }}>
              <label>Select Site</label>
              <select
                className="select"
                value={selectedSiteId}
                onChange={e => handleSiteChange(e.target.value)}
              >
                <option value="">— Choose a site —</option>
                {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>

          {/* Map tabs — only shown when site has multiple floor plans */}
          {selectedSite?.maps?.length > 1 && (
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              {selectedSite.maps.map(m => (
                <button
                  key={m.id}
                  className={`btn ${selectedMapId === String(m.id) ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ fontSize: '0.78rem' }}
                  onClick={() => handleMapTabChange(m.id)}
                >
                  🗺️ {m.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Floor map (read-only) ── */}
      {loading && (
        <div className="card">
          <div className="card-body" style={{ textAlign: 'center', padding: '48px 24px' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>⏳</div>
            <h3 style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>Loading map…</h3>
          </div>
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
        />
      )}

      {/* ── Empty states ── */}
      {!loading && !selectedSiteId && (
        <div className="card">
          <div className="card-body" style={{ textAlign: 'center', padding: '48px 24px' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>📍</div>
            <h3 style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>
              Select a site above to view its floor map
            </h3>
          </div>
        </div>
      )}

      {!loading && selectedSiteId && !currentMap && (
        <div className="card">
          <div className="card-body" style={{ textAlign: 'center', padding: '48px 24px' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>🗺️</div>
            <h3 style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>
              No floor maps configured for this site
            </h3>
          </div>
        </div>
      )}
    </div>
  )
}
