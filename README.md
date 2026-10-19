# Jugendfeuerwehr Steinbergkirche

Eine lokal ausführbare TypeScript-Web-App für Bestellungen bei Veranstaltungen. Gäste bestellen per QR-Code direkt am Tisch; das Team verwaltet Speisekarte, Küche, Tische und Barzahlungen im Personalbereich.

## Start locally

Requirements: Node.js 20 or newer and npm.

```sh
npm install
npm run dev
```

Before the first start, run `npm run setup:admin` and choose a private username and password. Open [http://localhost:5173](http://localhost:5173) for the staff dashboard. Open [http://localhost:5173/e/feuerwehrfest?t=1](http://localhost:5173/e/feuerwehrfest?t=1) to try the guest menu for table 1.

The first start creates a local SQLite database in `data/` and seeds a sample event with twelve tables and a menu. The database stays on this machine. `npm run setup:admin` writes a salted scrypt password hash into the ignored local `.env` file; the plaintext password is not saved. `.env.example` documents the settings. By default, the development and API servers listen only on this computer. For a deliberate server deployment, configure a private account, set `HOST=0.0.0.0`, and configure a firewall and HTTPS.

To build the production assets and type-check the client and server:

```sh
npm run build
```

To start the built application, run `npm start` after the build. The Node server serves both the website and API at [http://localhost:3001](http://localhost:3001). Set `PORT` if a different port is needed.

## Ubuntu server (Docker)

After cloning the repository to the server, run `npm ci` and `npm run setup:admin` once in the checkout directory. Then build and start the container with `docker compose up -d --build`. The persistent named Docker volume keeps event data and orders through container rebuilds. Port 3001 is bound to the server's loopback address; expose it to guests only through a configured HTTPS reverse proxy and a public hostname. Never commit `.env`.

GitHub stores the project and runs the build workflow; it does not host the backend or guest ordering site. To let guests scan QR codes using their phones, the server needs a public HTTPS address. A private Tailscale address such as `100.x.x.x` is only reachable by devices connected to that private network.

## Public test deployment (GitHub + Vercel + Supabase)

Vercel runs the Express app and serves the built frontend; GitHub remains the source repository and triggers deployments when the connected production branch changes. In Vercel, import this repository and add `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `ADMIN_USERNAME`, and `ADMIN_PASSWORD_HASH` as production environment variables. The two admin values can be copied from the private local `.env`; keep the Supabase secret key marked sensitive. Deploy the production branch to get a public HTTPS link. The Vercel adapter keeps SQLite's unused fallback file in temporary storage; order data is stored in Supabase.

The Vercel Hobby and Supabase Free plans are for testing, not guaranteed always-on production. Supabase may pause a Free project after a week of low activity. Vercel Hobby is intended for personal, non-commercial projects. Check both providers' current terms and upgrade to suitable paid plans before relying on this for sales or live events.

## Supabase database backend

Supabase provides the hosted PostgreSQL database; the Node.js server still needs to run on your Ubuntu host or another application host. Install the official Supabase CLI and authenticate it with `supabase login`, then link the project and apply migrations from the repository root:

```sh
supabase projects list
supabase link --project-ref <project-ref>
supabase db push
```

`supabase link` asks for the database password in the terminal. Do not put it in a command, chat message, or repository file. Add `SUPABASE_URL` and the server-side `SUPABASE_SECRET_KEY` (or legacy service-role key) to the uncommitted `.env` on the application host. Never use the public anon/publishable key as a server secret, and never commit the server key. When both variables are configured, orders, events, sessions, menus, and tables use Supabase PostgreSQL. The database tables use row-level security without public access policies; only the private server key is used to access them. Without these variables, local development continues to use SQLite.

## Included

- Guest menu with table selection, cart, item notes and order confirmation
- Password-protected staff dashboard with live polling, kitchen workflow and cash register
- Multiple isolated events, each with its own menu, tables, QR codes and orders
- Product and table management, with per-table QR codes
- Cash payment recording, optional tip and a printable event receipt
- SQLite persistence and request validation
- German imprint and privacy templates at `/impressum` and `/datenschutz`

The printed event receipt is a simple hospitality receipt, not a certified fiscal receipt or a substitute for a TSE-compliant cash register. This MVP has no online payment, guest accounts, email delivery, or separate staff roles. Do not expose an unconfigured server to the public internet. Before real operation, configure HTTPS and access controls, complete the legal templates with the organizer's information, and verify applicable tax and cash-register requirements with a qualified professional.

## API layout

- Guest: `GET /api/public/:eventSlug`, `POST /api/events/:eventSlug/orders`
- Staff: `POST /api/staff/login` creates an eight-hour secure session cookie. Authenticated staff use `GET/POST /api/staff/events`; event-specific staff routes also require an `x-event-id` header.
