import { useState, useEffect } from 'react'
import FloorMapManager from './PortSecurity/FloorMapManager.jsx'
import SwitchStackVisualizer from './PortSecurity/SwitchStackVisualizer.jsx'
import PortResetPanel from './PortSecurity/PortResetPanel.jsx'
import { getSites, getMap } from '../api/client.js'

const TOOLS = [
  { value: 'port-security', label: '🔒 Port Security Reset' },
]

export default function DeploymentTools() {
  const [tool, setTool]             = useState('')
  const [switches, setSwitches]     = useState([])
  const [currentMap, setCurrentMap] = useState(null)
  const [selectedSeat, setSelectedSeat] = useState(null)

  // Site state
  const [sites, setSites]               = useState([])
  const [selectedSiteId, setSelectedSiteId] = useState('')

  useEffect(() => {
    getSites().then(r => setSites(r.data)).catch(() => {})
  }, [])

  const selectedSite = sites.find(s => s.id === parseInt(selectedSiteId)) || null

  // When site changes: auto-load the site's map
  const handleSiteChange = async (id) => {
    setSelectedSiteId(id)
    setCurrentMap(null)
    setSelectedSeat(null)
    const site = sites.find(s => s.id === parseInt(id))
    if (site?.maps?.length > 0) {
      try {
        const res = await getMap(site.maps[0].id)
        setCurrentMap(res.data)
      } catch(e) {}
    }
  }

  // Switches scoped to site (or all if no site selected)
  const handleSwitchesChange = (allSwitches) => {
    setSwitches(allSwitches)
  }

  const displaySwitches = selectedSite
    ? switches.filter(sw => selectedSite.switches.some(s => s.id === sw.id))
    : switches

  const siteMapIds = selectedSite ? new Set(selectedSite.maps.map(m => m.id)) : null

  return (
    <div>
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <h3>Deployment Tool</h3>
          <span className="badge badge-cyan">Network Automation</span>
        </div>
        <div className="card-body">
          <div className="form-row">
            <div className="form-group" style={{ flex: 1 }}>
              <label>Select Tool</label>
              <select
                id="deployment-tool-select"
                className="select"
                value={tool}
                onChange={e => { setTool(e.target.value); setSelectedSeat(null); setSelectedSiteId('') }}
              >
                <option value="">— Choose a tool —</option>
                {TOOLS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>

            {tool === 'port-security' && (
              <div className="form-group" style={{ flex: 1 }}>
                <label>Site</label>
                <select
                  className="select"
                  value={selectedSiteId}
                  onChange={e => handleSiteChange(e.target.value)}
                >
                  <option value="">— All sites —</option>
                  {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}
          </div>
        </div>
      </div>

      {tool === 'port-security' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Row 1: Floor Map Manager */}
          <FloorMapManager
            switches={displaySwitches}
            onSwitchesChange={handleSwitchesChange}
            currentMap={currentMap}
            onMapChange={setCurrentMap}
            onSeatSelect={setSelectedSeat}
            selectedSeat={selectedSeat}
            hideSelector
            readOnly
          />

          {/* Row 2: Switch Stack + Port Reset side by side */}
          <div className="grid-2" style={{ alignItems: 'start' }}>
            <SwitchStackVisualizer switches={displaySwitches} currentMap={currentMap} />
            <PortResetPanel seat={selectedSeat} switches={displaySwitches} />
          </div>
        </div>
      )}

      {!tool && (
        <div className="card">
          <div className="card-body" style={{ textAlign: 'center', padding: '48px 24px' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>🛠️</div>
            <h3 style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>
              Select a deployment tool above to get started
            </h3>
          </div>
        </div>
      )}
    </div>
  )
}
