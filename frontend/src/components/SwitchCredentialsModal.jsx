import { useState } from 'react'

export default function SwitchCredentialsModal({ onClose, onSave }) {
  const [form, setForm] = useState({ username: '', password: '', enable_secret: '' })
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const handleSave = () => {
    if (!form.username || !form.password) return
    onSave(form)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>🔐 Switch SSH Credentials</h2>
        <p>Credentials are held in memory for this session only and never saved to disk.</p>

        <div className="form-group">
          <label>Username</label>
          <input id="cred-username" className="input" value={form.username} onChange={set('username')} placeholder="cisco_admin" autoComplete="username" />
        </div>
        <div className="form-group">
          <label>Password</label>
          <input id="cred-password" className="input" type="password" value={form.password} onChange={set('password')} placeholder="••••••••" autoComplete="current-password" />
        </div>
        <div className="form-group">
          <label>Enable Secret <span className="text-muted">(optional)</span></label>
          <input id="cred-enable" className="input" type="password" value={form.enable_secret} onChange={set('enable_secret')} placeholder="leave blank to use password" autoComplete="off" />
          <span className="form-hint">If blank, the password will be used as the enable secret.</span>
        </div>

        <div className="flex gap-3 mt-4" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button id="btn-save-credentials" className="btn btn-primary" onClick={handleSave} disabled={!form.username || !form.password}>
            Save Credentials
          </button>
        </div>
      </div>
    </div>
  )
}
