// MSAL configuration — reuses the same Azure App Registration as the backend
// Client ID and Tenant ID are embedded at build time from the Vite env proxy,
// but since this runs locally we can read from window or hardcode from .env values
// that the dev sees. In production, use VITE_ env vars instead.

export const msalConfig = {
  auth: {
    clientId:    '56fa72dd-f023-4d7b-bd6d-6fd712890166',
    authority:   'https://login.microsoftonline.com/4dfae009-8621-4ff8-b2cb-47f3e39864c7',
    redirectUri: window.location.origin,
  },
  cache: {
    cacheLocation:      'sessionStorage',
    storeAuthStateInCookie: false,
  },
}

// Scopes requested at login — User.Read lets us read the logged-in user's profile
export const loginRequest = {
  scopes: ['User.Read'],
}

// Same scopes used to acquire tokens for API calls
export const apiRequest = {
  scopes: ['User.Read'],
}
