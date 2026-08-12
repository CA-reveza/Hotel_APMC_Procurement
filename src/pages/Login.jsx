import { useState } from 'react'
import { supabase } from '../supabaseClient'

export default function Login() {
  const [mode, setMode] = useState('signin') // 'signin' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState('hotel')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)

  const handleSignIn = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    setBusy(false)
  }

  const handleSignUp = async (e) => {
    e.preventDefault()
    setError('')
    setInfo('')
    setBusy(true)
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName, phone, role }
      }
    })
    if (error) {
      setError(error.message)
    } else {
      setInfo('Account created. If email confirmation is enabled in your Supabase project, check your inbox before signing in.')
      setMode('signin')
    }
    setBusy(false)
  }

  return (
    <div className="center-screen">
      <div className="auth-card">
        <h1>Hotel–APMC Procurement</h1>
        <p className="subtitle">Bengaluru B2B procurement platform</p>

        <div className="tabs">
          <button className={mode === 'signin' ? 'tab active' : 'tab'} onClick={() => setMode('signin')}>Sign in</button>
          <button className={mode === 'signup' ? 'tab active' : 'tab'} onClick={() => setMode('signup')}>Sign up</button>
        </div>

        {error && <div className="alert alert-error">{error}</div>}
        {info && <div className="alert alert-info">{info}</div>}

        {mode === 'signin' ? (
          <form onSubmit={handleSignIn} className="form">
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <button className="btn btn-primary" disabled={busy} type="submit">
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleSignUp} className="form">
            <label>I am a</label>
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="hotel">Hotel / Restaurant / Cloud Kitchen</option>
              <option value="supplier">APMC / Wholesale Supplier</option>
            </select>
            <label>Full name / business contact</label>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            <label>Phone</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} />
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required />
            <button className="btn btn-primary" disabled={busy} type="submit">
              {busy ? 'Creating account…' : 'Create account'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
