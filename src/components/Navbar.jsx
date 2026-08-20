export default function Navbar({ profile, onSignOut }) {
  const roleLabel = { hotel: 'Hotel', supplier: 'Supplier / APMC', driver: 'Delivery Partner', admin: 'Admin' }[profile.role]

  return (
    <header className="navbar">
      <div className="navbar-brand">OrderIT</div>
      <div className="navbar-user">
        <span className="role-badge">{roleLabel}</span>
        <span className="user-name">{profile.full_name || profile.email}</span>
        <button className="btn btn-ghost" onClick={onSignOut}>Sign out</button>
      </div>
    </header>
  )
}
