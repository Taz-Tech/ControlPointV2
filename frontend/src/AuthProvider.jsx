import { useState, useEffect } from 'react'
import { MsalProvider, useMsal, useIsAuthenticated } from '@azure/msal-react'
import { PublicClientApplication, InteractionStatus } from '@azure/msal-browser'
import { msalConfig, loginRequest } from './msalConfig.js'
import LoginPage from './components/LoginPage.jsx'

const AUTH_ENABLED = import.meta.env.VITE_AUTH_ENABLED !== 'false'

// Only instantiate MSAL when auth is enabled — the Web Crypto API it requires
// is unavailable on plain HTTP (non-localhost), which breaks local IP dev access.
const msalInstance = AUTH_ENABLED ? new PublicClientApplication(msalConfig) : null

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

function AuthGate({ children }) {
  const { instance, inProgress } = useMsal()
  const isAuthenticated = useIsAuthenticated()
  const [portalToken, setPortalToken] = useState(_readPortalToken)

  // On mount, extract portal token from URL hash (Okta OIDC callback redirect)
  useEffect(() => {
    const hash = window.location.hash
    if (hash.includes('token=')) {
      const token = new URLSearchParams(hash.slice(1)).get('token')
      if (token && !_isTokenExpired(token)) {
        sessionStorage.setItem('portal_token', token)
        setPortalToken(token)
        window.history.replaceState(null, '', window.location.pathname + window.location.search)
      }
    }
    // Clear expired portal tokens
    const stored = sessionStorage.getItem('portal_token')
    if (stored && _isTokenExpired(stored)) {
      sessionStorage.removeItem('portal_token')
      setPortalToken(null)
    }
  }, [])

  if (inProgress !== InteractionStatus.None) {
    // MSAL is mid-redirect — show a blank loading screen
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

  if (!isAuthenticated && !portalToken) {
    return <LoginPage onLogin={() => instance.loginRedirect(loginRequest)} />
  }

  return children
}

export default function AuthProvider({ children }) {
  if (!AUTH_ENABLED) {
    return children
  }

  return (
    <MsalProvider instance={msalInstance}>
      <AuthGate>{children}</AuthGate>
    </MsalProvider>
  )
}

export { msalInstance }
