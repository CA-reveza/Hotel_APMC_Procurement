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
│   ├── schema.sql              # core DB schema, RLS policies, triggers, seed products
│   ├── schema_extensions.sql   # payments, delivery routing, WhatsApp, bidding — run after schema.sql
│   └── functions/               # Edge Functions (Deno) — the only server-side code in this project
│       ├── create-razorpay-order/
│       ├── verify-razorpay-payment/
│       ├── whatsapp-webhook/
│       └── _shared/cors.ts
├── src/
│   ├── supabaseClient.js   # Supabase client (reads VITE_SUPABASE_URL / ANON_KEY)
│   ├── lib/
│   │   ├── useAuth.js      # session + profile + hotel/supplier record hook
│   │   └── invoice.js      # client-side PDF invoice generation (jsPDF)
│   ├── App.jsx             # role-based router (hotel / supplier / admin)
│   ├── pages/
│   │   ├── Login.jsx           # sign in / sign up (role selection)
│   │   ├── SetupOrg.jsx        # first-time hotel/supplier business details
│   │   ├── HotelDashboard.jsx  # browse prices, cart, place orders, request quotes, order history
│   │   ├── SupplierDashboard.jsx # publish daily prices, accept/progress orders, respond to quote requests
│   │   └── AdminDashboard.jsx  # GMV, commission, all hotels/suppliers/orders/deliveries
│   └── components/
│       ├── Navbar.jsx, OrderList.jsx, OrderCard.jsx
│       ├── PaymentButton.jsx   # Razorpay Checkout trigger
│       ├── DeliveryPanel.jsx   # direct / consolidation-hub delivery tracking on each order
│       ├── QuoteRequests.jsx   # hotel side of supplier bidding
│       └── OpenRequests.jsx    # supplier side of supplier bidding
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

**Five extra features on top of the MVP** (all in `schema_extensions.sql` +
the components listed above):

1. **Razorpay payments** — hotel taps **Pay ₹...** on an order → an Edge
   Function creates a Razorpay Order (key secret stays server-side) → Razorpay
   Checkout opens → on success another Edge Function verifies the payment
   signature server-side and marks the order `paid`. No payment status is
   ever trusted from the browser alone.
2. **Delivery / consolidation routing** — each order gets a `DeliveryPanel`
   where the supplier or admin records whether it's going **direct** to the
   hotel or **via a consolidation hub** (plan §7), plus the delivery
   partner's name/phone and pickup/delivery timestamps. Admin has a
   **Deliveries** tab listing all of them.
3. **WhatsApp order intake** — a Twilio-facing Edge Function
   (`whatsapp-webhook`) lets a hotel text an order (`ORDER <supplier>` +
   `Product:qty` lines) and it's created in the same `orders` table, tagged
   `source = 'whatsapp'` so it shows a badge in the app.
4. **Invoices/PDF** — `Download invoice` on any delivered order generates a
   PDF client-side (jsPDF) with the item table, totals, and commission
   breakdown. No server round-trip.
5. **Supplier bidding/comparison** — hotel posts a one-product requirement
   under **Request quotes**, it's broadcast to every supplier, each submits a
   sealed price/grade/availability quote under **Open requests**, and the
   hotel accepts the best one to instantly create a real order.

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
5. Back in **SQL Editor**, run `supabase/schema_extensions.sql` too (adds
   payments, deliveries, WhatsApp support column, and quote requests/bidding).

### 2a. Set up the extra features (optional — skip any you don't need yet)

**Razorpay payments**
1. Get test keys from [Razorpay Dashboard → Settings → API Keys](https://dashboard.razorpay.com/app/keys).
2. Install the Supabase CLI (`npm install -g supabase`) and log in / link your project:
   ```bash
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   ```
3. Set the secrets the Edge Functions need:
   ```bash
   supabase secrets set RAZORPAY_KEY_ID=rzp_test_xxx RAZORPAY_KEY_SECRET=xxx
   ```
   (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are
   already available to every Edge Function automatically — no need to set them.)
4. Deploy the two payment functions:
   ```bash
   supabase functions deploy create-razorpay-order
   supabase functions deploy verify-razorpay-payment
   ```
5. That's it — the **Pay ₹...** button in the app calls these automatically
   via `supabase.functions.invoke(...)`, using whatever project your `.env`
   points at.

**WhatsApp order intake** (via Twilio's WhatsApp Sandbox — free for testing)
1. Deploy the function: `supabase functions deploy whatsapp-webhook`
2. Copy its URL from the Supabase dashboard (**Edge Functions** tab).
3. In [Twilio Console → Messaging → Try it out → WhatsApp Sandbox](https://console.twilio.com/), set
   "When a message comes in" to that URL, method `POST`, and join the sandbox
   from your phone.
4. For a hotel to order via WhatsApp, their **profile phone number** (set at
   sign-up, or editable by admin in **Table Editor → profiles**) must match
   the WhatsApp number they text from, in the same format Twilio sends
   (usually `+91XXXXXXXXXX`).
5. Text e.g.:
   ```
   ORDER Ramesh Traders
   Onion:5
   Tomato:3
   ```
   The webhook fuzzy-matches the supplier name and each product name, prices
   them from that supplier's latest `supplier_prices`, creates the order, and
   replies with a confirmation + total.

**Delivery routing, invoices, and supplier bidding** need no extra setup
beyond `schema_extensions.sql` — they work as soon as you run it.

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
   GMV, commission earned, and every order across the platform, plus a
   **Deliveries** tab.
8. Back on the hotel dashboard, try **Request quotes**: post a product +
   quantity, switch to the supplier tab's **Open requests** to submit a
   price, then back on the hotel side accept the best quote to create an order.
9. On an order, the supplier or admin can open the delivery panel on the order
   card to record **direct** vs **via hub** delivery and a partner's
   name/phone. Once an order reaches **Delivered**, either side can click
   **Download invoice** for a PDF.
10. If you've deployed the Razorpay Edge Functions (see section 2a), the
    hotel can click **Pay ₹...** on an unpaid order to test the full Razorpay
    Checkout flow with Razorpay's test card numbers.

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
- **Edge Functions deploy to Supabase, not Vercel/Render** — that's the one
  piece of server-side code this project has (Razorpay + WhatsApp), and it's
  already covered by `supabase functions deploy ...` in section 2a. There's
  still no separate Express/Node server to stand up on Render for this project.

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
| §7 Delivery strategy (direct → consolidation hub) | `deliveries` table + `DeliveryPanel.jsx`, editable by supplier/admin |
| §12 Unit economics | Admin **Overview** tab shows GMV, commission earned, delivery contribution live, plus paid-order and WhatsApp-order counts |
| Payment collection | `payments` table + Razorpay Checkout via `create-razorpay-order` / `verify-razorpay-payment` Edge Functions |
| WhatsApp ordering (plan's Month-2 "start cheap" approach) | `whatsapp-webhook` Edge Function, orders tagged `source = 'whatsapp'` |
| Invoices | `lib/invoice.js`, client-side PDF via jsPDF, no server round-trip |
| Supplier bidding/comparison | `quote_requests` + `supplier_quotes` tables, `QuoteRequests.jsx` (hotel) / `OpenRequests.jsx` (supplier) |

---

## 6. Notes / known limitations

- One order = one supplier per checkout (matches the plan's initial direct
  supplier→hotel delivery model in §7). The bidding flow (§5 above) works
  around this for single-product requirements; a true multi-supplier
  "split cart" checkout for the consolidation-hub phase isn't built yet.
- WhatsApp intake matches hotels by phone number and suppliers/products by
  fuzzy name match — good enough for a pilot, but a hotel with a slightly
  misspelled supplier/product name in their text will get a "not found"
  reply rather than a smart correction.
- Razorpay is wired for one-time payment per order, not saved cards, UPI
  autopay, or partial/split payments.
- The `payments` table has no client-side write policy by design — only the
  Edge Functions (service-role key) can write to it, so payment status can't
  be spoofed from the browser. If you ever see payment rows not updating,
  check the Edge Function logs (`supabase functions logs verify-razorpay-payment`)
  first.
- No automated tests included — given the size of this project, manual
  testing via the flow in section 3 is the fastest way to verify changes.
