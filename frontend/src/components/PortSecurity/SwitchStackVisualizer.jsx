export default function SwitchStackVisualizer({ switches, currentMap }) {
  const seats = currentMap?.seats || []

  // Build a map: switch_id → [seats]
  const switchSeats = {}
  for (const sw of switches) { switchSeats[sw.id] = [] }
  for (const seat of seats) {
    if (seat.switch_id && switchSeats[seat.switch_id]) {
      switchSeats[seat.switch_id].push(seat)
    }
  }

  if (switches.length === 0) {
    return (
      <div className="card">
        <div className="card-header"><h3>🔌 Switch Stack</h3></div>
        <div className="card-body" style={{ textAlign: 'center', padding: 32 }}>
          <div style={{ fontSize: '2rem', marginBottom: 8 }}>📡</div>
          <p className="text-sm text-muted">No switches registered yet.<br />Add switches in the Floor Map Manager.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="card">
      <div className="card-header">
        <h3>🔌 Switch Stack Visualizer</h3>
        <span className="badge badge-gray">{switches.length} unit{switches.length !== 1 ? 's' : ''}</span>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {[...switches].sort((a, b) => a.stack_position - b.stack_position).map(sw => {
          const mapped = switchSeats[sw.id] || []
          return (
            <div key={sw.id} className="switch-unit">
              <div className="switch-unit-header">
                <span style={{ fontSize: '1.1rem' }}>📡</span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{sw.name}</div>
                  <div className="font-mono" style={{ fontSize: '0.72rem', color: 'var(--cyan)' }}>{sw.ip_address}</div>
                </div>
                <div className="ml-auto">
                  <span className="badge badge-gray">Stack #{sw.stack_position}</span>
                </div>
                <span className={`badge ${mapped.length > 0 ? 'badge-green' : 'badge-gray'}`}>
                  {mapped.length} port{mapped.length !== 1 ? 's' : ''} mapped
                </span>
              </div>

              {mapped.length === 0 ? (
                <div style={{ padding: '10px 16px' }} className="text-xs text-muted">
                  No seats mapped to this switch yet.
                </div>
              ) : (
                <div className="port-grid">
                  {[...mapped].sort((a, b) => a.port.localeCompare(b.port, undefined, { numeric: true })).map(seat => (
                    <div key={seat.id} className="port-chip mapped" title={`Seat: ${seat.seat_label}`}>
                      <span style={{ fontSize: '0.7rem' }}>🪑</span>
                      <span style={{ fontWeight: 700 }}>{seat.seat_label}</span>
                      <span style={{ fontSize: '0.6rem', opacity: 0.8 }}>{seat.port.replace(/GigabitEthernet|FastEthernet/g, 'Gi').replace('gigabitethernet', 'Gi')}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Legend */}
              {mapped.length > 0 && (
                <div style={{ padding: '4px 16px 10px', display: 'flex', gap: 12 }} className="text-xs text-muted">
                  <span><span className="badge badge-green" style={{ fontSize: '0.6rem' }}>●</span> Mapped</span>
                  <span style={{ marginLeft: 'auto' }}>Port → Seat</span>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
