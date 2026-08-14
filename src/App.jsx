import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './lib/useAuth'
import Navbar from './components/Navbar'
import Login from './pages/Login'
import HotelDashboard from './pages/HotelDashboard'
import SupplierDashboard from './pages/SupplierDashboard'
import AdminDashboard from './pages/AdminDashboard'
import DriverDashboard from './pages/DriverDashboard'
import SetupOrg from './pages/SetupOrg'

export default function App() {
  const { session, profile, orgRecord, loading, signOut, refreshOrgRecord } = useAuth()

  if (loading) {
    return <div className="center-screen">Loading…</div>
  }

  if (!session) {
    return <Login />
  }

  if (!profile) {
    return <div className="center-screen">Setting up your account…</div>
  }

  // Hotel/supplier/driver accounts need their org record (hotels/suppliers/
  // drivers row) created once, right after first sign-up, before they can
  // use the dashboard.
  const needsOrgSetup = ['hotel', 'supplier', 'driver'].includes(profile.role) && !orgRecord

  return (
    <div className="app-shell">
      <Navbar profile={profile} onSignOut={signOut} />
      <main className="app-main">
        {needsOrgSetup ? (
          <SetupOrg profile={profile} onDone={refreshOrgRecord} />
        ) : (
          <Routes>
            {profile.role === 'hotel' && (
              <>
                <Route path="/" element={<HotelDashboard profile={profile} hotel={orgRecord} />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </>
            )}
            {profile.role === 'supplier' && (
              <>
                <Route path="/" element={<SupplierDashboard profile={profile} supplier={orgRecord} />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </>
            )}
            {profile.role === 'driver' && (
              <>
                <Route path="/" element={<DriverDashboard profile={profile} driver={orgRecord} />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </>
            )}
            {profile.role === 'admin' && (
              <>
                <Route path="/" element={<AdminDashboard />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </>
            )}
          </Routes>
        )}
      </main>
    </div>
  )
}
