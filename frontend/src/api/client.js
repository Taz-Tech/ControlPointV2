import axios from 'axios'
import { InteractionRequiredAuthError } from '@azure/msal-browser'
import { msalInstance } from '../AuthProvider.jsx'
import { loginRequest } from '../msalConfig.js'

export const api = axios.create({
  baseURL: '/',       // Vite proxies /api → http://localhost:8000
  timeout: 30000,
})

// Attach Bearer token to every request (Azure AD via MSAL, or portal JWT for Okta SSO)
api.interceptors.request.use(async (config) => {
  if (!msalInstance) return config
  const accounts = msalInstance.getAllAccounts()
  if (accounts.length > 0) {
    try {
      const result = await msalInstance.acquireTokenSilent({
        ...loginRequest,
        account: accounts[0],
      })
      config.headers['Authorization'] = `Bearer ${result.accessToken}`
    } catch (err) {
      if (err instanceof InteractionRequiredAuthError) {
        // Session expired and can't be refreshed silently — force re-login
        msalInstance.loginRedirect(loginRequest)
      }
      // For other transient errors, let the request proceed (backend returns 401)
    }
  } else {
    // No MSAL account — attach portal JWT if present (Okta SSO users)
    const portalToken = sessionStorage.getItem('portal_token')
    if (portalToken) {
      config.headers['Authorization'] = `Bearer ${portalToken}`
    }
  }
  return config
})

// ── Users ────────────────────────────────────────────────────────────────────
export const searchUsers           = (q)   => api.get('/api/users/search', { params: { q } })
export const getUserDetail         = (id)  => api.get(`/api/users/${id}`)
export const getUserTickets        = (email) => api.get('/api/freshservice/tickets', { params: { email } })
export const searchMailboxes       = (q)   => api.get('/api/mailboxes/search', { params: { q } })
export const getMailboxMembers      = (id)  => api.get(`/api/mailboxes/${id}/members`)
export const getMailboxPermissions  = (id)  => api.get(`/api/mailboxes/${id}/permissions`)
export const getUserMailboxMemberships = (userId) => api.get(`/api/mailboxes/user/${userId}/memberships`)

// ── ImmyBot ───────────────────────────────────────────────────────────────────
export const getUserComputers = (email) => api.get('/api/immybot/computers', { params: { email } })

// ── Devices ───────────────────────────────────────────────────────────────────
export const searchDevices      = ()     => api.get('/api/devices/search')
export const lookupDevice       = (name) => api.get('/api/devices/lookup',   { params: { name } })
export const debugDevice        = (q)    => api.get('/api/devices/debug',    { params: { q } })
export const getDeviceExploits  = (name) => api.get('/api/devices/exploits', { params: { name } })

// ── User Directory (unified DB) ───────────────────────────────────────────────
export const syncDirectory         = ()       => api.post('/api/directory/sync', {}, { timeout: 120000 })
export const getDirectoryUsers     = (params) => api.get('/api/directory/users', { params })
export const getDirectoryUser      = (id)     => api.get(`/api/directory/users/${id}`)

// ── Device Inventory (unified DB) ─────────────────────────────────────────────
export const syncAllDevices      = ()              => api.post('/api/devices/sync-all', {}, { timeout: 120000 })
export const getDeviceInventory  = (params)        => api.get('/api/devices/inventory', { params })
export const getDeviceRecord     = (normalizedName) => api.get(`/api/devices/inventory/${encodeURIComponent(normalizedName)}`)

// ── Switches ─────────────────────────────────────────────────────────────────
export const getSwitches   = ()        => api.get('/api/switches/')
export const addSwitch     = (body)    => api.post('/api/switches/', body)
export const deleteSwitch  = (id)      => api.delete(`/api/switches/${id}`)
export const resetPort     = (body)    => api.post('/api/switches/reset-port', body)

// ── Users / Roles ─────────────────────────────────────────────────────────────
export const getPortalUsers    = ()                        => api.get('/api/settings/users')
export const inviteUser        = (email)                   => api.post('/api/settings/users', { email })
export const deletePortalUser  = (id)                      => api.delete(`/api/settings/users/${id}`)
export const updateUserRole    = (id, role)                => api.put(`/api/settings/users/${id}/role`, { role })
export const updateUserProfile   = (id, data)    => api.put(`/api/settings/users/${id}/profile`, data)
export const updateUserRCAccess  = (id, enabled) => api.put(`/api/settings/users/${id}/rc-access`, { enabled })

// ── Dashboard stats ───────────────────────────────────────────────────────────
export const getFreshserviceStats    = ()    => api.get('/api/freshservice/stats')
export const getFreshserviceAlerts   = ()    => api.get('/api/freshservice/alerts')
export const getFreshserviceProblems = ()    => api.get('/api/freshservice/open-problems')
export const getMyTickets            = ()    => api.get('/api/freshservice/my-tickets')
export const getUnassignedTickets    = ()    => api.get('/api/freshservice/unassigned-tickets')
export const getImmybotStats       = ()     => api.get('/api/immybot/stats')

// ── Global shortcuts (admin-managed) ─────────────────────────────────────────
export const getShortcuts    = ()       => api.get('/api/shortcuts')
export const createShortcut  = (body)   => api.post('/api/shortcuts', body)
export const updateShortcut  = (id, b)  => api.put(`/api/shortcuts/${id}`, b)
export const deleteShortcut      = (id)       => api.delete(`/api/shortcuts/${id}`)
export const uploadShortcutIcon  = (id, file) => {
  const fd = new FormData()
  fd.append('file', file)
  return api.post(`/api/shortcuts/${id}/icon`, fd)
}

// ── User bookmarks (per-user) ─────────────────────────────────────────────────
export const getBookmarks    = ()       => api.get('/api/bookmarks')
export const createBookmark  = (body)   => api.post('/api/bookmarks', body)
export const updateBookmark  = (id, b)  => api.put(`/api/bookmarks/${id}`, b)
export const deleteBookmark  = (id)     => api.delete(`/api/bookmarks/${id}`)

// ── Branding ──────────────────────────────────────────────────────────────────
export const getBranding     = ()     => api.get('/api/settings/branding')
export const uploadLogo      = (file) => { const fd = new FormData(); fd.append('file', file); return api.post('/api/settings/logo', fd) }
export const deleteLogo      = ()     => api.delete('/api/settings/logo')
export const uploadFavicon   = (file) => { const fd = new FormData(); fd.append('file', file); return api.post('/api/settings/favicon', fd) }
export const deleteFavicon   = ()     => api.delete('/api/settings/favicon')
export const uploadIcon      = (file) => { const fd = new FormData(); fd.append('file', file); return api.post('/api/settings/icon', fd) }
export const deleteIcon      = ()     => api.delete('/api/settings/icon')

// ── Conference Rooms ──────────────────────────────────────────────────────────
export const getConferenceRooms   = (date) => api.get('/api/conference-rooms/', { params: date ? { date } : {} })
export const getRoomSchedule      = (email, date) => api.get(`/api/conference-rooms/${encodeURIComponent(email)}/schedule`, { params: date ? { date } : {} })

// ── Room Configs (site + map pin) ─────────────────────────────────────────────
export const getRoomConfigs     = ()             => api.get('/api/room-configs/')
export const upsertRoomConfig   = (email, body)  => api.put(`/api/room-configs/${encodeURIComponent(email)}`, body)
export const deleteRoomConfig   = (email)        => api.delete(`/api/room-configs/${encodeURIComponent(email)}`)

// ── RingCentral ───────────────────────────────────────────────────────────────
export const getRCPresence       = ()                        => api.get('/api/ringcentral/presence')
export const updateRCPresence    = (extensionId, body)       => api.put(`/api/ringcentral/presence/${extensionId}`, body)
export const getMyRCPresence     = ()                        => api.get('/api/ringcentral/me/presence')
export const updateMyRCPresence  = (body)                    => api.put('/api/ringcentral/me/presence', body)
export const getRCPresenceReport = (params)                  => api.get('/api/ringcentral/presence/report', { params })
export const getRCWidgetConfig   = ()                        => api.get('/api/ringcentral/widget-config')
export const getRCBusinessHours  = ()                        => api.get('/api/ringcentral/business-hours')
export const saveRCBusinessHours = (body)                    => api.put('/api/ringcentral/business-hours', body)

// ── Integrations ──────────────────────────────────────────────────────────────
export const getIntegrations          = ()              => api.get('/api/integrations/')
export const updateIntegration        = (id, values)    => api.put(`/api/integrations/${id}`, { values })
export const toggleIntegration        = (id, disable)   => api.put(`/api/integrations/${id}/enabled`, { enabled: !disable })
export const testIntegration          = (id)            => api.post(`/api/integrations/${id}/test`)
export const uploadIntegrationFile    = (uploadUrl, file) => {
  const fd = new FormData()
  fd.append('file', file)
  return api.post(uploadUrl, fd)
}
export const uploadIntegrationLogo    = (id, file) => {
  const fd = new FormData()
  fd.append('file', file)
  return api.post(`/api/integrations/${id}/upload-logo`, fd)
}

// ── Sites ─────────────────────────────────────────────────────────────────────
export const getSites             = ()                    => api.get('/api/sites/')
export const createSite           = (name)                => api.post('/api/sites/', { name })
export const deleteSite           = (id)                  => api.delete(`/api/sites/${id}`)
export const addSwitchToSite      = (siteId, switchId)    => api.post(`/api/sites/${siteId}/switches/${switchId}`)
export const removeSwitchFromSite = (siteId, switchId)    => api.delete(`/api/sites/${siteId}/switches/${switchId}`)
export const addMapToSite         = (siteId, mapId)       => api.post(`/api/sites/${siteId}/maps/${mapId}`)
export const removeMapFromSite    = (siteId, mapId)       => api.delete(`/api/sites/${siteId}/maps/${mapId}`)
export const linkUnifiHost        = (siteId, hostId)      => api.patch(`/api/sites/${siteId}/unifi-host`, { unifi_host_id: hostId || null })
export const setSiteUnifiSiteName = (siteId, siteName)    => api.patch(`/api/sites/${siteId}/controller`, { unifi_site_name: siteName || null })

// ── UniFi ─────────────────────────────────────────────────────────────────────
export const getUnifiHosts           = ()              => api.get('/api/unifi/hosts')
export const syncUnifiDevices        = (siteId)        => api.post(`/api/unifi/sites/${siteId}/sync`)
export const getPortStatuses         = (siteId, mapId) => api.get(`/api/unifi/sites/${siteId}/port-statuses`, { params: { map_id: mapId } })
export const getPortClients          = (siteId, mapId) => api.get(`/api/unifi/sites/${siteId}/port-clients`,   { params: { map_id: mapId } })
export const getDevicePorts          = (siteId, unifiDeviceId) => api.get(`/api/unifi/sites/${siteId}/devices/${unifiDeviceId}/ports`)
export const getDeviceClients        = (siteId, unifiDeviceId) => api.get(`/api/unifi/sites/${siteId}/devices/${unifiDeviceId}/clients`)
export const getUnifiDevices         = (hostId)        => api.get(`/api/unifi/hosts/${hostId}/devices`)
export const getHostConfigs          = ()              => api.get('/api/unifi/host-configs')
export const saveHostConfig          = (hostId, body)  => api.put(`/api/unifi/host-configs/${hostId}`, body)
export const getHostControllerSites  = (hostId)        => api.get(`/api/unifi/host-configs/${hostId}/controller-sites`)

// ── Maps ──────────────────────────────────────────────────────────────────────
// ── Zones ─────────────────────────────────────────────────────────────────────
export const getZones           = (floorMapId)         => api.get('/api/zones/', { params: { floor_map_id: floorMapId } })
export const createZone         = (body)               => api.post('/api/zones/', body)
export const updateZone         = (id, body)           => api.put(`/api/zones/${id}`, body)
export const deleteZone         = (id)                 => api.delete(`/api/zones/${id}`)
export const getAssignments     = (floorMapId)         => api.get('/api/zones/assignments', { params: { floor_map_id: floorMapId } })
export const upsertAssignment   = (seatId, body)       => api.put(`/api/zones/assignments/${seatId}`, body)
export const deleteAssignment   = (seatId)             => api.delete(`/api/zones/assignments/${seatId}`)

// ── Maps ──────────────────────────────────────────────────────────────────────
export const getMaps       = ()        => api.get('/api/maps/')
export const getMap        = (id)      => api.get(`/api/maps/${id}`)
export const uploadMap     = (name, file) => {
  const fd = new FormData()
  fd.append('file', file)
  return api.post(`/api/maps/upload?name=${encodeURIComponent(name)}`, fd)
}
export const deleteMap     = (id)          => api.delete(`/api/maps/${id}`)
export const updateMapRotation = (id, rotation) => api.put(`/api/maps/${id}/rotation`, { rotation })
export const addAP    = (mapId, body)        => api.post(`/api/maps/${mapId}/aps`, body)
export const updateAP = (mapId, apId, body)  => api.put(`/api/maps/${mapId}/aps/${apId}`, body)
export const deleteAP = (mapId, apId)        => api.delete(`/api/maps/${mapId}/aps/${apId}`)
export const addSeat       = (mapId, body) => api.post(`/api/maps/${mapId}/seats`, body)
export const updateSeat    = (mapId, seatId, body) => api.put(`/api/maps/${mapId}/seats/${seatId}`, body)
export const deleteSeat    = (mapId, seatId)       => api.delete(`/api/maps/${mapId}/seats/${seatId}`)
export const importSeats   = (mapId, rows)         => api.post(`/api/maps/${mapId}/seats/import`, rows, { timeout: 120000 })

// ── Roles ─────────────────────────────────────────────────────────────────────
export const getRoles          = ()            => api.get('/api/roles/')
export const getPermissions    = ()            => api.get('/api/roles/permissions')
export const createRole        = (body)        => api.post('/api/roles/', body)
export const updateRole        = (name, body)  => api.put(`/api/roles/${name}`, body)
export const deleteRole        = (name)        => api.delete(`/api/roles/${name}`)
