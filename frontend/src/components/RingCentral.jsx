import { useState, useEffect, useContext, useCallback, useMemo } from 'react'
import { UserContext } from '../App.jsx'
import { getRCPresence, updateRCPresence, getRCPresenceReport, getRCBusinessHours, saveRCBusinessHours } from '../api/client.js'

// ── Status helpers ────────────────────────────────────────────────────────────

const STAFF_STATUS_OPTIONS = [
  { value: 'Available', label: 'Available', body: { dnd_status: 'TakeAllCalls',       user_status: 'Available', label: 'Available' } },
  { value: 'Busy',      label: 'Busy',      body: { dnd_status: 'TakeAllCalls',       user_status: 'Busy',      label: 'Busy'      } },
  { value: 'DND',       label: 'DND',       body: { dnd_status: 'DoNotAcceptAnyCalls',                          label: 'DND'       } },
  { value: 'Lunch',     label: 'Lunch',     body: { dnd_status: 'DoNotAcceptAnyCalls',                          label: 'Lunch'     } },
  { value: 'Break',     label: 'Break',     body: { dnd_status: 'DoNotAcceptAnyCalls',                          label: 'Break'     } },
]

const STATUS_META = {
  Available: { dot: '#22c55e', bg: 'rgba(34,197,94,0.12)',  label: 'Available' },
  Busy:      { dot: '#f59e0b', bg: 'rgba(245,158,11,0.12)', label: 'Busy'      },
  'On Call': { dot: '#3b82f6', bg: 'rgba(59,130,246,0.12)', label: 'On Call'   },
  DND:       { dot: '#ef4444', bg: 'rgba(239,68,68,0.12)',  label: 'DND'       },
  Lunch:     { dot: '#a855f7', bg: 'rgba(168,85,247,0.12)', label: 'Lunch'     },
  Break:     { dot: '#ec4899', bg: 'rgba(236,72,153,0.12)', label: 'Break'     },
  Offline:   { dot: '#6b7280', bg: 'rgba(107,114,128,0.1)', label: 'Offline'   },
}

const STATUS_ORDER = ['Available', 'Busy', 'On Call', 'DND', 'Lunch', 'Break', 'Offline']

function StatusDot({ status, size = 10 }) {
  const meta = STATUS_META[status] || STATUS_META.Offline
  return (
    <span style={{
      display: 'inline-block',
      width: size, height: size,
      borderRadius: '50%',
      background: meta.dot,
      flexShrink: 0,
      boxShadow: status !== 'Offline' ? `0 0 0 2px ${meta.dot}33` : 'none',
    }} />
  )
}

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.Offline
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '2px 8px', borderRadius: 20,
      background: meta.bg,
      fontSize: '0.72rem', fontWeight: 600,
      color: meta.dot, whiteSpace: 'nowrap',
    }}>
      <StatusDot status={status} size={7} />
      {meta.label}
    </span>
  )
}

// ── User row ──────────────────────────────────────────────────────────────────

function UserRow({ user, canManage, onStatusChange }) {
  const [updating, setUpdating] = useState(false)
  const [err, setErr] = useState(null)

  const handleStatusSelect = async (e) => {
    const option = STAFF_STATUS_OPTIONS.find(o => o.value === e.target.value)
    if (!option) return
    setErr(null)
    setUpdating(true)
    try {
      await updateRCPresence(user.id, option.body)
      onStatusChange(user.id, {
        dnd_status: option.body.dnd_status,
        status: option.value,
      })
    } catch (e) {
      setErr(e.response?.data?.detail || 'Failed to update')
    } finally {
      setUpdating(false)
    }
  }

  const selectValue = STAFF_STATUS_OPTIONS.find(o => o.value === user.status) ? user.status : ''

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '8px 12px',
      borderBottom: '1px solid var(--border)',
    }}>
      {/* Avatar */}
      <div style={{
        width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
        background: 'linear-gradient(135deg, var(--cyan), #818cf8)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '0.65rem', fontWeight: 700, color: '#000', position: 'relative',
      }}>
        {user.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?'}
        <span style={{
          position: 'absolute', bottom: -1, right: -1,
          width: 10, height: 10, borderRadius: '50%',
          background: STATUS_META[user.status]?.dot || '#6b7280',
          border: '1.5px solid var(--bg-elevated)',
        }} />
      </div>

      {/* Name + extension */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {user.name}
        </div>
        {user.extension && (
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>ext. {user.extension}</div>
        )}
      </div>

      {/* Status badge */}
      <StatusBadge status={user.status} />

      {/* Status selector */}
      {canManage && (
        <div style={{ flexShrink: 0 }}>
          {err && <span style={{ fontSize: '0.65rem', color: 'var(--danger)', marginRight: 6 }}>{err}</span>}
          <select
            className="input"
            style={{ fontSize: '0.72rem', padding: '3px 6px', width: 'auto', opacity: updating ? 0.6 : 1 }}
            value={selectValue}
            onChange={handleStatusSelect}
            disabled={updating}
          >
            {!selectValue && <option value="" disabled>Set status…</option>}
            {STAFF_STATUS_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  )
}

// ── Department card ───────────────────────────────────────────────────────────

function DepartmentCard({ dept, canManage, onStatusChange, searchTerm, filterStatus }) {
  const [open, setOpen] = useState(true)

  const filtered = dept.users.filter(u => {
    const matchSearch = !searchTerm || u.name.toLowerCase().includes(searchTerm) || u.extension.includes(searchTerm)
    const matchStatus = !filterStatus || u.status === filterStatus
    return matchSearch && matchStatus
  })

  if (filtered.length === 0) return null

  const counts = filtered.reduce((acc, u) => {
    acc[u.status] = (acc[u.status] || 0) + 1
    return acc
  }, {})

  return (
    <div style={{
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
      marginBottom: 12,
    }}>
      {/* Department header */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 14px', background: 'none', border: 'none',
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginRight: 2 }}>
          {open ? '▾' : '▸'}
        </span>
        <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)', flex: 1 }}>
          {dept.name}
        </span>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginRight: 8 }}>
          {filtered.length} {filtered.length === 1 ? 'user' : 'users'}
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          {STATUS_ORDER.filter(s => counts[s]).map(s => (
            <span key={s} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: '0.68rem', color: STATUS_META[s].dot }}>
              <StatusDot status={s} size={7} />{counts[s]}
            </span>
          ))}
        </div>
      </button>

      {open && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          {filtered.map(user => (
            <UserRow
              key={user.id}
              user={user}
              canManage={canManage}
              onStatusChange={onStatusChange}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Stats bar ─────────────────────────────────────────────────────────────────

function StatsBar({ totals }) {
  const items = [
    { key: 'total',     label: 'Total',     color: 'var(--text-secondary)', dot: false },
    { key: 'available', label: 'Available', ...STATUS_META.Available,       dot: true  },
    { key: 'busy',      label: 'Busy',      ...STATUS_META.Busy,            dot: true  },
    { key: 'on_call',   label: 'On Call',   ...STATUS_META['On Call'],      dot: true  },
    { key: 'dnd',       label: 'DND',       ...STATUS_META.DND,             dot: true  },
    { key: 'offline',   label: 'Offline',   ...STATUS_META.Offline,         dot: true  },
  ]

  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: 12,
      padding: '12px 16px',
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)',
      marginBottom: 16,
    }}>
      {items.map(item => (
        <div key={item.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {item.dot && <StatusDot status={item.label} size={9} />}
          <span style={{ fontSize: '1rem', fontWeight: 700, color: item.dot ? item.dot : 'var(--text-primary)' }}>
            {totals[item.key] ?? 0}
          </span>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{item.label}</span>
        </div>
      ))}
    </div>
  )
}

// ── Reports ───────────────────────────────────────────────────────────────────

const REPORT_COLS = ['Available', 'Busy', 'On Call', 'DND', 'Lunch', 'Break']

const REPORT_COLORS = {
  Available: '#22c55e',
  Busy:      '#f59e0b',
  'On Call': '#3b82f6',
  DND:       '#ef4444',
  Lunch:     '#a855f7',
  Break:     '#ec4899',
  Offline:   '#6b7280',
}

function fmtDuration(secs) {
  if (!secs || secs < 60) return '—'
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function ReportBadge({ status }) {
  const color = REPORT_COLORS[status] || '#6b7280'
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 12,
      background: `${color}22`,
      fontSize: '0.7rem', fontWeight: 600, color,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
      {status}
    </span>
  )
}

// ── Business Hours helpers ────────────────────────────────────────────────────

const DAY_LABELS = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun' }

const TIMEZONES = [
  { value: 'UTC',                 label: 'UTC' },
  { group: 'United States' },
  { value: 'America/New_York',    label: 'Eastern Time (ET)' },
  { value: 'America/Chicago',     label: 'Central Time (CT)' },
  { value: 'America/Denver',      label: 'Mountain Time (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
  { value: 'America/Phoenix',     label: 'Arizona – no DST (MST)' },
  { value: 'America/Anchorage',   label: 'Alaska Time (AKT)' },
  { value: 'Pacific/Honolulu',    label: 'Hawaii Time (HST)' },
  { group: 'Canada' },
  { value: 'America/Toronto',     label: 'Toronto (ET)' },
  { value: 'America/Vancouver',   label: 'Vancouver (PT)' },
  { value: 'America/Edmonton',    label: 'Edmonton (MT)' },
  { value: 'America/Winnipeg',    label: 'Winnipeg (CT)' },
  { value: 'America/Halifax',     label: 'Halifax (AT)' },
  { group: 'Latin America' },
  { value: 'America/Mexico_City', label: 'Mexico City (CST/CDT)' },
  { value: 'America/Sao_Paulo',   label: 'São Paulo (BRT)' },
  { value: 'America/Bogota',      label: 'Bogotá (COT)' },
  { group: 'Europe' },
  { value: 'Europe/London',       label: 'London (GMT/BST)' },
  { value: 'Europe/Paris',        label: 'Central European (CET/CEST)' },
  { value: 'Europe/Helsinki',     label: 'Eastern European (EET/EEST)' },
  { value: 'Europe/Moscow',       label: 'Moscow (MSK)' },
  { group: 'Middle East & Africa' },
  { value: 'Asia/Dubai',          label: 'Dubai (GST)' },
  { value: 'Asia/Riyadh',         label: 'Riyadh (AST)' },
  { value: 'Africa/Cairo',        label: 'Cairo (EET)' },
  { value: 'Africa/Johannesburg', label: 'Johannesburg (SAST)' },
  { group: 'Asia & Pacific' },
  { value: 'Asia/Kolkata',        label: 'India (IST)' },
  { value: 'Asia/Bangkok',        label: 'Bangkok (ICT)' },
  { value: 'Asia/Singapore',      label: 'Singapore (SGT)' },
  { value: 'Asia/Shanghai',       label: 'China (CST)' },
  { value: 'Asia/Tokyo',          label: 'Japan (JST)' },
  { value: 'Asia/Seoul',          label: 'Seoul (KST)' },
  { value: 'Australia/Sydney',    label: 'Sydney (AEST/AEDT)' },
  { value: 'Australia/Perth',     label: 'Perth (AWST)' },
  { value: 'Pacific/Auckland',    label: 'Auckland (NZST/NZDT)' },
]

const TZ_LABELS = Object.fromEntries(TIMEZONES.filter(t => t.value).map(t => [t.value, t.label]))

function fmt12h(h) {
  if (h === 0)  return '12:00 AM'
  if (h < 12)   return `${h}:00 AM`
  if (h === 12) return '12:00 PM'
  return `${h - 12}:00 PM`
}

const _tzFmtCache = {}
function _getTZParts(utcDate, tz) {
  if (!_tzFmtCache[tz]) {
    _tzFmtCache[tz] = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, weekday: 'long',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    })
  }
  const parts = Object.fromEntries(_tzFmtCache[tz].formatToParts(utcDate).map(p => [p.type, p.value]))
  const WMAP  = { Sunday: 7, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 }
  return {
    hour:   parseInt(parts.hour,   10) % 24,
    minute: parseInt(parts.minute, 10),
    second: parseInt(parts.second, 10),
    isoDay: WMAP[parts.weekday],
  }
}

function splitEvent(ev, bizHours) {
  const { start: bhStart, end: bhEnd, days: bhDays, timezone: tz = 'UTC' } = bizHours
  const evStart = new Date(ev.timestamp)
  const evEnd   = new Date(evStart.getTime() + ev.duration_seconds * 1000)
  let bhMs = 0, t = new Date(evStart)
  while (t < evEnd) {
    const { hour, minute, second, isoDay } = _getTZParts(t, tz)
    const msToNext = ((60 - minute - 1) * 60 + (60 - second)) * 1000
    const next     = new Date(t.getTime() + msToNext)
    const segEnd   = next < evEnd ? next : evEnd
    if (bhDays.includes(isoDay) && hour >= bhStart && hour < bhEnd) bhMs += segEnd - t
    t = next
  }
  const bhSecs = Math.round(bhMs / 1000)
  return { bhSecs: Math.max(0, bhSecs), ahSecs: Math.max(0, ev.duration_seconds - bhSecs) }
}

function computeSplitSummary(events, bizHours, mode) {
  const STATUSES = ['Available', 'Busy', 'On Call', 'DND', 'Lunch', 'Break', 'Offline']
  const byUser = {}
  for (const ev of events) {
    const { bhSecs, ahSecs } = splitEvent(ev, bizHours)
    const secs = mode === 'bh' ? bhSecs : ahSecs
    if (secs <= 0) continue
    if (!byUser[ev.user_id])
      byUser[ev.user_id] = { user_id: ev.user_id, user_name: ev.user_name, totals: Object.fromEntries(STATUSES.map(s => [s, 0])) }
    byUser[ev.user_id].totals[ev.status] = (byUser[ev.user_id].totals[ev.status] || 0) + secs
  }
  return Object.values(byUser).sort((a, b) => a.user_name.localeCompare(b.user_name))
}

function computeAHOnCall(events, bizHours) {
  const byUser = {}
  for (const ev of events) {
    if (ev.status !== 'On Call') continue
    const { ahSecs } = splitEvent(ev, bizHours)
    if (ahSecs <= 0) continue
    if (!byUser[ev.user_id])
      byUser[ev.user_id] = { user_id: ev.user_id, user_name: ev.user_name, totalSecs: 0, count: 0 }
    byUser[ev.user_id].totalSecs += ahSecs
    byUser[ev.user_id].count++
  }
  return Object.values(byUser).sort((a, b) => b.totalSecs - a.totalSecs)
}

// ── Business Hours config panel ───────────────────────────────────────────────

function BusinessHoursPanel({ bizHours, onSaved, isAdmin }) {
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState({ ...bizHours })
  const [saving,  setSaving]  = useState(false)
  const [msg,     setMsg]     = useState(null)

  useEffect(() => { setDraft({ ...bizHours }) }, [bizHours])

  const toggleDay = d =>
    setDraft(p => ({
      ...p,
      days: p.days.includes(d) ? p.days.filter(x => x !== d) : [...p.days, d].sort((a, b) => a - b),
    }))

  const handleSave = async () => {
    setSaving(true); setMsg(null)
    try {
      const r = await saveRCBusinessHours(draft)
      onSaved(r.data)
      setEditing(false)
    } catch (e) { setMsg(e.response?.data?.detail || 'Save failed') }
    finally { setSaving(false) }
  }

  const daysSummary = (() => {
    const d = [...bizHours.days].sort((a, b) => a - b)
    if (JSON.stringify(d) === '[1,2,3,4,5]') return 'Mon–Fri'
    if (d.length === 7) return 'Every day'
    return d.map(x => DAY_LABELS[x]).join(', ')
  })()

  const tzLabel = TZ_LABELS[bizHours.timezone] || bizHours.timezone || 'UTC'

  return (
    <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', marginBottom: 16, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Business Hours
        </span>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          {daysSummary} · {fmt12h(bizHours.start)} – {fmt12h(bizHours.end)}
        </span>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 7px' }}>
          {tzLabel}
        </span>
        <div style={{ flex: 1 }} />
        {isAdmin && (
          <button className="btn btn-ghost" style={{ fontSize: '0.72rem', padding: '3px 8px' }} onClick={() => setEditing(e => !e)}>
            {editing ? 'Cancel' : 'Edit'}
          </button>
        )}
      </div>

      {editing && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', minWidth: 64 }}>Days</span>
            <div style={{ display: 'flex', gap: 4 }}>
              {[1,2,3,4,5,6,7].map(d => (
                <button
                  key={d}
                  onClick={() => toggleDay(d)}
                  style={{
                    width: 36, height: 28, borderRadius: 4,
                    border: `1px solid ${draft.days.includes(d) ? 'var(--cyan)' : 'var(--border)'}`,
                    background: draft.days.includes(d) ? 'var(--cyan)' : 'var(--bg-base)',
                    color: draft.days.includes(d) ? '#000' : 'var(--text-muted)',
                    fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  {DAY_LABELS[d]}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', minWidth: 64 }}>Hours</span>
            <select className="select" style={{ fontSize: '0.8rem', width: 'auto' }} value={draft.start} onChange={e => setDraft(p => ({ ...p, start: +e.target.value }))}>
              {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{fmt12h(i)}</option>)}
            </select>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>to</span>
            <select className="select" style={{ fontSize: '0.8rem', width: 'auto' }} value={draft.end} onChange={e => setDraft(p => ({ ...p, end: +e.target.value }))}>
              {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{fmt12h(i)}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', minWidth: 64 }}>Timezone</span>
            <select
              className="select"
              style={{ fontSize: '0.8rem', flex: '1 1 220px', maxWidth: 360 }}
              value={draft.timezone || 'UTC'}
              onChange={e => setDraft(p => ({ ...p, timezone: e.target.value }))}
            >
              {TIMEZONES.map((t, i) =>
                t.group
                  ? <optgroup key={i} label={t.group} />
                  : <option key={t.value} value={t.value}>{t.label}</option>
              )}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button className="btn btn-primary" style={{ fontSize: '0.78rem' }} onClick={handleSave} disabled={saving || !draft.days.length}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            {msg && <span style={{ fontSize: '0.75rem', color: 'var(--danger)' }}>{msg}</span>}
          </div>
        </div>
      )}
    </div>
  )
}

// ── After-Hours On-Call card ──────────────────────────────────────────────────

function AfterHoursOnCall({ users }) {
  return (
    <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', marginBottom: 20, overflow: 'hidden' }}>
      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>After-Hours On-Call</span>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
          {users.length} {users.length === 1 ? 'person' : 'people'}
        </span>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
        <thead>
          <tr style={{ background: 'var(--bg-base)' }}>
            <th style={{ padding: '7px 14px', textAlign: 'left', fontWeight: 600, color: 'var(--text-secondary)' }}>Staff Member</th>
            <th style={{ padding: '7px 10px', textAlign: 'center', fontWeight: 600, color: REPORT_COLORS['On Call'] }}>Time On Call</th>
            <th style={{ padding: '7px 10px', textAlign: 'center', fontWeight: 600, color: 'var(--text-secondary)' }}>Events</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u, i) => (
            <tr key={u.user_id} style={{ borderTop: '1px solid var(--border)', background: i % 2 ? 'var(--bg-base)' : 'transparent' }}>
              <td style={{ padding: '7px 14px', fontWeight: 600, color: 'var(--text-primary)' }}>{u.user_name}</td>
              <td style={{ padding: '7px 10px', textAlign: 'center', color: REPORT_COLORS['On Call'] }}>{fmtDuration(u.totalSecs)}</td>
              <td style={{ padding: '7px 10px', textAlign: 'center', color: 'var(--text-muted)' }}>{u.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Time Tracker ──────────────────────────────────────────────────────────────

const TRACKER_COLORS = {
  Available: '#22c55e',
  Busy:      '#f59e0b',
  'On Call': '#3b82f6',
  DND:       '#ef4444',
  Lunch:     '#a855f7',
  Break:     '#ec4899',
  Offline:   '#4b5563',
}

const NAME_COL = 140
const ROW_H    = 40
const AXIS_H   = 28

function TimeTracker({ events, range }) {
  const now   = new Date()
  // Always derive start in LOCAL time so "today" = local midnight, not UTC midnight
  const start = (() => {
    if (range === 'today') {
      const d = new Date(now)
      d.setHours(0, 0, 0, 0)
      return d
    }
    const msBack = range === 'week' ? 7 * 86400000 : 30 * 86400000
    return new Date(now.getTime() - msBack)
  })()
  const totalMs = now - start

  const INNER_W = range === 'today' ? 1920 : range === 'week' ? 1680 : 1800

  // Sort chronologically (API returns newest-first)
  const sorted = [...events].sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1))

  // Build per-user block lists, preserving first-seen order
  const userOrder = []
  const userMap   = {}
  for (const ev of sorted) {
    if (!userMap[ev.user_id]) {
      userOrder.push(ev.user_id)
      userMap[ev.user_id] = { name: ev.user_name, blocks: [] }
    }
    const evStart = new Date(ev.timestamp)
    const evEnd   = new Date(evStart.getTime() + ev.duration_seconds * 1000)
    const csMs    = Math.max(0, evStart - start)
    const ceMs    = Math.min(totalMs, evEnd   - start)
    if (ceMs <= csMs) continue
    userMap[ev.user_id].blocks.push({
      status: ev.status,
      left:   (csMs / totalMs) * INNER_W,
      width:  Math.max(3, ((ceMs - csMs) / totalMs) * INNER_W),
      tip:    `${ev.status}  ·  ${fmtDuration(ev.duration_seconds)}  ·  ${evStart.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
    })
  }
  const users = userOrder.map(id => userMap[id])

  // Time-axis tick marks
  const markers = []
  if (range === 'today') {
    for (let h = 0; h < 24; h++) {
      const t = new Date(start); t.setHours(h, 0, 0, 0)
      if (t >= start && t <= now)
        markers.push({ label: `${h}:00`, left: (t - start) / totalMs * INNER_W })
    }
  } else {
    const d = new Date(start); d.setHours(0, 0, 0, 0)
    while (d <= now) {
      markers.push({
        label: d.toLocaleDateString([], range === 'week'
          ? { weekday: 'short', month: 'short', day: 'numeric' }
          : { month: 'short', day: 'numeric' }),
        left: (d - start) / totalMs * INNER_W,
      })
      d.setDate(d.getDate() + 1)
    }
  }

  if (users.length === 0) return (
    <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
      No activity to display yet.
    </div>
  )

  return (
    <div style={{
      background: 'var(--bg-elevated)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)', overflow: 'hidden', marginBottom: 20,
    }}>
      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: '0.85rem' }}>
        Time Tracker
      </div>

      {/* Scrollable chart */}
      <div style={{ overflowX: 'auto', overflowY: 'hidden' }}>
        <div style={{ minWidth: NAME_COL + INNER_W }}>

          {/* ── Axis row ── */}
          <div style={{ display: 'flex', height: AXIS_H, background: 'var(--bg-base)', borderBottom: '2px solid var(--border)' }}>
            <div style={{
              width: NAME_COL, flexShrink: 0,
              position: 'sticky', left: 0, zIndex: 10,
              background: 'var(--bg-base)', borderRight: '1px solid var(--border)',
            }} />
            <div style={{ position: 'relative', width: INNER_W, flexShrink: 0, overflow: 'hidden' }}>
              {markers.map((m, i) => (
                <div key={i} style={{
                  position: 'absolute', top: '50%', left: m.left,
                  transform: 'translate(-50%, -50%)',
                  fontSize: '0.6rem', color: 'var(--text-muted)',
                  whiteSpace: 'nowrap', pointerEvents: 'none',
                }}>
                  {m.label}
                </div>
              ))}
            </div>
          </div>

          {/* ── User rows ── */}
          {users.map((user, ui) => (
            <div key={ui} style={{
              display: 'flex', height: ROW_H,
              borderBottom: '1px solid var(--border)',
              background: ui % 2 ? 'var(--bg-base)' : 'transparent',
            }}>
              {/* Sticky name cell */}
              <div style={{
                width: NAME_COL, flexShrink: 0,
                position: 'sticky', left: 0, zIndex: 5,
                background: ui % 2 ? 'var(--bg-base)' : 'var(--bg-elevated)',
                borderRight: '1px solid var(--border)',
                display: 'flex', alignItems: 'center', padding: '0 10px',
                fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary)',
                overflow: 'hidden', whiteSpace: 'nowrap',
              }}>
                {user.name}
              </div>

              {/* Timeline area */}
              <div style={{ position: 'relative', width: INNER_W, flexShrink: 0, height: '100%' }}>
                {/* Vertical grid lines */}
                {markers.map((m, i) => (
                  <div key={i} style={{
                    position: 'absolute', left: m.left, top: 0, bottom: 0,
                    width: 1, background: 'var(--border)', opacity: 0.6,
                    pointerEvents: 'none',
                  }} />
                ))}

                {/* Status blocks */}
                {user.blocks.map((block, bi) => (
                  <div
                    key={bi}
                    title={block.tip}
                    style={{
                      position: 'absolute',
                      left: block.left, width: block.width,
                      top: 7, bottom: 7, borderRadius: 3,
                      background: TRACKER_COLORS[block.status] || '#6b7280',
                      cursor: 'default',
                      transition: 'opacity 0.1s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.opacity = '0.7' }}
                    onMouseLeave={e => { e.currentTarget.style.opacity = '1'   }}
                  />
                ))}
              </div>
            </div>
          ))}

        </div>
      </div>

      {/* ── Legend — outside the scroll container so it never moves ── */}
      <div style={{
        display: 'flex', gap: 14, padding: '8px 14px',
        borderTop: '1px solid var(--border)', background: 'var(--bg-base)', flexWrap: 'wrap',
      }}>
        {Object.entries(TRACKER_COLORS).map(([status, color]) => (
          <div key={status} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 12, height: 10, borderRadius: 2, background: color, display: 'inline-block', flexShrink: 0 }} />
            <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{status}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function RCReports() {
  const { isAdmin } = useContext(UserContext)

  const [range,      setRange]      = useState('today')
  const [userId,     setUserId]     = useState('')
  const [data,       setData]       = useState(null)
  const [loading,    setLoading]    = useState(false)
  const [err,        setErr]        = useState(null)
  const [auditOpen,  setAuditOpen]  = useState(false)
  const [bizHours,   setBizHours]   = useState({ start: 8, end: 17, days: [1,2,3,4,5], timezone: 'UTC' })
  const [bhMode,     setBhMode]     = useState('all')

  useEffect(() => {
    getRCBusinessHours().then(r => setBizHours(r.data)).catch(() => {})
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const params = { range }
      if (userId) params.user_id = userId
      const r = await getRCPresenceReport(params)
      setData(r.data)
    } catch (e) {
      setErr(e.response?.data?.detail || 'Failed to load report')
    } finally {
      setLoading(false)
    }
  }, [range, userId])

  useEffect(() => { load() }, [load])

  const displaySummary = useMemo(() => {
    if (!data) return []
    if (bhMode === 'all') return data.summary
    return computeSplitSummary(data.events, bizHours, bhMode)
  }, [data, bizHours, bhMode])

  const ahOnCallUsers = useMemo(() => {
    if (!data?.events) return []
    return computeAHOnCall(data.events, bizHours)
  }, [data, bizHours])

  return (
    <div>
      {/* Business Hours config */}
      <BusinessHoursPanel bizHours={bizHours} onSaved={setBizHours} isAdmin={isAdmin} />

      {/* Controls */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        {[['today', 'Today'], ['week', 'This Week'], ['month', 'This Month']].map(([val, lbl]) => (
          <button
            key={val}
            className={range === val ? 'btn btn-primary' : 'btn btn-ghost'}
            style={{ fontSize: '0.78rem' }}
            onClick={() => setRange(val)}
          >
            {lbl}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        {data?.users?.length > 0 && (
          <select
            className="input"
            style={{ width: 'auto', fontSize: '0.8rem' }}
            value={userId}
            onChange={e => setUserId(e.target.value)}
          >
            <option value="">All Staff</option>
            {data.users.map(u => (
              <option key={u.user_id} value={u.user_id}>{u.user_name}</option>
            ))}
          </select>
        )}
        {data?.events?.length > 0 && (
          <button
            className="btn btn-ghost"
            style={{ fontSize: '0.78rem' }}
            onClick={() => setAuditOpen(true)}
          >
            Audit Log
          </button>
        )}
        <button
          className="btn btn-ghost"
          style={{ fontSize: '0.78rem' }}
          onClick={load}
          disabled={loading}
        >
          {loading ? '↻ Loading…' : '↻ Refresh'}
        </button>
      </div>

      {/* ── Audit modal ── */}
      {auditOpen && data && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 24,
          }}
          onClick={e => { if (e.target === e.currentTarget) setAuditOpen(false) }}
        >
          <div style={{
            background: 'var(--bg-elevated)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)', width: '100%', maxWidth: 720,
            maxHeight: '80vh', display: 'flex', flexDirection: 'column',
            boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
          }}>
            {/* Modal header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '14px 18px', borderBottom: '1px solid var(--border)', flexShrink: 0,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>Audit Log</span>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  {data.events.length} events
                </span>
              </div>
              <button
                className="btn btn-ghost"
                style={{ fontSize: '0.78rem', padding: '3px 10px' }}
                onClick={() => setAuditOpen(false)}
              >
                Close
              </button>
            </div>

            {/* Event list */}
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {data.events.map(ev => (
                <div key={ev.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '8px 18px', borderBottom: '1px solid var(--border)',
                }}>
                  <div style={{ width: 76, flexShrink: 0, fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    <div>{new Date(ev.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                    {range !== 'today' && (
                      <div style={{ fontSize: '0.65rem' }}>
                        {new Date(ev.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                      </div>
                    )}
                  </div>
                  <div style={{ flex: 1, fontWeight: 600, fontSize: '0.82rem', color: 'var(--text-primary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {ev.user_name}
                  </div>
                  <ReportBadge status={ev.status} />
                  <div style={{ width: 56, textAlign: 'right', fontSize: '0.72rem', color: 'var(--text-muted)', flexShrink: 0 }}>
                    {fmtDuration(ev.duration_seconds)}
                  </div>
                  {ev.source === 'manual' && ev.changed_by_name && (
                    <div
                      style={{ width: 110, fontSize: '0.65rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}
                      title={`Set by ${ev.changed_by_name}`}
                    >
                      by {ev.changed_by_name}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {err && <div className="alert alert-error" style={{ marginBottom: 16 }}>{err}</div>}

      {loading && !data && (
        <div className="flex items-center gap-2" style={{ color: 'var(--text-secondary)', padding: '40px 0' }}>
          <div className="spinner" />
          <span className="text-sm">Loading report…</span>
        </div>
      )}

      {data && (
        <>
          {/* ── Time Tracker ── */}
          <TimeTracker events={data.events} range={range} />

          {/* ── After-Hours On-Call ── */}
          {ahOnCallUsers.length > 0 && <AfterHoursOnCall users={ahOnCallUsers} />}

          {/* ── Time Summary table ── */}
          {data.summary.length > 0 ? (
            <div style={{
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)', marginBottom: 20, overflow: 'auto',
            }}>
              <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>Time Summary</span>
                <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
                  {[['all', 'All'], ['bh', 'Business Hours'], ['ah', 'After Hours']].map(([val, lbl]) => (
                    <button
                      key={val}
                      onClick={() => setBhMode(val)}
                      style={{
                        fontSize: '0.7rem', padding: '2px 10px', borderRadius: 12,
                        border: `1px solid ${bhMode === val ? 'var(--cyan)' : 'var(--border)'}`,
                        background: bhMode === val ? 'var(--cyan)' : 'transparent',
                        color: bhMode === val ? '#000' : 'var(--text-muted)',
                        cursor: 'pointer', fontWeight: bhMode === val ? 700 : 400,
                      }}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-base)' }}>
                    <th style={{ padding: '8px 14px', textAlign: 'left', fontWeight: 600, color: 'var(--text-secondary)' }}>
                      Staff Member
                    </th>
                    {REPORT_COLS.map(col => (
                      <th key={col} style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 600, color: REPORT_COLORS[col] }}>
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displaySummary.length > 0 ? displaySummary.map((row, i) => (
                    <tr key={row.user_id} style={{ borderTop: '1px solid var(--border)', background: i % 2 ? 'var(--bg-base)' : 'transparent' }}>
                      <td style={{ padding: '8px 14px', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {row.user_name}
                      </td>
                      {REPORT_COLS.map(col => (
                        <td key={col} style={{
                          padding: '8px 10px', textAlign: 'center',
                          color: (row.totals[col] || 0) > 0 ? REPORT_COLORS[col] : 'var(--text-muted)',
                        }}>
                          {fmtDuration(row.totals[col])}
                        </td>
                      ))}
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={REPORT_COLS.length + 1} style={{ padding: '16px 14px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                        No activity during {bhMode === 'bh' ? 'business hours' : 'after hours'} for this period.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '30px 0', fontSize: '0.85rem' }}>
              No activity recorded for this period yet.
              {range === 'today' && ' Activity is logged as presence is polled throughout the day.'}
            </div>
          )}

        </>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function RingCentral() {
  const { isAdmin, rcPresenceAccess } = useContext(UserContext)
  const canManage = isAdmin || rcPresenceAccess

  const [tab, setTab] = useState('live')

  const [data, setData]           = useState(null)       // { departments, totals }
  const [loading, setLoading]     = useState(true)
  const [err, setErr]             = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [searchTerm, setSearchTerm]   = useState('')
  const [filterStatus, setFilterStatus] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const r = await getRCPresence()
      setData(r.data)
      setLastUpdated(new Date())
    } catch (e) {
      const msg = e.response?.data?.detail || e.message || 'Failed to load presence data'
      setErr(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Auto-refresh every 30 seconds, paused when the tab is not visible
  useEffect(() => {
    let id = null

    const start = () => { if (!id) id = setInterval(load, 60_000) }
    const stop  = () => { clearInterval(id); id = null }

    const onVisibility = () => document.hidden ? stop() : start()

    if (!document.hidden) start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility) }
  }, [load])

  // Patch a single user's status in local state (after DND toggle)
  const handleStatusChange = useCallback((userId, patch) => {
    setData(prev => {
      if (!prev) return prev
      const departments = prev.departments.map(dept => ({
        ...dept,
        users: dept.users.map(u => u.id === userId ? { ...u, ...patch } : u),
      }))

      // Recompute totals
      const all = departments.flatMap(d => d.users)
      const totals = {
        total:     all.length,
        available: all.filter(u => u.status === 'Available').length,
        busy:      all.filter(u => u.status === 'Busy').length,
        on_call:   all.filter(u => u.status === 'On Call').length,
        dnd:       all.filter(u => ['DND', 'Lunch', 'Break'].includes(u.status)).length,
        offline:   all.filter(u => u.status === 'Offline').length,
      }
      return { departments, totals }
    })
  }, [])

  const search = searchTerm.toLowerCase().trim()

  const notConfigured  = !loading && err && err.includes('not configured')
  const noUsers        = !loading && data?.no_users_configured

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>

      {/* ── Tab bar ── */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '2px solid var(--border)' }}>
        {[['live', 'Live Presence'], ['reports', 'Reports']].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            style={{
              padding: '8px 18px', background: 'none', border: 'none', cursor: 'pointer',
              fontSize: '0.85rem', fontWeight: tab === id ? 700 : 500,
              color: tab === id ? 'var(--text-primary)' : 'var(--text-muted)',
              borderBottom: tab === id ? '2px solid var(--cyan)' : '2px solid transparent',
              marginBottom: -2,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'reports' && <RCReports />}

      {tab === 'live' && <>

        {/* ── Not configured splash ── */}
        {notConfigured && (
          <div style={{ maxWidth: 520, margin: '40px auto', textAlign: 'center' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>📞</div>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: 8 }}>RingCentral Not Configured</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: 1.6 }}>
              Connect your RingCentral account in{' '}
              <strong>Settings → Integrations → RingCentral</strong> to enable presence monitoring.
            </p>
          </div>
        )}

        {/* ── No users linked splash ── */}
        {noUsers && (
          <div style={{ maxWidth: 520, margin: '40px auto', textAlign: 'center' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>📞</div>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: 8 }}>No RC Extensions Linked</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: 1.6 }}>
              No portal users have a RingCentral Extension ID assigned yet.
              Go to <strong>Settings → Users</strong>, edit a user, and enter their RC Extension ID.
            </p>
          </div>
        )}

        {!notConfigured && !noUsers && <>

        {/* ── Toolbar ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          <input
            className="input"
            placeholder="Search by name or extension…"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            style={{ flex: '1 1 200px', maxWidth: 280 }}
          />
          <select
            className="input"
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            style={{ width: 'auto' }}
          >
            <option value="">All statuses</option>
            {STATUS_ORDER.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          <div style={{ flex: 1 }} />

          {lastUpdated && (
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              Updated {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <button
            className="btn btn-ghost"
            style={{ fontSize: '0.78rem' }}
            onClick={load}
            disabled={loading}
          >
            {loading ? '↻ Loading…' : '↻ Refresh'}
          </button>
        </div>

        {/* ── Error ── */}
        {err && !err.includes('not configured') && (
          <div className="alert alert-error" style={{ marginBottom: 16 }}>{err}</div>
        )}

        {/* ── Loading skeleton ── */}
        {loading && !data && (
          <div className="flex items-center gap-2" style={{ color: 'var(--text-secondary)', padding: '40px 0' }}>
            <div className="spinner" />
            <span className="text-sm">Loading presence data…</span>
          </div>
        )}

        {/* ── Data ── */}
        {data && (
          <>
            <StatsBar totals={data.totals} />

            {data.departments.length === 0 ? (
              <p className="text-sm text-muted">No users found.</p>
            ) : (data.departments.length === 1 && data.departments[0].name === 'Unassigned') ? (
              /* Single unassigned group — show flat list without department header */
              <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                {data.departments[0].users
                  .filter(u => {
                    const matchSearch = !search || u.name.toLowerCase().includes(search) || u.extension.includes(search)
                    const matchStatus = !filterStatus || u.status === filterStatus
                    return matchSearch && matchStatus
                  })
                  .map(user => (
                    <UserRow key={user.id} user={user} canManage={canManage} onStatusChange={handleStatusChange} />
                  ))
                }
              </div>
            ) : (
              data.departments.map(dept => (
                <DepartmentCard
                  key={dept.name}
                  dept={dept}
                  canManage={canManage}
                  onStatusChange={handleStatusChange}
                  searchTerm={search}
                  filterStatus={filterStatus}
                />
              ))
            )}
          </>
        )}
        </>}

      </>}
    </div>
  )
}
