# Hotel ⇄ APMC Procurement Platform (MVP)

A working end-to-end B2B procurement app connecting **hotels/restaurants/cloud kitchens**
with **APMC/wholesale suppliers**, built to match the business plan: one platform,
transparent daily pricing, order tracking, and a commission + delivery-contribution
revenue model (4% commission + ₹100/order delivery contribution by default).

Single React/Vite app, three role-based views (Hotel / Supplier / Admin), one
Supabase project (Postgres + Auth + Realtime). This matches the same stack/pattern
used across your other projects (Node/Express-free here — Supabase handles the
backend directly from the client via RLS-secured tables).

---

## 1. What's included

```
hotel-apmc-platform/
├── supabase/
│   └── schema.sql          # full DB schema, RLS policies, triggers, seed products
├── src/
│   ├── supabaseClient.js   # Supabase client (reads VITE_SUPABASE_URL / ANON_KEY)
│   ├── lib/useAuth.js      # session + profile + hotel/supplier record hook
│   ├── App.jsx             # role-based router (hotel / supplier / admin)
│   ├── pages/
│   │   ├── Login.jsx           # sign in / sign up (role selection)
│   │   ├── SetupOrg.jsx        # first-time hotel/supplier business details
│   │   ├── HotelDashboard.jsx  # browse supplier prices, cart, place orders, order history
│   │   ├── SupplierDashboard.jsx # publish daily prices, accept/progress orders
│   │   └── AdminDashboard.jsx  # GMV, commission, all hotels/suppliers/orders
│   └── components/
│       ├── Navbar.jsx, OrderList.jsx, OrderCard.jsx
├── package.json
├── vite.config.js
└── .env.example
```

### How the three sides connect

- **Hotel app**: picks a supplier → sees that supplier's live `supplier_prices` →
  builds a cart → places an `order` (+ `order_items`). Order totals, 4% commission,
  and delivery contribution are computed automatically by a Postgres trigger.
- **Supplier app**: sees only orders addressed to it (`orders.supplier_id`),
  publishes/updates daily prices per product, and advances order status
  `pending → accepted → packed → out_for_delivery → delivered` (or `rejected`).
- **Admin dashboard**: read-only, sees every hotel, supplier and order, plus
  platform-wide GMV / commission-earned / delivery-contribution stats.
- **Realtime**: all three dashboards subscribe to Postgres changes on `orders`
  via `supabase.channel(...).on('postgres_changes', ...)`, so a status update
  made by a supplier shows up instantly on the hotel's screen, and vice versa —
  no polling, no separate backend server needed.

Security is enforced with Postgres Row Level Security (see `schema.sql`):
a hotel can only see/edit its own orders, a supplier only sees orders routed to
it, and only admins see everything. This means the React app can talk to
Supabase directly — there's no separate Express API to deploy or keep in sync.

---

## 2. Set up Supabase (5 minutes)

1. Create a project at [supabase.com](https://supabase.com) (or use an existing one).
2. In the Supabase dashboard, go to **SQL Editor → New query**, paste the entire
   contents of `supabase/schema.sql`, and run it. This creates all tables,
   triggers, RLS policies, enables Realtime on `orders`/`order_items`/
   `supplier_prices`, and seeds ~20 starter APMC products (rice, dals, onion,
   tomato, oil, spices, etc. — matching the plan's category 2).
3. Go to **Authentication → Providers** and make sure **Email** is enabled.
   For local testing, you can turn off "Confirm email" under
   **Authentication → Settings** so sign-ups work instantly without an inbox check.
4. Go to **Project Settings → API** and copy:
   - `Project URL` → `VITE_SUPABASE_URL`
   - `anon public` key → `VITE_SUPABASE_ANON_KEY`

---

## 3. Run locally

```bash
cd hotel-apmc-platform
npm install
cp .env.example .env      # paste your Supabase URL + anon key into .env
npm run dev
```

Open `http://localhost:5173`.

### Try the full flow

1. **Sign up as a Supplier** (role dropdown → "APMC / Wholesale Supplier"), fill
   in the business/APMC-yard details on the setup screen.
2. On the supplier dashboard, open **Today's prices** and publish a price for a
   few products (e.g. Onion ₹28/kg, Tomato ₹32/kg).
3. **Sign up as a Hotel** in a second browser (or incognito window), fill in the
   hotel setup screen.
4. On the hotel dashboard's **Place order** tab, pick the supplier you just
   created, add quantities, and click **Place order**.
5. Switch back to the supplier tab — the new order appears under **Incoming
   orders** (realtime, no refresh needed). Click **Mark Accepted → Mark Packed
   → Mark Out for delivery → Mark Delivered**.
6. Switch to the hotel tab — the status updates live under **My orders**.
7. To see the admin view, manually update that user's `role` to `admin` in the
   Supabase **Table editor → profiles** table, then sign in again — you'll see
   GMV, commission earned, and every order across the platform.

---

## 4. Deploy (matches your usual Render/Vercel pattern)

This is a static Vite build with no server component — deploy it to **Vercel**:

```bash
npm run build   # outputs to dist/
```

- Push this folder to a GitHub repo.
- In Vercel: **New Project → import repo**, framework preset **Vite**,
  build command `npm run build`, output directory `dist`.
- Add the two environment variables (`VITE_SUPABASE_URL`,
  `VITE_SUPABASE_ANON_KEY`) in Vercel's project settings.
- Nothing to deploy on Render for this MVP — Supabase *is* the backend
  (Postgres + Auth + Realtime + auto-generated REST API), so there's no
  Express server to run. If you later add features that need a server
  (e.g. Razorpay webhook handling, WhatsApp order intake per the plan's
  "Month 2" WhatsApp-first approach, SMS notifications), that's where a small
  Node/Express service on Render would plug in alongside this same Supabase DB.

---

## 5. Mapped against the business plan

| Plan section | Where it lives |
|---|---|
| §2 Initial product categories | Seeded in `products` table via `schema.sql` |
| §4 Revenue model (4% commission + ₹100 delivery) | `orders.commission_pct` / `delivery_contribution`, auto-calculated by the `recalc_order_total` trigger |
| §5 App structure (hotel/supplier/admin) | `HotelDashboard.jsx` / `SupplierDashboard.jsx` / `AdminDashboard.jsx` |
| §6 Repeat order, price visibility, order tracking | Cart pulls live `supplier_prices`; `OrderCard` shows full status timeline |
| §8 Quality (Grade A/B) | `supplier_prices.grade`, shown to hotels at order time |
| §9 Credit policy | `hotels.credit_allowed` flag (defaults to `false` — admin can flip it after 2–3 months, per the plan) |
| §12 Unit economics | Admin **Overview** tab shows GMV, commission earned, delivery contribution live |

Not yet built (intentionally out of MVP scope, flagged for later): online
payment collection (Razorpay), delivery-partner/consolidation-hub routing,
WhatsApp order intake, invoices/PDF generation, and supplier bidding/comparison.
The schema and RLS policies are structured so these can be added as new tables
(`payments`, `deliveries`) without reworking what's here.

---

## 6. Notes / known limitations of this MVP

- One order = one supplier (matches the plan's initial direct supplier→hotel
  delivery model in §7; multi-supplier "split cart" checkout can be added later
  for the consolidation-hub phase).
- Email/password auth only for now; phone/OTP can be added via Supabase Auth's
  phone provider if you want WhatsApp-adjacent onboarding.
- No automated tests included — given the size of this MVP, manual testing via
  the flow in section 3 is the fastest way to verify changes.
