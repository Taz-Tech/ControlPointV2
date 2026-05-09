import { useState, useEffect, useContext } from 'react'
import { api } from '../../api/client.js'
import { ClientContext } from '../../ClientContext.js'
import TicketQueue from './TicketQueue.jsx'
import TicketBoard from './TicketBoard.jsx'
import TicketDetail from './TicketDetail.jsx'
import TicketDashboard from './TicketDashboard.jsx'
import TaskView from './TaskView.jsx'
import NewTicketModal from './NewTicketModal.jsx'
import ProjectBoard from './ProjectBoard.jsx'
import KnowledgeBase from './KnowledgeBase.jsx'
import ChangeManagement from './ChangeManagement.jsx'
import ProblemManagement from './ProblemManagement.jsx'
import IntegrationTicketView, { SetupPrompt } from './IntegrationTicketView.jsx'

const FILTER_TITLE = {
  all: 'All open', mine: 'My tickets', unassigned: 'Unassigned', sla_breach: 'SLA Breach',
  resolved: 'Resolved', overdue: 'Overdue', due_today: 'Due today', on_hold: 'On hold',
  in_progress: 'In progress', open: 'Open',
}

const TICKET_FILTERS = [
  { id: 'all',        label: 'All'        },
  { id: 'mine',       label: 'Mine'       },
  { id: 'unassigned', label: 'Unassigned' },
  { id: 'sla_breach', label: 'SLA Breach' },
  { id: 'resolved',   label: 'Resolved'   },
]

export default function TicketingWorkspace({ section = 'dashboard', onNavigate, externalRefresh = 0, openTicketId = null, activeDetailId = null, onNavigateDetail }) {
  const { selectedClient } = useContext(ClientContext)
  const [ticketFilter,   setTicketFilter]   = useState('all')
  const [viewMode,       setViewMode]       = useState('list')   // 'list' | 'board'
  const [stats,          setStats]          = useState({})
  const [selectedTicket, setSelectedTicket] = useState(() =>
    activeDetailId ? { id: parseInt(activeDetailId) || activeDetailId } : null
  )
  const [showNew,        setShowNew]        = useState(null)
  const [refresh,        setRefresh]        = useState(0)
  const [ticketMode,     setTicketMode]     = useState(null)  // null=loading, {mode,native,provider,configured}

  const combinedRefresh = refresh + externalRefresh

  // Fetch ticketing mode (native vs integration) once on mount
  useEffect(() => {
    api.get('/api/ticket-integration/mode')
      .then(r => setTicketMode(r.data))
      .catch(() => setTicketMode({ mode: 'none', native: false, provider: null, configured: false }))
  }, [])

  // Reset when switching sections; navigate() already cleared the hash ID
  useEffect(() => { setSelectedTicket(null) }, [section])

  // Sync with browser back button: when activeDetailId is cleared externally, close detail
  useEffect(() => {
    if (!activeDetailId) setSelectedTicket(null)
  }, [activeDetailId])

  useEffect(() => {
    if (openTicketId) {
      setSelectedTicket({ id: openTicketId })
      onNavigateDetail?.(openTicketId)
    }
  }, [openTicketId])

  const selectTicket = (ticket) => {
    setSelectedTicket(ticket)
    onNavigateDetail?.(ticket?.id ?? null)
  }

  useEffect(() => {
    const params = selectedClient ? { customer_id: selectedClient.id } : {}
    api.get('/api/tickets/stats/summary', { params }).then(r => setStats(r.data)).catch(() => {})
  }, [combinedRefresh, selectedClient])

  const onTicketCreated = () => { setRefresh(r => r + 1); setShowNew(null) }
  const onTicketUpdated = () => setRefresh(r => r + 1)

  // Still loading mode
  if (!ticketMode) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontSize: '0.88rem' }}>Loading…</div>
  }

  // Integration mode — delegate entirely to the integration view
  if (!ticketMode.native) {
    if (ticketMode.provider && ticketMode.configured) {
      return <IntegrationTicketView provider={ticketMode.provider} />
    }
    return <SetupPrompt />
  }

  if (selectedTicket) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        <TicketDetail ticketId={selectedTicket.id} onBack={() => selectTicket(null)} onUpdated={onTicketUpdated} />
        {showNew !== null && (
          <NewTicketModal defaultType={showNew || 'incident'} onClose={() => setShowNew(null)} onCreated={onTicketCreated} />
        )}
      </div>
    )
  }

  const renderSection = () => {
    switch (section) {

      case 'dashboard':
        return <TicketDashboard
          onSelect={selectTicket}
          onViewTickets={(filter) => { setTicketFilter(filter); onNavigate('tkt_tickets') }}
          refresh={combinedRefresh}
        />

      case 'tickets':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            {/* Toolbar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', flexShrink: 0 }}>
              {/* Filter tabs */}
              <div style={{ display: 'flex', gap: 2, flex: 1 }}>
                {TICKET_FILTERS.map(f => (
                  <button key={f.id} onClick={() => setTicketFilter(f.id)} style={{
                    padding: '4px 12px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: '0.78rem',
                    background: ticketFilter === f.id ? 'var(--cyan-dim)' : 'transparent',
                    color:      ticketFilter === f.id ? 'var(--cyan)'     : 'var(--text-muted)',
                    fontWeight: ticketFilter === f.id ? 700 : 400,
                    display: 'flex', alignItems: 'center', gap: 5,
                  }}>
                    {f.label}
                    {f.id === 'unassigned' && stats.unassigned > 0 && <span className="tkt-badge dim">{stats.unassigned}</span>}
                    {f.id === 'sla_breach' && stats.sla_breached > 0 && <span className="tkt-badge red">{stats.sla_breached}</span>}
                  </button>
                ))}
              </div>
              {/* View toggle */}
              <div style={{ display: 'flex', background: 'var(--bg-elevated)', borderRadius: 8, padding: 2, gap: 2 }}>
                {[{ id: 'list', icon: '☰' }, { id: 'board', icon: '⊞' }].map(v => (
                  <button key={v.id} onClick={() => setViewMode(v.id)} style={{
                    padding: '4px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: '0.9rem',
                    background: viewMode === v.id ? 'var(--bg-surface)' : 'transparent',
                    color:      viewMode === v.id ? 'var(--cyan)'       : 'var(--text-muted)',
                    boxShadow:  viewMode === v.id ? 'var(--shadow-card)' : 'none',
                    transition: 'all 0.15s',
                  }}>{v.icon}</button>
                ))}
              </div>
            </div>
            {viewMode === 'list'
              ? <TicketQueue filter={ticketFilter} title={FILTER_TITLE[ticketFilter]} onSelect={selectTicket} onNew={null} refresh={combinedRefresh} hideToolbarNew />
              : <TicketBoard onSelect={selectTicket} refresh={combinedRefresh} />
            }
          </div>
        )

      case 'tasks':
        return <TaskView onSelect={selectTicket} refresh={combinedRefresh} />

      case 'change':
        return <ChangeManagement onSelect={selectTicket} onNew={() => setShowNew('change')} refresh={combinedRefresh} />

      case 'problems':
        return <ProblemManagement onSelect={selectTicket} onNew={() => setShowNew('problem')} refresh={combinedRefresh} />

      case 'projects':
        return <ProjectBoard onSelect={selectTicket} refresh={combinedRefresh} />

      case 'kb':
        return <KnowledgeBase />

      default:
        return null
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {renderSection()}
      {showNew !== null && (
        <NewTicketModal defaultType={showNew || 'incident'} onClose={() => setShowNew(null)} onCreated={onTicketCreated} />
      )}
    </div>
  )
}
