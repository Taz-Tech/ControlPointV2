import { useState, useEffect } from 'react'
import { MsalProvider, useMsal, useIsAuthenticated } from '@azure/msal-react'
import { PublicClientApplication, InteractionStatus } from '@azure/msal-browser'
import { msalConfig, loginRequest } from './msalConfig.js'
import LoginPage from './components/LoginPage.jsx'

const AUTH_ENABLED  = import.meta.env.VITE_AUTH_ENABLED  !== 'false'
const AZURE_ENABLED = import.meta.env.VITE_AZURE_ENABLED === 'true'

// Only instantiate MSAL when Azure AD is explicitly enabled — the Web Crypto API
// it requires is unavailable on plain HTTP (non-localhost).
const msalInstance = (AUTH_ENABLED && AZURE_ENABLED) ? new PublicClientApplication(msalConfig) : null

function _readPortalToken() {
  return sessionStorage.getItem('portal_token') || null
}

function _isTokenExpired(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    return payload.exp && Date.now() / 1000 > payload.exp
  } catch {
    return true
  }
}

function _handleSsoCallback(setPortalToken) {
  const hash = window.location.hash
  if (hash.includes('token=')) {
    const token = new URLSearchParams(hash.slice(1)).get('token')
    if (token && !_isTokenExpired(token)) {
      sessionStorage.setItem('portal_token', token)
      setPortalToken(token)
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
    }
  }
  const stored = sessionStorage.getItem('portal_token')
  if (stored && _isTokenExpired(stored)) {
    sessionStorage.removeItem('portal_token')
    setPortalToken(null)
  }
}

// Auth gate when Azure AD (MSAL) is enabled
function AzureAuthGate({ children }) {
  const { instance, inProgress } = useMsal()
  const isAuthenticated = useIsAuthenticated()
  const [portalToken, setPortalToken] = useState(_readPortalToken)

  useEffect(() => { _handleSsoCallback(setPortalToken) }, [])

  if (inProgress !== InteractionStatus.None) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: 'var(--bg-base)', color: 'var(--text-secondary)',
        fontFamily: 'var(--font-sans)', fontSize: '0.9rem', gap: 12,
      }}>
        <div className="spinner" />
        Signing you in…
      </div>
    )
  }

  const handleLocalLogin = async (email, password) => {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const data = await r.json()
    if (!r.ok) throw new Error(data.detail || 'Invalid email or password')
    sessionStorage.setItem('portal_token', data.token)
    setPortalToken(data.token)
  }

  if (!isAuthenticated && !portalToken) {
    return (
      <LoginPage
        onLogin={() => instance.loginRedirect(loginRequest)}
        onLocalLogin={handleLocalLogin}
      />
    )
  }

  return children
}

// Auth gate for email/password + Google SSO only — no MSAL required
function LocalAuthGate({ children }) {
  const [portalToken, setPortalToken] = useState(_readPortalToken)

  useEffect(() => { _handleSsoCallback(setPortalToken) }, [])

  const handleLocalLogin = async (email, password) => {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const data = await r.json()
    if (!r.ok) throw new Error(data.detail || 'Invalid email or password')
    sessionStorage.setItem('portal_token', data.token)
    setPortalToken(data.token)
  }

  if (!portalToken) {
    return <LoginPage onLogin={null} onLocalLogin={handleLocalLogin} />
  }

  return children
}

export default function AuthProvider({ children }) {
  if (!AUTH_ENABLED) {
    return children
  }

  if (AZURE_ENABLED && msalInstance) {
    return (
      <MsalProvider instance={msalInstance}>
        <AzureAuthGate>{children}</AzureAuthGate>
      </MsalProvider>
    )
  }

  return <LocalAuthGate>{children}</LocalAuthGate>
}

export { msalInstance }
