import { useEffect } from 'react'
import { getRCWidgetConfig } from '../api/client.js'

export default function RCEmbeddable() {
  useEffect(() => {
    getRCWidgetConfig()
      .then(r => {
        const { client_id, server_url, configured } = r.data
        if (!configured) return
        if (document.getElementById('rc-embeddable-script')) return

        const redirectUri = window.location.origin + '/rc-oauth.html'

        // When the OAuth popup closes it posts the callback URL here.
        // adapter.js opens the popup from the parent window, so window.opener
        // in the popup IS this window.  adapter.js should forward the message
        // to the iframe automatically, but we also relay it manually to be safe.
        const handleMessage = (e) => {
          if (typeof e.data !== 'string') return
          if (!e.data.startsWith(redirectUri)) return
          const iframe = document.getElementById('rc-widget-adapter-frame')
          if (iframe?.contentWindow) {
            iframe.contentWindow.postMessage(e.data, '*')
          }
        }
        window.addEventListener('message', handleMessage)

        const script = document.createElement('script')
        script.id  = 'rc-embeddable-script'
        script.src =
          `https://ringcentral.github.io/ringcentral-embeddable/adapter.js` +
          `?clientId=${encodeURIComponent(client_id)}` +
          `&appServer=${encodeURIComponent(server_url)}` +
          `&redirectUri=${encodeURIComponent(redirectUri)}`
        document.body.appendChild(script)
      })
      .catch(() => {})
  }, [])

  return null
}
