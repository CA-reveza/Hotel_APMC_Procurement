import { useState } from 'react'
import { supabase } from '../supabaseClient'
import { VEHICLE_TYPES } from '../lib/vehiclePricing'

// Shown once, right after sign-up, so a hotel, supplier, or driver account
// can fill in its details before landing on its dashboard.
export default function SetupOrg({ profile, onDone }) {
  const isHotel = profile.role === 'hotel'
  const isDriver = profile.role === 'driver'
  const [name, setName] = useState(profile.full_name || '')
  const [address, setAddress] = useState('')
  const [apmcYard, setApmcYard] = useState('')
  const [gst, setGst] = useState('')
  const [fssai, setFssai] = useState('')
  const [vehicleType, setVehicleType] = useState(VEHICLE_TYPES[0].id)
  const [vehicleNumber, setVehicleNumber] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)

    let table, payload
    if (isDriver) {
      table = 'drivers'
      payload = { id: profile.id, name, phone: profile.phone || null, vehicle_type: vehicleType, vehicle_number: vehicleNumber }
    } else if (isHotel) {
      table = 'hotels'
      payload = { profile_id: profile.id, name, address, gst_number: gst, fssai_number: fssai, phone: profile.phone || null, email: profile.email }
    } else {
      table = 'suppliers'
      payload = { profile_id: profile.id, name, address, gst_number: gst, apmc_yard: apmcYard }
    }

    const { error } = await supabase.from(table).insert(payload)
    setBusy(false)
    if (error) {
      setError(error.message)
    } else {
      onDone()
    }
  }

  const title = isDriver ? 'Set up your delivery partner profile' : isHotel ? 'Set up your hotel / kitchen' : 'Set up your supplier profile'

  return (
    <div className="center-screen">
      <div className="auth-card">
        <h2>{title}</h2>
        <p className="subtitle">One-time details, editable later from the admin dashboard.</p>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit} className="form">
          <label>{isDriver ? 'Your name' : isHotel ? 'Business name' : 'Supplier / firm name'}</label>
          <input value={name} onChange={(e) => setName(e.target.value)} required />

          {!isDriver && (
            <>
              <label>Address</label>
              <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Bengaluru" />
            </>
          )}

          {!isHotel && !isDriver && (
            <>
              <label>APMC yard</label>
              <input value={apmcYard} onChange={(e) => setApmcYard(e.target.value)} placeholder="e.g. Yeshwanthpur APMC" />
            </>
          )}

          {isDriver && (
            <>
              <label>Vehicle type</label>
              <select value={vehicleType} onChange={(e) => setVehicleType(e.target.value)}>
                {VEHICLE_TYPES.map((v) => (
                  <option key={v.id} value={v.id}>{v.label} — {v.desc}</option>
                ))}
              </select>
              <label>Vehicle number</label>
              <input value={vehicleNumber} onChange={(e) => setVehicleNumber(e.target.value)} placeholder="KA-01-AB-1234" />
            </>
          )}

          {isHotel && (
            <>
              <label>FSSAI license number (required)</label>
              <input value={fssai} onChange={(e) => setFssai(e.target.value)} placeholder="14-digit FSSAI number" required />
            </>
          )}

          {!isDriver && (
            <>
              <label>GST number (optional)</label>
              <input value={gst} onChange={(e) => setGst(e.target.value)} />
            </>
          )}

          <button className="btn btn-primary" disabled={busy} type="submit">
            {busy ? 'Saving…' : 'Save and continue'}
          </button>
        </form>
      </div>
    </div>
  )
}
