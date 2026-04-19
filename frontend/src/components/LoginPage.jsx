import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'

export default function LoginPage({ onLogin }) {
  const [email, setEmail]           = useState('')
  const [theme, setTheme]           = useState(() => localStorage.getItem('theme') || 'dark')
  const [ssoProviders, setSsoProviders] = useState([])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  useEffect(() => {
    axios.get('/api/auth/sso-providers')
      .then(r => setSsoProviders(r.data.providers || []))
      .catch(() => {})
  }, [])

  const toggleTheme = useCallback(() => setTheme(t => t === 'dark' ? 'light' : 'dark'), [])
  const isDark = theme === 'dark'

  const btnBg      = isDark ? '#2f2f2f' : '#f6f8fa'
  const btnBgHover = isDark ? '#3a3a3a' : '#eaeef2'
  const btnBorder  = isDark ? '#555'    : '#d0d7de'
  const btnColor   = isDark ? '#fff'    : '#1f2328'

  return (
    <div style={{
      display: 'flex',
      height: '100vh',
      fontFamily: 'var(--font-sans)',
      background: 'var(--bg-base)',
    }}>

      {/* ── Left branding panel ── */}
      <div style={{
        flex: 1,
        background: 'linear-gradient(160deg, #0d1117 0%, #161b22 60%, #1a2436 100%)',
        borderRight: '1px solid rgba(48,54,61,0.8)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '48px 56px',
        overflow: 'hidden',
        gap: 40,
      }}>
        {/* Hero copy */}
        <div>
          <h1 style={{ fontSize: '2.6rem', fontWeight: 800, lineHeight: 1.15, marginBottom: 20, color: '#e6edf3', letterSpacing: '-0.02em' }}>
            One platform.<br />Total IT control.
          </h1>
          <p style={{ color: '#8b949e', fontSize: '0.95rem', lineHeight: 1.8, marginBottom: 28, maxWidth: 420 }}>
            From device inventory to interactive floor maps, shared mailboxes to conference rooms —
            everything your IT team needs, unified in one secure workspace built for modern organizations.
          </p>

          {/* Feature list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {[
              { icon: '💻', text: 'Device & asset inventory' },
              { icon: '🗺️', text: 'Interactive office floor maps' },
              { icon: '👥', text: 'User & shared mailbox management' },
              { icon: '🎫', text: 'Integrated IT service ticketing' },
              { icon: '🏢', text: 'Conference room visibility' },
              { icon: '🖨️', text: 'Printer & peripheral tracking' },
              { icon: '🛡️', text: 'Security threat & alert monitoring' },
            ].map(({ icon, text }) => (
              <div key={text} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: '1rem', width: 24, textAlign: 'center', flexShrink: 0 }}>{icon}</span>
                <span style={{ fontSize: '0.875rem', color: '#8b949e' }}>{text}</span>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* ── Right sign-in panel ── */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-base)',
        position: 'relative',
      }}>
        {/* Theme toggle */}
        <div style={{ position: 'absolute', top: 20, right: 24 }}>
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            style={{ fontSize: '1rem', padding: '6px 10px' }}>
            {isDark ? '☀️' : '🌙'}
          </button>
        </div>

        {/* Centered card */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
          <div style={{ width: '100%', maxWidth: 380 }}>

            {/* Heading */}
            <div style={{ marginBottom: 36, textAlign: 'center' }}>
              <div style={{ fontWeight: 800, fontSize: '1.8rem', letterSpacing: '-0.02em', lineHeight: 1, marginBottom: 12, color: 'var(--text-primary)' }}>
                Control<span style={{ color: 'var(--cyan)' }}>Point</span>
              </div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                Welcome back. Sign in to access your workspace.
              </div>
            </div>

            {/* Microsoft 365 button */}
            <button
              onClick={onLogin}
              style={{
                width: '100%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: 12, padding: '12px 20px',
                background: btnBg,
                border: `1px solid ${btnBorder}`,
                borderRadius: 8,
                color: btnColor,
                fontSize: '0.9rem', fontWeight: 600,
                cursor: 'pointer', fontFamily: 'var(--font-sans)',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = btnBgHover}
              onMouseLeave={e => e.currentTarget.style.background = btnBg}
            >
              <svg width="18" height="18" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg">
                <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
                <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
                <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
                <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
              </svg>
              Sign in with Microsoft 365
            </button>

            {/* SSO provider buttons */}
            {ssoProviders.map(p => (
              <a
                key={p.id}
                href={p.auth_url}
                style={{
                  width: '100%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  gap: 12, padding: '12px 20px', marginTop: 10,
                  background: btnBg,
                  border: `1px solid ${btnBorder}`,
                  borderRadius: 8,
                  color: btnColor,
                  fontSize: '0.9rem', fontWeight: 600,
                  cursor: 'pointer', fontFamily: 'var(--font-sans)',
                  textDecoration: 'none',
                  transition: 'background 0.15s',
                  boxSizing: 'border-box',
                }}
                onMouseEnter={e => e.currentTarget.style.background = btnBgHover}
                onMouseLeave={e => e.currentTarget.style.background = btnBg}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" fill="currentColor"/>
                  <path d="M2 12h3M19 12h3M12 2v3M12 19v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                Sign in with {p.name}
              </a>
            ))}

            {/* Divider */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0' }}>
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 500, letterSpacing: '0.04em' }}>or</span>
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            </div>

            {/* Email input */}
            <input
              className="input"
              type="email"
              placeholder="Enter your email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && email.trim() && onLogin()}
              style={{ width: '100%', fontSize: '0.9rem', marginBottom: 10, boxSizing: 'border-box' }}
            />

            {/* Continue with email — always black */}
            <button
              onClick={() => email.trim() && onLogin()}
              style={{
                width: '100%',
                padding: '12px 20px',
                background: '#000',
                border: '1px solid #000',
                borderRadius: 8,
                color: '#fff',
                fontSize: '0.9rem', fontWeight: 600,
                cursor: email.trim() ? 'pointer' : 'default',
                opacity: email.trim() ? 1 : 0.35,
                fontFamily: 'var(--font-sans)',
                transition: 'opacity 0.15s',
              }}
            >
              Continue with email
            </button>

            {/* Footer links */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexWrap: 'wrap', gap: 0, marginTop: 28,
            }}>
              <button
                onClick={() => {}}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', fontFamily: 'var(--font-sans)', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Trouble signing in?
              </button>
              <span style={{ color: 'var(--border)', fontSize: '0.75rem', margin: '0 8px' }}>|</span>
              <button
                onClick={() => {}}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', fontFamily: 'var(--font-sans)', fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 3 }}>
                Not a Customer? Schedule a demo <span style={{ fontSize: '0.9rem', lineHeight: 1 }}>›</span>
              </button>
            </div>

          </div>
        </div>

        {/* Copyright footer */}
        <div style={{ position: 'absolute', bottom: 20, left: 0, right: 0, textAlign: 'center', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
          © 2026 ControlPoint · Access governed by Microsoft Entra ID
        </div>
      </div>
    </div>
  )
}
