import { MsalProvider, useMsal, useIsAuthenticated } from '@azure/msal-react'
import { PublicClientApplication, InteractionStatus } from '@azure/msal-browser'
import { msalConfig, loginRequest } from './msalConfig.js'
import LoginPage from './components/LoginPage.jsx'

const AUTH_ENABLED = import.meta.env.VITE_AUTH_ENABLED !== 'false'

// Only instantiate MSAL when auth is enabled — the Web Crypto API it requires
// is unavailable on plain HTTP (non-localhost), which breaks local IP dev access.
const msalInstance = AUTH_ENABLED ? new PublicClientApplication(msalConfig) : null

function AuthGate({ children }) {
  const { instance, inProgress } = useMsal()
  const isAuthenticated = useIsAuthenticated()

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

  if (!isAuthenticated) {
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
