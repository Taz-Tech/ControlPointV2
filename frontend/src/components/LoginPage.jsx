import { useState, useEffect, useCallback } from 'react'
import { getBranding } from '../api/client.js'

export default function LoginPage({ onLogin }) {
  const [branding, setBranding] = useState({ companyName: 'Claim Assist Solutions', logoUrl: '' })
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark')

  useEffect(() => {
    getBranding().then(r => setBranding(r.data)).catch(() => {})
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  const toggleTheme = useCallback(() => setTheme(t => t === 'dark' ? 'light' : 'dark'), [])

  const isDark = theme === 'dark'

  // Sign-in button colors adapt to theme
  const btnBg      = isDark ? '#2f2f2f' : '#f6f8fa'
  const btnBgHover = isDark ? '#3a3a3a' : '#eaeef2'
  const btnBorder  = isDark ? '#555'    : '#d0d7de'
  const btnColor   = isDark ? '#fff'    : '#1f2328'

  return (
    <div style={{
      display: 'flex',
      height: '100vh',
      background: 'var(--bg-base)',
      fontFamily: 'var(--font-sans)',
    }}>
      {/* Left branding panel — always dark */}
      <div style={{
        flex: '0 0 440px',
        background: 'linear-gradient(160deg, #0d1117 0%, #161b22 60%, #1a2436 100%)',
        borderRight: '1px solid rgba(48,54,61,0.8)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '48px 40px',
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 48 }}>
            <div style={{
              width: 44, height: 44,
              background: 'linear-gradient(135deg, #21d4fd, #818cf8)',
              borderRadius: 10,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 22, flexShrink: 0,
            }}>⚡</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '1rem', color: '#e6edf3', letterSpacing: '0.06em', textTransform: 'uppercase', lineHeight: 1.1 }}>Control</div>
              <div style={{ fontWeight: 700, fontSize: '1rem', color: '#21d4fd', letterSpacing: '0.06em', textTransform: 'uppercase', lineHeight: 1.1 }}>Point</div>
            </div>
          </div>

          <h1 style={{ fontSize: '2rem', fontWeight: 700, lineHeight: 1.2, marginBottom: 16, color: '#e6edf3' }}>
            Secure access<br/>for IT admins
          </h1>
          <p style={{ color: '#8b949e', fontSize: '0.9rem', lineHeight: 1.7 }}>
            Manage users, shared mailboxes, switch ports, and floor maps — all from one authenticated workspace.
          </p>
        </div>

        <div style={{ fontSize: '0.72rem', color: '#484f58' }}>
          Access governed by Microsoft Entra ID
        </div>
      </div>

      {/* Right login panel */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-base)',
        position: 'relative',
      }}>
        {/* Theme toggle — top right */}
        <div style={{ position: 'absolute', top: 20, right: 24 }}>
          <button className="theme-toggle" onClick={toggleTheme}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            style={{ fontSize: '1rem', padding: '6px 10px' }}>
            {isDark ? '☀️' : '🌙'}
          </button>
        </div>

        {/* Centered content */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
          <div style={{ width: '100%', maxWidth: 380 }}>
            {/* Company logo / ControlPoint name */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 40, gap: 16 }}>
              {branding.logoUrl ? (
                <img
                  src={branding.logoUrl}
                  alt={branding.companyName}
                  style={{ maxHeight: 80, maxWidth: 260, objectFit: 'contain' }}
                />
              ) : (
                <div style={{
                  width: 72, height: 72, borderRadius: 16,
                  background: 'linear-gradient(135deg, var(--cyan), #818cf8)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 36,
                }}>⚡</div>
              )}
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontWeight: 800, fontSize: '2rem', color: 'var(--text-primary)', letterSpacing: '-0.02em', lineHeight: 1 }}>
                  Control<span style={{ color: 'var(--cyan)' }}>Point</span>
                </div>
              </div>
            </div>

            <h2 style={{ fontSize: '1.3rem', fontWeight: 600, marginBottom: 8, color: 'var(--text-primary)' }}>
              Sign in to continue
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: 32, lineHeight: 1.6 }}>
              Use your Microsoft 365 account to authenticate. Multi-factor authentication will be enforced by your organization's policy.
            </p>

            <button
              onClick={onLogin}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 12,
                padding: '13px 20px',
                background: btnBg,
                border: `1px solid ${btnBorder}`,
                borderRadius: 8,
                color: btnColor,
                fontSize: '0.95rem',
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
                transition: 'all 0.2s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = btnBgHover}
              onMouseLeave={e => e.currentTarget.style.background = btnBg}
            >
              <svg width="20" height="20" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg">
                <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
                <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
                <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
                <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
              </svg>
              Sign in with Microsoft
            </button>

            <p style={{ marginTop: 24, fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.6 }}>
              Your administrator controls who has access to this portal.<br/>
              Contact IT if you need access provisioned.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
