export default function Navbar({ profile, onSignOut }) {
  const roleLabel = { hotel: 'Hotel', supplier: 'Supplier / APMC', driver: 'Delivery Partner', admin: 'Admin' }[profile.role]
  const displayName = profile.full_name || profile.email
  const isRedundant = displayName?.trim().toLowerCase() === roleLabel?.toLowerCase()

  return (
    <header className="navbar">
      <div className="navbar-brand">
        <img src="/logo.png" alt="OrderIT" className="navbar-logo" />
        <span className="navbar-tagline">You order...We Deliver...</span>
      </div>
      <div className="navbar-user">
        <span className="role-badge">{roleLabel}</span>
        {!isRedundant && <span className="user-name">{displayName}</span>}
        <button className="btn btn-ghost" onClick={onSignOut}>Sign out</button>
      </div>
    </header>
  )
}
