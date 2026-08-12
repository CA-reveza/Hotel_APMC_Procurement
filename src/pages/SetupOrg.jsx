import { useState } from 'react'
import { supabase } from '../supabaseClient'

// Shown once, right after sign-up, so a hotel or supplier account can fill in
// its business details before landing on its dashboard.
export default function SetupOrg({ profile, onDone }) {
  const isHotel = profile.role === 'hotel'
  const [name, setName] = useState(profile.full_name || '')
  const [address, setAddress] = useState('')
  const [apmcYard, setApmcYard] = useState('')
  const [gst, setGst] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)

    const table = isHotel ? 'hotels' : 'suppliers'
    const payload = isHotel
      ? { profile_id: profile.id, name, address, gst_number: gst }
      : { profile_id: profile.id, name, address, gst_number: gst, apmc_yard: apmcYard }

    const { error } = await supabase.from(table).insert(payload)
    setBusy(false)
    if (error) {
      setError(error.message)
    } else {
      onDone()
    }
  }

  return (
    <div className="center-screen">
      <div className="auth-card">
        <h2>{isHotel ? 'Set up your hotel / kitchen' : 'Set up your supplier profile'}</h2>
        <p className="subtitle">One-time details, editable later from the admin dashboard.</p>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit} className="form">
          <label>{isHotel ? 'Business name' : 'Supplier / firm name'}</label>
          <input value={name} onChange={(e) => setName(e.target.value)} required />

          <label>Address</label>
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Bengaluru" />

          {!isHotel && (
            <>
              <label>APMC yard</label>
              <input value={apmcYard} onChange={(e) => setApmcYard(e.target.value)} placeholder="e.g. Yeshwanthpur APMC" />
            </>
          )}

          <label>GST number (optional)</label>
          <input value={gst} onChange={(e) => setGst(e.target.value)} />

          <button className="btn btn-primary" disabled={busy} type="submit">
            {busy ? 'Saving…' : 'Save and continue'}
          </button>
        </form>
      </div>
    </div>
  )
}
