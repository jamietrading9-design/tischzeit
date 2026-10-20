import express, { type Request, type Response, type NextFunction } from "express";
import "dotenv/config";
import Database from "better-sqlite3";
import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const here = dirname(fileURLToPath(import.meta.url));
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (Boolean(supabaseUrl) !== Boolean(supabaseKey)) {
  throw new Error("SUPABASE_URL und SUPABASE_SECRET_KEY müssen gemeinsam gesetzt werden.");
}
const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;
const defaultDataPath = process.env.VERCEL === "1" ? "/tmp/tischzeit.sqlite" : `${here}/../data/tischzeit.sqlite`;
const dataPath = resolve(process.env.DATABASE_PATH ?? defaultDataPath);
mkdirSync(dirname(dataPath), { recursive: true });

const db = new Database(dataPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    welcome_text TEXT NOT NULL DEFAULT 'Artikel auswählen und Bestellung an die Küche senden.',
    accent_color TEXT NOT NULL DEFAULT '#963b35',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
db.prepare("INSERT OR IGNORE INTO events (id, name, slug) VALUES (1, 'Jugendfeuerwehr Steinbergkirche', 'feuerwehrfest')").run();

function tableExists(name: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function hasEventScope(table: string): boolean {
  return tableExists(table) && (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((column) => column.name === "event_id");
}

const scopedTables = ["tables", "products", "orders", "order_items"];
if (scopedTables.some((table) => tableExists(table) && !hasEventScope(table))) {
  db.pragma("foreign_keys = OFF");
  const migrateLegacyDatabase = db.transaction(() => {
    for (const table of ["order_items", "orders", "products", "tables"]) {
      if (tableExists(table)) db.exec(`ALTER TABLE ${table} RENAME TO legacy_${table}`);
    }
    createScopedSchema();
    if (tableExists("legacy_tables")) {
      db.exec("INSERT INTO tables (id, event_id, name, active) SELECT id, 1, name, active FROM legacy_tables");
    }
    if (tableExists("legacy_products")) {
      db.exec("INSERT INTO products (id, event_id, name, description, category, price_cents, available) SELECT id, 1, name, description, category, price_cents, available FROM legacy_products");
    }
    if (tableExists("legacy_orders")) {
      db.exec("INSERT INTO orders (id, event_id, table_id, status, total_cents, tip_cents, created_at, paid_at) SELECT id, 1, table_id, status, total_cents, tip_cents, created_at, paid_at FROM legacy_orders");
    }
    if (tableExists("legacy_order_items")) {
      db.exec("INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price_cents, note) SELECT id, order_id, product_id, product_name, quantity, unit_price_cents, note FROM legacy_order_items");
    }
    for (const table of ["order_items", "orders", "products", "tables"]) {
      if (tableExists(`legacy_${table}`)) db.exec(`DROP TABLE legacy_${table}`);
    }
  });
  migrateLegacyDatabase();
  db.pragma("foreign_keys = ON");
} else {
  createScopedSchema();
}

function createScopedSchema() {
  db.exec(`
  CREATE TABLE IF NOT EXISTS tables (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES events(id),
    name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    UNIQUE(event_id, name),
    UNIQUE(event_id, id)
  );
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES events(id),
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'Speisen',
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    available INTEGER NOT NULL DEFAULT 1,
    UNIQUE(event_id, id)
  );
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES events(id),
    table_id INTEGER NOT NULL REFERENCES tables(id),
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'preparing', 'ready', 'paid')),
    total_cents INTEGER NOT NULL,
    tip_cents INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    paid_at TEXT,
    customer_id INTEGER,
    canceled_at TEXT,
    cancellation_reason TEXT,
    canceled_by TEXT,
    FOREIGN KEY (event_id, table_id) REFERENCES tables(event_id, id)
  );
  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL,
    product_name TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price_cents INTEGER NOT NULL,
    note TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS staff_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS staff_users (
    username TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'staff')),
    role_id TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS staff_roles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    permissions TEXT NOT NULL,
    session_minutes INTEGER NOT NULL DEFAULT 10 CHECK (session_minutes BETWEEN 10 AND 10080),
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    identifier_hash TEXT NOT NULL UNIQUE,
    banned INTEGER NOT NULL DEFAULT 0,
    ban_reason TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS finance_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES events(id),
    kind TEXT NOT NULL CHECK (kind IN ('income', 'expense')),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    description TEXT NOT NULL,
    entry_date TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TRIGGER IF NOT EXISTS orders_reject_banned_customer
  BEFORE INSERT ON orders
  WHEN NEW.customer_id IS NOT NULL
  BEGIN
    SELECT CASE
      WHEN NOT EXISTS (SELECT 1 FROM customers WHERE id = NEW.customer_id AND banned = 0)
      THEN RAISE(ABORT, 'CUSTOMER_BLOCKED')
    END;
  END;
`);
}

function ensureSqliteColumn(table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

for (const [table, column, definition] of [
  ["events", "welcome_text", "welcome_text TEXT NOT NULL DEFAULT 'Artikel auswählen und Bestellung an die Küche senden.'"],
  ["events", "accent_color", "accent_color TEXT NOT NULL DEFAULT '#963b35'"],
  ["orders", "customer_id", "customer_id INTEGER"],
  ["orders", "canceled_at", "canceled_at TEXT"],
  ["orders", "cancellation_reason", "cancellation_reason TEXT"],
  ["orders", "canceled_by", "canceled_by TEXT"],
  ["staff_sessions", "user_id", "user_id TEXT"],
  ["staff_sessions", "created_at", "created_at TEXT"],
  ["staff_users", "role_id", "role_id TEXT"],
] as const) {
  ensureSqliteColumn(table, column, definition);
}
db.prepare("UPDATE staff_sessions SET created_at = datetime('now') WHERE created_at IS NULL").run();

const permissionKeys = [
  "orders.view", "orders.edit", "kitchen.view", "kitchen.edit", "cash.view", "cash.edit",
  "menu.view", "menu.edit", "tables.view", "tables.edit", "receipts.view", "receipts.cancel",
  "customers.view", "customers.manage", "users.manage", "roles.manage", "settings.manage",
  "finance.view", "finance.edit",
] as const;
type Permission = typeof permissionKeys[number];

const defaultRoleDefinitions: Array<{ id: string; name: string; permissions: Permission[]; sessionMinutes: number; isAdmin: boolean }> = [
  { id: "administrator", name: "Administrator", permissions: [...permissionKeys], sessionMinutes: 480, isAdmin: true },
  {
    id: "personal",
    name: "Personal",
    permissions: ["orders.view", "orders.edit", "kitchen.view", "kitchen.edit", "cash.view", "cash.edit", "menu.view", "tables.view", "tables.edit"],
    sessionMinutes: 10,
    isAdmin: false,
  },
];
for (const role of defaultRoleDefinitions) {
  db.prepare(`
    INSERT OR IGNORE INTO staff_roles (id, name, permissions, session_minutes, is_admin)
    VALUES (?, ?, ?, ?, ?)
  `).run(role.id, role.name, JSON.stringify(role.permissions), role.sessionMinutes, Number(role.isAdmin));
}
db.prepare("UPDATE staff_users SET role_id = 'administrator' WHERE role = 'admin' AND role_id IS NULL").run();
db.prepare("UPDATE staff_users SET role_id = 'personal' WHERE role = 'staff' AND role_id IS NULL").run();

function addEventDefaults(eventId: number) {
  const insertTable = db.prepare("INSERT OR IGNORE INTO tables (event_id, name) VALUES (?, ?)");
  for (let number = 1; number <= 12; number += 1) {
    insertTable.run(eventId, `Tisch ${number}`);
  }
  const productCount = db.prepare("SELECT COUNT(*) AS count FROM products WHERE event_id = ?").get(eventId) as { count: number };
  if (productCount.count > 0) return;
  const insert = db.prepare("INSERT INTO products (event_id, name, description, category, price_cents) VALUES (?, ?, ?, ?, ?)");
  const seed = db.transaction(() => {
    insert.run(eventId, "Bratwurst im Weckle", "Vom Grill mit Senf oder Ketchup", "Vom Grill", 450);
    insert.run(eventId, "Rote Wurst", "Traditionell vom Grill", "Vom Grill", 450);
    insert.run(eventId, "Pommes", "Knusprig, mit Ketchup oder Mayo", "Beilagen", 350);
    insert.run(eventId, "Vegetarischer Flammkuchen", "Schmand, Zwiebeln, Käse", "Vegetarisch", 850);
    insert.run(eventId, "Bier 0,5 l", "Pils vom Fass", "Getränke", 400);
    insert.run(eventId, "Apfelschorle 0,4 l", "Regionaler Apfelsaft, spritzig", "Getränke", 300);
  });
  seed();
}
addEventDefaults(1);

const app = express();
app.use(express.json({ limit: "64kb" }));
app.get("/healthz", async (_req, res) => {
  if (supabase) {
    const { error } = await supabase.from("tisch_events").select("id").limit(1);
    if (error) {
      res.status(503).json({ status: "unavailable", storage: "supabase" });
      return;
    }
    res.json({ status: "ok", storage: "supabase" });
    return;
  }
  const result = db.pragma("quick_check", { simple: true });
  if (result !== "ok") {
    res.status(503).json({ status: "unavailable", storage: "sqlite" });
    return;
  }
  res.json({ status: "ok", storage: "sqlite" });
});

type Product = { id: number; name: string; description: string; category: string; price_cents: number; available: number };
type Order = {
  id: string;
  event_id: number;
  table_id: number;
  table_name: string;
  status: string;
  total_cents: number;
  tip_cents: number;
  created_at: string;
  paid_at: string | null;
  customer_id: number | null;
  canceled_at: string | null;
  cancellation_reason: string | null;
  canceled_by: string | null;
  items: Array<{ product_name: string; quantity: number; unit_price_cents: number; note: string }>;
};
type EventRecord = {
  id: number; name: string; slug: string; created_at: string;
  welcome_text?: string; accent_color?: string;
};
type StaffUser = {
  username: string; role: "admin" | "staff"; roleId: string; roleName: string;
  permissions: Permission[]; isAdmin: boolean; sessionMinutes: number; active: boolean;
};

const sessionCookie = "tischzeit_session";
const customerCookie = "tischzeit_customer";
const fallbackSessionMinutes = 10;
const failedLogins = new Map<string, { count: number; resetAt: number }>();

function cloudError(error: { message: string; code?: string }): Error {
  return new Error(error.code === "23505" ? "Dieser Eintrag existiert bereits." : error.message);
}

async function cloudEvent(slug: string): Promise<EventRecord | undefined> {
  if (!supabase) return undefined;
  const { data, error } = await supabase.from("tisch_events").select("id, name, slug, created_at").eq("slug", slug).maybeSingle();
  if (error) throw cloudError(error);
  return data as EventRecord | undefined;
}

async function cloudOrder(id: string, eventId?: number): Promise<Order | undefined> {
  if (!supabase) return undefined;
  let ordersQuery = supabase.from("tisch_orders").select("*").eq("id", id);
  if (eventId !== undefined) ordersQuery = ordersQuery.eq("event_id", eventId);
  const { data: order, error: orderError } = await ordersQuery.maybeSingle();
  if (orderError) throw cloudError(orderError);
  if (!order) return undefined;
  const [{ data: table, error: tableError }, { data: items, error: itemsError }] = await Promise.all([
    supabase.from("tisch_tables").select("name").eq("event_id", order.event_id).eq("id", order.table_id).single(),
    supabase.from("tisch_order_items").select("product_name, quantity, unit_price_cents, note").eq("order_id", id).order("id"),
  ]);
  if (tableError) throw cloudError(tableError);
  if (itemsError) throw cloudError(itemsError);
  return {
    ...order,
    table_name: table.name,
    created_at: new Date(order.created_at).toISOString(),
    paid_at: order.paid_at ? new Date(order.paid_at).toISOString() : null,
    items: items ?? [],
  } as Order;
}

type CustomerIdentity = { id: number; banned: boolean; ban_reason: string };

async function getOrCreateCustomer(req: Request, res: Response): Promise<CustomerIdentity> {
  const rawCookie = req.headers.cookie?.split(/;\s*/).find((part) => part.startsWith(`${customerCookie}=`));
  let token = rawCookie?.slice(customerCookie.length + 1);
  if (!token || !/^[a-f0-9]{64}$/i.test(token)) token = randomBytes(32).toString("hex");
  const identifierHash = createHash("sha256").update(token).digest("hex");
  let customer: CustomerIdentity | undefined;
  if (supabase) {
    const { data, error } = await supabase.from("tisch_customers").select("id, banned, ban_reason").eq("identifier_hash", identifierHash).maybeSingle();
    if (error) throw cloudError(error);
    customer = data as CustomerIdentity | undefined;
    if (!customer) {
      const { data: created, error: createError } = await supabase.from("tisch_customers")
        .insert({ identifier_hash: identifierHash }).select("id, banned, ban_reason").single();
      if (createError?.code === "23505") {
        const { data: existing, error: lookupError } = await supabase.from("tisch_customers")
          .select("id, banned, ban_reason").eq("identifier_hash", identifierHash).single();
        if (lookupError) throw cloudError(lookupError);
        customer = existing as CustomerIdentity;
      } else if (createError) {
        throw cloudError(createError);
      } else {
        customer = created as CustomerIdentity;
      }
    }
  } else {
    const find = db.prepare("SELECT id, banned, ban_reason FROM customers WHERE identifier_hash = ?");
    customer = find.get(identifierHash) as CustomerIdentity | undefined;
    if (!customer) {
      const created = db.prepare("INSERT OR IGNORE INTO customers (identifier_hash) VALUES (?)").run(identifierHash);
      customer = find.get(identifierHash) as CustomerIdentity | undefined;
      if (!customer && created.changes === 0) throw new Error("Die Kundenakte konnte nicht angelegt werden.");
    }
  }
  if (!customer) throw new Error("Die Kundenakte konnte nicht geladen werden.");
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${customerCookie}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000${secure}`);
  return customer;
}

async function getCustomerForCurrentDevice(req: Request): Promise<CustomerIdentity | undefined> {
  const rawCookie = req.headers.cookie?.split(/;\s*/).find((part) => part.startsWith(`${customerCookie}=`));
  const token = rawCookie?.slice(customerCookie.length + 1);
  if (!token || !/^[a-f0-9]{64}$/i.test(token)) return undefined;
  const identifierHash = createHash("sha256").update(token).digest("hex");
  if (supabase) {
    const { data, error } = await supabase.from("tisch_customers")
      .select("id, banned, ban_reason").eq("identifier_hash", identifierHash).maybeSingle();
    if (error) throw cloudError(error);
    return data as CustomerIdentity | undefined;
  }
  return db.prepare("SELECT id, banned, ban_reason FROM customers WHERE identifier_hash = ?")
    .get(identifierHash) as CustomerIdentity | undefined;
}

const productInput = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(240).default(""),
  category: z.string().trim().min(1).max(40),
  priceCents: z.number().int().min(0).max(100000),
  available: z.boolean().default(true),
});
const orderInput = z.object({
  tableId: z.number().int().positive(),
  items: z.array(z.object({
    productId: z.number().int().positive(),
    quantity: z.number().int().min(1).max(20),
    note: z.string().trim().max(160).default(""),
  })).min(1).max(40),
});

async function staffOnly(req: Request, res: Response, next: NextFunction) {
  const rawCookie = req.headers.cookie?.split(/;\s*/).find((part) => part.startsWith(`${sessionCookie}=`));
  const token = rawCookie?.slice(sessionCookie.length + 1);
  if (!token) {
    res.status(401).json({ error: "Bitte melde dich an." });
    return;
  }
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const session: {
    token_hash: string; user_id: string;
    created_at: string; expires_at: string;
    tisch_staff_users?: { username: string; role: "admin" | "staff"; role_id: string | null; active: boolean }
      | Array<{ username: string; role: "admin" | "staff"; role_id: string | null; active: boolean }>;
  } | { token_hash: string; user_id: string; username: string; role: "admin" | "staff"; role_id: string | null; active: number } | null | undefined = supabase
    ? await supabase.from("tisch_staff_sessions")
      .select("token_hash, user_id, created_at, expires_at, tisch_staff_users!inner(username, role, role_id, active)")
      .eq("token_hash", tokenHash).gt("expires_at", new Date().toISOString()).maybeSingle()
      .then(({ data, error }) => {
        if (error) throw cloudError(error);
        return data as { token_hash: string; user_id: string; created_at: string; expires_at: string; tisch_staff_users?: { username: string; role: "admin" | "staff"; role_id: string | null; active: boolean } } | null;
      })
    : db.prepare(`
      SELECT sessions.token_hash, sessions.user_id, sessions.created_at, sessions.expires_at, users.username, users.role, users.role_id, users.active
      FROM staff_sessions AS sessions
      JOIN staff_users AS users ON users.username = sessions.user_id
      WHERE sessions.token_hash = ? AND sessions.expires_at > datetime('now')
    `).get(tokenHash) as { token_hash: string; user_id: string; created_at: string; expires_at: string; username: string; role: "admin" | "staff"; role_id: string | null; active: number } | undefined;
  const relationUser = session && "tisch_staff_users" in session ? session.tisch_staff_users : undefined;
  const sessionUser: { username: string; role: "admin" | "staff"; role_id: string | null; active: boolean | number } | undefined =
    Array.isArray(relationUser) ? relationUser[0]
      : relationUser ?? (session && "username" in session
        ? { username: session.username, role: session.role, role_id: session.role_id, active: Boolean(session.active) }
        : undefined);
  if (!session || !sessionUser?.active) {
    res.setHeader("Set-Cookie", `${sessionCookie}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
    res.status(401).json({ error: "Deine Sitzung ist abgelaufen. Bitte melde dich erneut an." });
    return;
  }
  const roleId = sessionUser.role_id ?? (sessionUser.role === "admin" ? "administrator" : "personal");
  const role = supabase
    ? await supabase.from("tisch_staff_roles").select("id, name, permissions, session_minutes, is_admin").eq("id", roleId).maybeSingle().then(({ data, error }) => {
      if (error) throw cloudError(error);
      return data as { id: string; name: string; permissions: Permission[] | string; session_minutes: number; is_admin: boolean } | null;
    })
    : db.prepare("SELECT id, name, permissions, session_minutes, is_admin FROM staff_roles WHERE id = ?").get(roleId) as { id: string; name: string; permissions: string; session_minutes: number; is_admin: number } | undefined;
  const permissions = parsePermissions(role?.permissions);
  const isAdmin = role ? Boolean(role.is_admin) : sessionUser.role === "admin";
  const createdAtText = session && "created_at" in session ? session.created_at : "";
  const createdAtMs = Date.parse(createdAtText.includes("T") ? createdAtText : `${createdAtText.replace(" ", "T")}Z`);
  if (!Number.isFinite(createdAtMs) || Date.now() >= createdAtMs + (role?.session_minutes ?? fallbackSessionMinutes) * 60 * 1000) {
    if (supabase) {
      const { error } = await supabase.from("tisch_staff_sessions").delete().eq("token_hash", tokenHash);
      if (error) throw cloudError(error);
    } else {
      db.prepare("DELETE FROM staff_sessions WHERE token_hash = ?").run(tokenHash);
    }
    res.setHeader("Set-Cookie", `${sessionCookie}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
    res.status(401).json({ error: "Deine Sitzung ist abgelaufen. Bitte melde dich erneut an." });
    return;
  }
  res.locals.sessionTokenHash = tokenHash;
  res.locals.staffUser = {
    username: sessionUser.username,
    role: sessionUser.role,
    roleId,
    roleName: role?.name ?? (isAdmin ? "Administrator" : "Personal"),
    permissions,
    isAdmin,
    sessionMinutes: role?.session_minutes ?? fallbackSessionMinutes,
    active: true,
  } satisfies StaffUser;
  next();
}

function requirePermission(permission: Permission) {
  return (_req: Request, res: Response, next: NextFunction) => {
    const staffUser = res.locals.staffUser as StaffUser | undefined;
    if (staffUser?.isAdmin || hasPermission(staffUser, permission)) {
      next();
      return;
    }
    res.status(403).json({ error: "Für diese Funktion fehlt dir die passende Berechtigung." });
  };
}

function hasPermission(user: StaffUser | undefined, permission: Permission): boolean {
  if (!user) return false;
  const impliedEdit: Partial<Record<Permission, Permission>> = {
    "orders.view": "orders.edit", "kitchen.view": "kitchen.edit", "cash.view": "cash.edit",
    "menu.view": "menu.edit", "tables.view": "tables.edit", "customers.view": "customers.manage",
    "receipts.view": "receipts.cancel", "finance.view": "finance.edit",
  };
  return user.permissions.includes(permission)
    || Boolean(impliedEdit[permission] && user.permissions.includes(impliedEdit[permission]!));
}

function parsePermissions(value: unknown): Permission[] {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      throw new Error("Die gespeicherten Rollenrechte sind ungültig.");
    }
  }
  if (parsed === undefined || parsed === null) return [];
  if (!Array.isArray(parsed) || parsed.some((permission) => !permissionKeys.includes(permission as Permission))) {
    throw new Error("Die gespeicherten Rollenrechte sind ungültig.");
  }
  return [...new Set(parsed as Permission[])];
}

function requireOnePermission(...permissions: Permission[]) {
  return (_req: Request, res: Response, next: NextFunction) => {
    const staffUser = res.locals.staffUser as StaffUser | undefined;
    if (staffUser?.isAdmin || permissions.some((permission) => hasPermission(staffUser, permission))) {
      next();
      return;
    }
    res.status(403).json({ error: "Für diese Funktion fehlt dir die passende Berechtigung." });
  };
}

function makePasswordHash(password: string): string {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(password, salt, 64).toString("hex")}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const [saltHex, hashHex] = storedHash.split(":");
  if (!/^[a-f0-9]{32}$/i.test(saltHex ?? "") || !/^[a-f0-9]{128}$/i.test(hashHex ?? "")) return false;
  return timingSafeEqual(scryptSync(password, Buffer.from(saltHex, "hex"), 64), Buffer.from(hashHex, "hex"));
}

async function activeEvent(req: Request, res: Response, next: NextFunction) {
  const eventId = Number(req.get("x-event-id"));
  const event = Number.isSafeInteger(eventId) && eventId > 0
    ? supabase
      ? await supabase.from("tisch_events").select("id").eq("id", eventId).maybeSingle().then(({ data, error }) => {
        if (error) throw cloudError(error);
        return data;
      })
      : db.prepare("SELECT 1 FROM events WHERE id = ?").get(eventId)
    : undefined;
  if (!event) {
    res.status(400).json({ error: "Bitte wähle zuerst eine Veranstaltung aus." });
    return;
  }
  res.locals.eventId = eventId;
  next();
}

function pathParam(req: Request, name: string): string | undefined {
  const value = req.params[name];
  return typeof value === "string" ? value : undefined;
}

async function getOrder(id: string): Promise<Order | undefined> {
  if (supabase) return cloudOrder(id);
  const order = db.prepare(`
    SELECT orders.*, tables.name AS table_name
    FROM orders JOIN tables ON tables.id = orders.table_id WHERE orders.id = ?
  `).get(id) as Omit<Order, "items"> | undefined;
  if (!order) return undefined;
  const items = db.prepare("SELECT product_name, quantity, unit_price_cents, note FROM order_items WHERE order_id = ? ORDER BY id")
    .all(id) as Order["items"];
  return { ...order, items };
}

function publicOrder(order: Order) {
  const { customer_id: _customerId, canceled_by: _canceledBy, cancellation_reason: _cancellationReason, ...publicFields } = order;
  return publicFields;
}

app.get("/api/public/:slug", async (req, res) => {
  const slug = pathParam(req, "slug");
  const event = slug
    ? supabase
      ? await supabase.from("tisch_events").select("id, name, slug, welcome_text, accent_color, created_at").eq("slug", slug).maybeSingle()
        .then(({ data, error }) => {
          if (error) throw cloudError(error);
          return data as EventRecord | undefined;
        })
      : db.prepare("SELECT id, name, slug, welcome_text, accent_color, created_at FROM events WHERE slug = ?").get(slug) as EventRecord | undefined
    : undefined;
  if (!event) {
    res.status(404).json({ error: "Diese Veranstaltung wurde nicht gefunden." });
    return;
  }
  const [products, tables] = supabase
    ? await Promise.all([
      supabase.from("tisch_products").select("id, name, description, category, price_cents").eq("event_id", event.id).eq("available", true).order("category").order("name"),
      supabase.from("tisch_tables").select("id, name").eq("event_id", event.id).eq("active", true).order("id"),
    ]).then(([productResult, tableResult]) => {
      if (productResult.error) throw cloudError(productResult.error);
      if (tableResult.error) throw cloudError(tableResult.error);
      return [productResult.data, tableResult.data];
    })
    : [
      db.prepare("SELECT id, name, description, category, price_cents FROM products WHERE event_id = ? AND available = 1 ORDER BY category, name").all(event.id),
      db.prepare("SELECT id, name FROM tables WHERE event_id = ? AND active = 1 ORDER BY id").all(event.id),
    ];
  res.json({
    venueName: event.name,
    eventSlug: event.slug,
    welcomeText: event.welcome_text ?? "Artikel auswählen und Bestellung an die Küche senden.",
    accentColor: event.accent_color ?? "#963b35",
    products,
    tables,
  });
});

app.post("/api/events/:slug/orders", async (req, res) => {
  const slug = pathParam(req, "slug");
  const event = slug
    ? supabase ? await cloudEvent(slug) : db.prepare("SELECT id, name, slug FROM events WHERE slug = ?").get(slug) as EventRecord | undefined
    : undefined;
  if (!event) {
    res.status(404).json({ error: "Diese Veranstaltung wurde nicht gefunden." });
    return;
  }
  const parsed = orderInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Bitte prüfe deine Bestellung." });
    return;
  }
  if (supabase) {
    const { data: table, error: tableError } = await supabase.from("tisch_tables").select("id")
      .eq("event_id", event.id).eq("id", parsed.data.tableId).eq("active", true).maybeSingle();
    if (tableError) throw cloudError(tableError);
    if (!table) {
      res.status(400).json({ error: "Dieser Tisch ist nicht verfügbar." });
      return;
    }
    const productIds = [...new Set(parsed.data.items.map((item) => item.productId))];
    const { data: products, error: productError } = await supabase.from("tisch_products")
      .select("id, price_cents").eq("event_id", event.id).eq("available", true).in("id", productIds);
    if (productError) throw cloudError(productError);
    const priceByProduct = new Map((products ?? []).map((product) => [product.id, product.price_cents]));
    if (priceByProduct.size !== productIds.length) {
      res.status(400).json({ error: "Ein Produkt ist inzwischen nicht mehr verfügbar. Bitte lade die Karte neu." });
      return;
    }
    const total = parsed.data.items.reduce((sum, item) => sum + (priceByProduct.get(item.productId) ?? 0) * item.quantity, 0);
    if (total > 1000000) {
      res.status(400).json({ error: "Die Bestellung ist zu groß. Bitte teile sie auf." });
      return;
    }
    const customer = await getOrCreateCustomer(req, res);
    if (customer.banned) {
      res.status(403).json({ error: "Bestellungen sind für dieses Gerät nicht möglich." });
      return;
    }
    const { data, error: orderError } = await supabase.rpc("tisch_place_order", {
      p_event_slug: event.slug,
      p_table_id: parsed.data.tableId,
      p_items: parsed.data.items,
      p_customer_id: customer.id,
    });
    if (orderError) {
      if (orderError.code === "P0002") {
        res.status(404).json({ error: "Diese Veranstaltung wurde nicht gefunden." });
        return;
      }
      if (["22023", "23503", "23514"].includes(orderError.code ?? "")) {
        res.status(400).json({ error: orderError.message });
        return;
      }
      if (orderError.code === "42501") {
        res.status(403).json({ error: "Bestellungen sind für dieses Gerät nicht möglich." });
        return;
      }
      throw cloudError(orderError);
    }
    res.status(201).json({ order: publicOrder(data as Order), customerNumber: String(customer.id).padStart(5, "0") });
    return;
  }
  const table = db.prepare("SELECT id FROM tables WHERE event_id = ? AND id = ? AND active = 1").get(event.id, parsed.data.tableId);
  if (!table) {
    res.status(400).json({ error: "Dieser Tisch ist nicht verfügbar." });
    return;
  }
  const productById = db.prepare("SELECT id, name, price_cents FROM products WHERE event_id = ? AND id = ? AND available = 1");
  const items = parsed.data.items.map((item) => {
    const product = productById.get(event.id, item.productId) as Product | undefined;
    return product ? { ...item, product } : null;
  });
  if (items.some((item) => item === null)) {
    res.status(400).json({ error: "Ein Produkt ist inzwischen nicht mehr verfügbar. Bitte lade die Karte neu." });
    return;
  }
  const validItems = items.filter((item): item is NonNullable<typeof item> => item !== null);
  const total = validItems.reduce((sum, item) => sum + item.product.price_cents * item.quantity, 0);
  if (total > 1000000) {
    res.status(400).json({ error: "Die Bestellung ist zu groß. Bitte teile sie auf." });
    return;
  }
  const customer = await getOrCreateCustomer(req, res);
  if (customer.banned) {
    res.status(403).json({ error: "Bestellungen sind für dieses Gerät nicht möglich." });
    return;
  }
  const id = randomUUID();
  const createOrder = db.transaction(() => {
    const latestCustomer = db.prepare("SELECT banned FROM customers WHERE id = ?").get(customer.id) as { banned: number } | undefined;
    if (!latestCustomer || latestCustomer.banned) throw new Error("CUSTOMER_BLOCKED");
    db.prepare("INSERT INTO orders (id, event_id, table_id, total_cents, customer_id) VALUES (?, ?, ?, ?, ?)")
      .run(id, event.id, parsed.data.tableId, total, customer.id);
    const addItem = db.prepare("INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price_cents, note) VALUES (?, ?, ?, ?, ?, ?)");
    for (const item of validItems) {
      addItem.run(id, item.product.id, item.product.name, item.quantity, item.product.price_cents, item.note);
    }
  });
  try {
    createOrder();
  } catch (error) {
    if (error instanceof Error && error.message === "CUSTOMER_BLOCKED") {
      res.status(403).json({ error: "Bestellungen sind für dieses Gerät nicht möglich." });
      return;
    }
    throw error;
  }
  const order = await getOrder(id);
  if (!order) throw new Error("Die Bestellung wurde angelegt, konnte aber nicht geladen werden.");
  res.status(201).json({ order: publicOrder(order), customerNumber: String(customer.id).padStart(5, "0") });
});

app.get("/api/customer/receipts", async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  const customerNumber = z.string().regex(/^\d{1,12}$/).safeParse(req.query.customerNumber);
  if (!customerNumber.success) {
    res.status(400).json({ error: "Bitte gib deine Kundennummer ein." });
    return;
  }
  const customer = await getCustomerForCurrentDevice(req);
  const requestedId = Number(customerNumber.data);
  if (!customer || customer.id !== requestedId) {
    res.status(404).json({ error: "Für dieses Gerät wurde keine passende Kundenakte gefunden." });
    return;
  }
  if (supabase) {
    const { data: orders, error } = await supabase.from("tisch_orders")
      .select("id, event_id, table_id, status, total_cents, tip_cents, created_at, paid_at, tisch_events(name)")
      .eq("customer_id", customer.id).eq("status", "paid").is("canceled_at", null).order("paid_at", { ascending: false });
    if (error) throw cloudError(error);
    const orderIds = (orders ?? []).map((order) => order.id as string);
    const { data: items, error: itemsError } = orderIds.length
      ? await supabase.from("tisch_order_items").select("order_id, product_name, quantity, unit_price_cents, note").in("order_id", orderIds).order("id")
      : { data: [], error: null };
    if (itemsError) throw cloudError(itemsError);
    const receipts = (orders ?? []).map((order) => ({
      ...order,
      venue_name: (() => {
        const venue = order.tisch_events as { name: string } | { name: string }[] | null;
        return (Array.isArray(venue) ? venue[0]?.name : venue?.name) ?? "Veranstaltung";
      })(),
      items: (items ?? []).filter((item) => item.order_id === order.id)
        .map(({ product_name, quantity, unit_price_cents, note }) => ({ product_name, quantity, unit_price_cents, note })),
    }));
    res.json({ customerNumber: String(customer.id).padStart(5, "0"), receipts });
    return;
  }
  const orders = db.prepare(`
    SELECT orders.id, orders.event_id, orders.table_id, orders.status, orders.total_cents,
      orders.tip_cents, orders.created_at, orders.paid_at, events.name AS venue_name
    FROM orders JOIN events ON events.id = orders.event_id
    WHERE orders.customer_id = ? AND orders.status = 'paid' AND orders.canceled_at IS NULL
    ORDER BY orders.paid_at DESC
  `).all(customer.id) as Array<Omit<Order, "items"> & { venue_name: string }>;
  const getItems = db.prepare("SELECT product_name, quantity, unit_price_cents, note FROM order_items WHERE order_id = ? ORDER BY id");
  res.json({
    customerNumber: String(customer.id).padStart(5, "0"),
    receipts: orders.map((order) => ({ ...order, items: getItems.all(order.id) })),
  });
});

app.get("/api/events/:slug/orders/:id", async (req, res) => {
  const slug = pathParam(req, "slug");
  const id = pathParam(req, "id");
  const event = slug
    ? supabase ? await cloudEvent(slug) : db.prepare("SELECT id FROM events WHERE slug = ?").get(slug) as { id: number } | undefined
    : undefined;
  if (!event || !id) {
    res.status(404).json({ error: "Bestellung nicht gefunden." });
    return;
  }
  const order = supabase ? await cloudOrder(id, event.id) : await getOrder(id);
  if (!order || order.event_id !== event.id) {
    res.status(404).json({ error: "Bestellung nicht gefunden." });
    return;
  }
  res.json({ order: publicOrder(order) });
});

app.post("/api/staff/login", async (req, res) => {
  const ip = req.ip ?? "unknown";
  const attempts = failedLogins.get(ip);
  if (attempts && attempts.resetAt > Date.now() && attempts.count >= 8) {
    res.status(429).json({ error: "Zu viele Anmeldeversuche. Bitte warte 15 Minuten." });
    return;
  }
  const credentials = z.object({
    username: z.string().trim().min(3).max(64),
    password: z.string().min(12).max(128),
  }).safeParse(req.body);
  const expectedUser = process.env.ADMIN_USERNAME;
  const [saltHex, hashHex] = (process.env.ADMIN_PASSWORD_HASH ?? "").split(":");
  if (!expectedUser || !saltHex || !hashHex) {
    res.status(503).json({ error: "Der Administratorzugang ist noch nicht eingerichtet. Bitte npm run setup:admin ausführen." });
    return;
  }
  const configuredAdminHash = /^[a-f0-9]{32}$/i.test(saltHex) && /^[a-f0-9]{128}$/i.test(hashHex)
    ? `${saltHex}:${hashHex}`
    : "";
  let username = "";
  let role: StaffUser["role"] = "staff";
  let authenticated = false;
  if (credentials.success) {
    username = credentials.data.username;
    const configuredAdmin = username === expectedUser && verifyPassword(credentials.data.password, configuredAdminHash);
    let storedUser: { username: string; password_hash: string; role: "admin" | "staff"; active: boolean; role_id: string | null } | undefined;
    if (supabase) {
      const { data, error } = await supabase.from("tisch_staff_users")
        .select("username, password_hash, role, role_id, active").eq("username", username).maybeSingle();
      if (error) throw cloudError(error);
      storedUser = data as typeof storedUser;
    } else {
      const row = db.prepare("SELECT username, password_hash, role, role_id, active FROM staff_users WHERE username = ?").get(username) as
        { username: string; password_hash: string; role: "admin" | "staff"; role_id: string | null; active: number } | undefined;
      storedUser = row && { ...row, active: Boolean(row.active) };
    }
    if (configuredAdmin) {
      if (supabase) {
        const { error } = await supabase.from("tisch_staff_users").upsert({
          username, password_hash: configuredAdminHash, role: "admin", role_id: "administrator", active: true,
        }, { onConflict: "username" });
        if (error) throw cloudError(error);
      } else {
        db.prepare(`
          INSERT INTO staff_users (username, password_hash, role, role_id, active) VALUES (?, ?, 'admin', 'administrator', 1)
          ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash, role = 'admin', role_id = 'administrator', active = 1
        `).run(username, configuredAdminHash);
      }
      authenticated = true;
    } else if (storedUser?.active && verifyPassword(credentials.data.password, storedUser.password_hash)) {
      role = storedUser.role;
      authenticated = true;
    }
  }
  if (!authenticated) {
    const nextCount = attempts && attempts.resetAt > Date.now() ? attempts.count + 1 : 1;
    failedLogins.set(ip, { count: nextCount, resetAt: Date.now() + 15 * 60 * 1000 });
    res.status(401).json({ error: "Benutzername oder Passwort stimmen nicht." });
    return;
  }
  failedLogins.delete(ip);
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  if (username === expectedUser) role = "admin";
  const roleId = username === expectedUser ? "administrator" : await (async () => {
    if (supabase) {
      const { data, error } = await supabase.from("tisch_staff_users").select("role_id, role").eq("username", username).single();
      if (error) throw cloudError(error);
      return data.role_id ?? (data.role === "admin" ? "administrator" : "personal");
    }
    const user = db.prepare("SELECT role_id, role FROM staff_users WHERE username = ?").get(username) as { role_id: string | null; role: "admin" | "staff" };
    return user.role_id ?? (user.role === "admin" ? "administrator" : "personal");
  })();
  const sessionRole = await (async () => {
    if (supabase) {
      const { data, error } = await supabase.from("tisch_staff_roles").select("session_minutes").eq("id", roleId).single();
      if (error) throw cloudError(error);
      return data.session_minutes as number;
    }
    const data = db.prepare("SELECT session_minutes FROM staff_roles WHERE id = ?").get(roleId) as { session_minutes: number } | undefined;
    return data?.session_minutes ?? fallbackSessionMinutes;
  })();
  const sessionDurationMs = sessionRole * 60 * 1000;
  if (supabase) {
    const { error: cleanupError } = await supabase.from("tisch_staff_sessions").delete().lte("expires_at", new Date().toISOString());
    if (cleanupError) throw cloudError(cleanupError);
    const { error } = await supabase.from("tisch_staff_sessions").insert({
      token_hash: tokenHash,
      user_id: username,
      expires_at: new Date(Date.now() + sessionDurationMs).toISOString(),
    });
    if (error) throw cloudError(error);
  } else {
    db.prepare("DELETE FROM staff_sessions WHERE expires_at <= datetime('now')").run();
    db.prepare("INSERT INTO staff_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, datetime('now'), datetime('now', ?))")
      .run(tokenHash, username, `+${sessionRole} minutes`);
  }
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${sessionCookie}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${sessionDurationMs / 1000}${secure}`);
  res.json({ ok: true, user: { username, role, roleId, sessionMinutes: sessionRole } });
});

app.post("/api/staff/logout", staffOnly, async (_req, res) => {
  if (supabase) {
    const { error } = await supabase.from("tisch_staff_sessions").delete().eq("token_hash", res.locals.sessionTokenHash);
    if (error) throw cloudError(error);
  } else {
    db.prepare("DELETE FROM staff_sessions WHERE token_hash = ?").run(res.locals.sessionTokenHash);
  }
  res.setHeader("Set-Cookie", `${sessionCookie}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
  res.json({ ok: true });
});

app.get("/api/staff/me", staffOnly, (_req, res) => {
  res.json({ user: res.locals.staffUser });
});

app.get("/api/staff/roles", staffOnly, requireOnePermission("roles.manage", "users.manage"), async (_req, res) => {
  const roles = supabase
    ? await supabase.from("tisch_staff_roles").select("id, name, permissions, session_minutes, is_admin, created_at").order("created_at")
      .then(({ data, error }) => {
        if (error) throw cloudError(error);
        return data ?? [];
      })
    : db.prepare("SELECT id, name, permissions, session_minutes, is_admin, created_at FROM staff_roles ORDER BY created_at").all()
      .map((role) => {
        const row = role as { id: string; name: string; permissions: string; session_minutes: number; is_admin: number; created_at: string };
        return { ...row, permissions: JSON.parse(row.permissions) as Permission[], is_admin: Boolean(row.is_admin) };
      });
  res.json({ roles });
});

app.post("/api/staff/roles", staffOnly, requirePermission("roles.manage"), async (req, res) => {
  const body = z.object({
    name: z.string().trim().min(2).max(64),
    permissions: z.array(z.enum(permissionKeys)).max(permissionKeys.length),
    sessionMinutes: z.number().int().min(10).max(10080),
  }).safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Rollenname, Rechte oder Sitzungsdauer sind ungültig." });
    return;
  }
  const id = `role-${randomUUID()}`;
  if (supabase) {
    const { data, error } = await supabase.from("tisch_staff_roles").insert({
      id, name: body.data.name, permissions: [...new Set(body.data.permissions)],
      session_minutes: body.data.sessionMinutes, is_admin: false,
    }).select("id, name, permissions, session_minutes, is_admin, created_at").single();
    if (error?.code === "23505") {
      res.status(409).json({ error: "Es gibt bereits eine Rolle mit diesem Namen." });
      return;
    }
    if (error) throw cloudError(error);
    res.status(201).json({ role: data });
    return;
  }
  try {
    db.prepare("INSERT INTO staff_roles (id, name, permissions, session_minutes) VALUES (?, ?, ?, ?)")
      .run(id, body.data.name, JSON.stringify([...new Set(body.data.permissions)]), body.data.sessionMinutes);
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) {
      res.status(409).json({ error: "Es gibt bereits eine Rolle mit diesem Namen." });
      return;
    }
    throw error;
  }
  res.status(201).json({
    role: { id, name: body.data.name, permissions: [...new Set(body.data.permissions)], session_minutes: body.data.sessionMinutes, is_admin: false },
  });
});

app.patch("/api/staff/roles/:id", staffOnly, requirePermission("roles.manage"), async (req, res) => {
  const id = pathParam(req, "id");
  const body = z.object({
    name: z.string().trim().min(2).max(64),
    permissions: z.array(z.enum(permissionKeys)).max(permissionKeys.length),
    sessionMinutes: z.number().int().min(10).max(10080),
  }).safeParse(req.body);
  if (!id || !body.success) {
    res.status(400).json({ error: "Rollenname, Rechte oder Sitzungsdauer sind ungültig." });
    return;
  }
  if (id === "administrator" && (
    body.data.name !== "Administrator"
    || new Set(body.data.permissions).size !== permissionKeys.length
    || permissionKeys.some((permission) => !body.data.permissions.includes(permission))
  )) {
    res.status(400).json({ error: "Name und Rechte der Administratorrolle sind fest geschützt; nur die Sitzungsdauer ist änderbar." });
    return;
  }
  if (id === "administrator" && !(res.locals.staffUser as StaffUser).isAdmin) {
    res.status(403).json({ error: "Nur Administratoren können diese Sitzungsdauer ändern." });
    return;
  }
  if (supabase) {
    const { data, error } = await supabase.from("tisch_staff_roles")
      .update({ name: body.data.name, permissions: [...new Set(body.data.permissions)], session_minutes: body.data.sessionMinutes })
      .eq("id", id).select("id, name, permissions, session_minutes, is_admin").maybeSingle();
    if (error?.code === "23505") {
      res.status(409).json({ error: "Es gibt bereits eine Rolle mit diesem Namen." });
      return;
    }
    if (error) throw cloudError(error);
    if (!data) {
      res.status(404).json({ error: "Rolle nicht gefunden." });
      return;
    }
    res.json({ role: data });
    return;
  }
  try {
    const result = db.prepare("UPDATE staff_roles SET name = ?, permissions = ?, session_minutes = ? WHERE id = ?")
      .run(body.data.name, JSON.stringify([...new Set(body.data.permissions)]), body.data.sessionMinutes, id);
    if (!result.changes) {
      res.status(404).json({ error: "Rolle nicht gefunden." });
      return;
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) {
      res.status(409).json({ error: "Es gibt bereits eine Rolle mit diesem Namen." });
      return;
    }
    throw error;
  }
  res.json({ role: db.prepare("SELECT id, name, permissions, session_minutes, is_admin FROM staff_roles WHERE id = ?").get(id) });
});

app.get("/api/staff/users", staffOnly, requirePermission("users.manage"), async (_req, res) => {
  if (supabase) {
    const { data, error } = await supabase.from("tisch_staff_users")
      .select("username, role, role_id, active, created_at").order("created_at");
    if (error) throw cloudError(error);
    res.json({ users: data });
    return;
  }
  res.json({
    users: db.prepare("SELECT username, role, role_id, active, created_at FROM staff_users ORDER BY created_at").all()
      .map((user) => ({ ...user as object, active: Boolean((user as { active: number }).active) })),
  });
});

app.post("/api/staff/users", staffOnly, requirePermission("users.manage"), async (req, res) => {
  const body = z.object({
    username: z.string().trim().regex(/^[a-zA-Z0-9._-]{3,64}$/),
    password: z.string().min(12).max(128),
    roleId: z.string().min(3).max(64),
  }).safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Benutzername, Passwort oder Rolle sind ungültig. Passwörter brauchen mindestens 12 Zeichen." });
    return;
  }
  const chosenRole = supabase
    ? await supabase.from("tisch_staff_roles").select("id, is_admin").eq("id", body.data.roleId).maybeSingle().then(({ data, error }) => {
      if (error) throw cloudError(error);
      return data as { id: string; is_admin: boolean } | null;
    })
    : db.prepare("SELECT id, is_admin FROM staff_roles WHERE id = ?").get(body.data.roleId) as { id: string; is_admin: number } | undefined;
  const currentUser = res.locals.staffUser as StaffUser;
  if (!chosenRole || Boolean(chosenRole.is_admin) && !currentUser.isAdmin) {
    res.status(400).json({ error: "Bitte wähle eine Rolle, die du zuweisen darfst." });
    return;
  }
  const passwordHash = makePasswordHash(body.data.password);
  const legacyRole = chosenRole.is_admin ? "admin" : "staff";
  if (supabase) {
    const { data, error } = await supabase.from("tisch_staff_users").insert({
      username: body.data.username, password_hash: passwordHash, role: legacyRole, role_id: body.data.roleId,
    }).select("username, role, role_id, active, created_at").single();
    if (error?.code === "23505") {
      res.status(409).json({ error: "Diesen Benutzernamen gibt es bereits." });
      return;
    }
    if (error) throw cloudError(error);
    res.status(201).json({ user: data });
    return;
  }
  try {
    const result = db.prepare("INSERT INTO staff_users (username, password_hash, role, role_id) VALUES (?, ?, ?, ?)")
      .run(body.data.username, passwordHash, legacyRole, body.data.roleId);
    if (!result.changes) throw new Error("Der Benutzer konnte nicht angelegt werden.");
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) {
      res.status(409).json({ error: "Diesen Benutzernamen gibt es bereits." });
      return;
    }
    throw error;
  }
  res.status(201).json({ user: { username: body.data.username, role: legacyRole, role_id: body.data.roleId, active: true } });
});

app.patch("/api/staff/users/:username", staffOnly, requirePermission("users.manage"), async (req, res) => {
  const username = pathParam(req, "username");
  const body = z.object({ active: z.boolean().optional(), roleId: z.string().min(3).max(64).optional() }).refine((value) => value.active !== undefined || value.roleId !== undefined).safeParse(req.body);
  if (!username || !body.success) {
    res.status(400).json({ error: "Ungültige Änderung." });
    return;
  }
  const currentUser = res.locals.staffUser as StaffUser;
  const isConfiguredAdmin = username === process.env.ADMIN_USERNAME;
  if (username === currentUser.username && (body.data.active === false || body.data.roleId !== undefined)
    || isConfiguredAdmin && (body.data.active === false || body.data.roleId !== undefined)) {
    res.status(400).json({ error: "Das aktuell angemeldete Administratorkonto kann nicht gesperrt werden." });
    return;
  }
  if (body.data.active === false && !currentUser.isAdmin) {
    const target = supabase
      ? await supabase.from("tisch_staff_users").select("role, role_id").eq("username", username).maybeSingle()
        .then(({ data, error }) => {
          if (error) throw cloudError(error);
          return data as { role: "admin" | "staff"; role_id: string | null } | null;
        })
      : db.prepare("SELECT role, role_id FROM staff_users WHERE username = ?").get(username) as { role: "admin" | "staff"; role_id: string | null } | undefined;
    const protectedRole = target?.role_id
      ? supabase
        ? await supabase.from("tisch_staff_roles").select("is_admin").eq("id", target.role_id).maybeSingle()
          .then(({ data, error }) => {
            if (error) throw cloudError(error);
            return Boolean(data?.is_admin);
          })
        : Boolean((db.prepare("SELECT is_admin FROM staff_roles WHERE id = ?").get(target.role_id) as { is_admin: number } | undefined)?.is_admin)
      : target?.role === "admin";
    if (protectedRole) {
      res.status(403).json({ error: "Nur Administratoren können Administratorkonten sperren." });
      return;
    }
  }
  let roleToAssign: { id: string; is_admin: boolean | number } | undefined;
  if (body.data.roleId) {
    roleToAssign = supabase
      ? await supabase.from("tisch_staff_roles").select("id, is_admin").eq("id", body.data.roleId).maybeSingle()
        .then(({ data, error }) => {
          if (error) throw cloudError(error);
          return data as { id: string; is_admin: boolean } | null;
        }) ?? undefined
      : db.prepare("SELECT id, is_admin FROM staff_roles WHERE id = ?").get(body.data.roleId) as { id: string; is_admin: number } | undefined;
    if (!roleToAssign || Boolean(roleToAssign.is_admin) && !currentUser.isAdmin || username === currentUser.username) {
      res.status(400).json({ error: "Diese Rolle kann dem Benutzer nicht zugewiesen werden." });
      return;
    }
  }
  const updates = {
    ...(body.data.active === undefined ? {} : { active: body.data.active }),
    ...(roleToAssign ? { role_id: roleToAssign.id, role: roleToAssign.is_admin ? "admin" as const : "staff" as const } : {}),
  };
  if (supabase) {
    const { data, error } = await supabase.from("tisch_staff_users")
      .update(updates).eq("username", username).select("username, role, role_id, active").maybeSingle();
    if (error) throw cloudError(error);
    if (!data) {
      res.status(404).json({ error: "Benutzer nicht gefunden." });
      return;
    }
    res.json({ user: data });
    return;
  }
  const result = db.prepare(`
    UPDATE staff_users
    SET active = coalesce(?, active), role = coalesce(?, role), role_id = coalesce(?, role_id)
    WHERE username = ?
  `).run(body.data.active === undefined ? null : Number(body.data.active), roleToAssign ? (roleToAssign.is_admin ? "admin" : "staff") : null, roleToAssign?.id ?? null, username);
  if (!result.changes) {
    res.status(404).json({ error: "Benutzer nicht gefunden." });
    return;
  }
  res.json({ user: db.prepare("SELECT username, role, role_id, active FROM staff_users WHERE username = ?")
    .get(username) });
});

app.get("/api/staff/events", staffOnly, async (_req, res) => {
  if (supabase) {
    const { data, error } = await supabase.from("tisch_events").select("id, name, slug, created_at").order("id", { ascending: false });
    if (error) throw cloudError(error);
    res.json({ events: data });
    return;
  }
  res.json({ events: db.prepare("SELECT id, name, slug, created_at FROM events ORDER BY id DESC").all() });
});

app.post("/api/staff/events", staffOnly, requirePermission("settings.manage"), async (req, res) => {
  const body = z.object({ name: z.string().trim().min(2).max(80) }).safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Der Veranstaltungsname muss mindestens 2 Zeichen haben." });
    return;
  }
  const slugBase = body.data.name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "veranstaltung";
  const slug = `${slugBase}-${randomBytes(3).toString("hex")}`;
  if (supabase) {
    const { data, error } = await supabase.rpc("tisch_create_event", { p_name: body.data.name, p_slug: slug });
    if (error) throw cloudError(error);
    res.status(201).json({ event: data as EventRecord });
    return;
  }
  const create = db.transaction(() => {
    const result = db.prepare("INSERT INTO events (name, slug) VALUES (?, ?)").run(body.data.name, slug);
    const id = Number(result.lastInsertRowid);
    addEventDefaults(id);
    return db.prepare("SELECT id, name, slug, created_at FROM events WHERE id = ?").get(id) as EventRecord;
  });
  res.status(201).json({ event: create() });
});

app.patch("/api/staff/events/:id", staffOnly, requirePermission("settings.manage"), async (req, res) => {
  const id = Number(pathParam(req, "id"));
  const body = z.object({
    name: z.string().trim().min(2).max(80),
    welcomeText: z.string().trim().min(1).max(180),
    accentColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  }).safeParse(req.body);
  if (!Number.isSafeInteger(id) || id < 1 || !body.success) {
    res.status(400).json({ error: "Bitte prüfe Name, Begrüßungstext und Farbe." });
    return;
  }
  if (supabase) {
    const { data, error } = await supabase.from("tisch_events").update({
      name: body.data.name,
      welcome_text: body.data.welcomeText,
      accent_color: body.data.accentColor,
    }).eq("id", id).select("id, name, slug, welcome_text, accent_color, created_at").maybeSingle();
    if (error) throw cloudError(error);
    if (!data) {
      res.status(404).json({ error: "Veranstaltung nicht gefunden." });
      return;
    }
    res.json({ event: data });
    return;
  }
  const result = db.prepare("UPDATE events SET name = ?, welcome_text = ?, accent_color = ? WHERE id = ?")
    .run(body.data.name, body.data.welcomeText, body.data.accentColor, id);
  if (!result.changes) {
    res.status(404).json({ error: "Veranstaltung nicht gefunden." });
    return;
  }
  res.json({ event: db.prepare("SELECT id, name, slug, welcome_text, accent_color, created_at FROM events WHERE id = ?").get(id) });
});

app.get("/api/staff/orders", staffOnly, requireOnePermission("orders.view", "kitchen.view", "cash.view"), activeEvent, async (_req, res) => {
  const eventId = res.locals.eventId as number;
  if (supabase) {
    const { data, error } = await supabase.from("tisch_orders")
      .select("*")
      .eq("event_id", eventId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw cloudError(error);
    const eventOrders = await Promise.all((data ?? []).map((order) => cloudOrder(order.id, eventId)));
    const orders = eventOrders.filter((order): order is Order => order !== undefined)
      .sort((a, b) => {
        const statusOrder = { new: 0, preparing: 1, ready: 2, paid: 3 };
        return statusOrder[a.status as keyof typeof statusOrder] - statusOrder[b.status as keyof typeof statusOrder]
          || b.created_at.localeCompare(a.created_at);
      });
    res.json({ orders });
    return;
  }
  const rows = db.prepare(`
    SELECT orders.*, tables.name AS table_name
    FROM orders JOIN tables ON tables.id = orders.table_id
    WHERE orders.event_id = ?
    ORDER BY CASE status WHEN 'new' THEN 0 WHEN 'preparing' THEN 1 WHEN 'ready' THEN 2 ELSE 3 END, orders.created_at DESC
    LIMIT 200
  `).all(eventId) as Array<Omit<Order, "items">>;
  res.json({ orders: rows.map((order) => ({ ...order, items: db.prepare("SELECT product_name, quantity, unit_price_cents, note FROM order_items WHERE order_id = ? ORDER BY id").all(order.id) })) });
});

app.get("/api/staff/orders/history", staffOnly, requirePermission("receipts.view"), activeEvent, async (_req, res) => {
  const eventId = res.locals.eventId as number;
  if (supabase) {
    const { data, error } = await supabase.from("tisch_orders").select("id")
      .eq("event_id", eventId).order("created_at", { ascending: false }).limit(200);
    if (error) throw cloudError(error);
    const orders = await Promise.all((data ?? []).map(({ id }) => cloudOrder(id, eventId)));
    res.json({ orders: orders.filter((order): order is Order => order !== undefined) });
    return;
  }
  const rows = db.prepare(`
    SELECT orders.*, tables.name AS table_name
    FROM orders JOIN tables ON tables.id = orders.table_id
    WHERE orders.event_id = ? ORDER BY orders.created_at DESC LIMIT 200
  `).all(eventId) as Array<Omit<Order, "items">>;
  res.json({ orders: rows.map((order) => ({
    ...order,
    items: db.prepare("SELECT product_name, quantity, unit_price_cents, note FROM order_items WHERE order_id = ? ORDER BY id").all(order.id),
  })) });
});

app.post("/api/staff/orders/:id/cancel", staffOnly, requirePermission("receipts.cancel"), activeEvent, async (req, res) => {
  const eventId = res.locals.eventId as number;
  const id = pathParam(req, "id");
  const body = z.object({ reason: z.string().trim().min(3).max(240) }).safeParse(req.body);
  if (!id || !body.success) {
    res.status(400).json({ error: "Bitte einen Stornogrund mit mindestens 3 Zeichen angeben." });
    return;
  }
  const canceledBy = (res.locals.staffUser as StaffUser).username;
  if (supabase) {
    const { data, error } = await supabase.from("tisch_orders").update({
      canceled_at: new Date().toISOString(),
      cancellation_reason: body.data.reason,
      canceled_by: canceledBy,
    }).eq("id", id).eq("event_id", eventId).is("canceled_at", null).select("id").maybeSingle();
    if (error) throw cloudError(error);
    if (!data) {
      res.status(409).json({ error: "Bestellung nicht gefunden oder bereits storniert." });
      return;
    }
    res.json({ order: await cloudOrder(id, eventId) });
    return;
  }
  const update = db.prepare(`
    UPDATE orders SET canceled_at = datetime('now'), cancellation_reason = ?, canceled_by = ?
    WHERE id = ? AND event_id = ? AND canceled_at IS NULL
  `).run(body.data.reason, canceledBy, id, eventId);
  if (!update.changes) {
    res.status(409).json({ error: "Bestellung nicht gefunden oder bereits storniert." });
    return;
  }
  res.json({ order: await getOrder(id) });
});

app.get("/api/staff/customers", staffOnly, requirePermission("customers.view"), async (req, res) => {
  const rawQuery = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const query = rawQuery && /^0+$/.test(rawQuery) ? "0" : rawQuery.replace(/^0+/, "");
  if (supabase) {
    let customersQuery = supabase.from("tisch_customers").select("id, banned, ban_reason, created_at")
      .order("id", { ascending: true }).limit(100);
    if (query) {
      const id = Number(query);
      if (!Number.isSafeInteger(id) || id < 1) {
        res.json({ customers: [] });
        return;
      }
      customersQuery = customersQuery.eq("id", id);
    }
    const { data, error } = await customersQuery;
    if (error) throw cloudError(error);
    const customers = data ?? [];
    const ids = customers.map((customer) => customer.id);
    const { data: orders, error: orderError } = ids.length
      ? await supabase.from("tisch_orders").select("id, customer_id, event_id, status, total_cents, created_at, canceled_at")
        .in("customer_id", ids).order("created_at", { ascending: false }).limit(500)
      : { data: [], error: null };
    if (orderError) throw cloudError(orderError);
    res.json({ customers: customers.map((customer) => ({
      ...customer,
      customer_number: String(customer.id).padStart(5, "0"),
      orders: (orders ?? []).filter((order) => order.customer_id === customer.id),
    })) });
    return;
  }
  const params: Array<string | number> = [];
  const where = query ? "WHERE customers.id = ?" : "";
  if (query) params.push(Number(query));
  const customers = db.prepare(`
    SELECT id, banned, ban_reason, created_at FROM customers ${where} ORDER BY id LIMIT 100
  `).all(...params) as Array<{ id: number; banned: number; ban_reason: string; created_at: string }>;
  res.json({ customers: customers.map((customer) => ({
    ...customer,
    banned: Boolean(customer.banned),
    customer_number: String(customer.id).padStart(5, "0"),
    orders: db.prepare(`
      SELECT id, customer_id, event_id, status, total_cents, created_at, canceled_at
      FROM orders WHERE customer_id = ? ORDER BY created_at DESC LIMIT 100
    `).all(customer.id),
  })) });
});

app.patch("/api/staff/customers/:id", staffOnly, requirePermission("customers.manage"), async (req, res) => {
  const id = Number(pathParam(req, "id"));
  const body = z.object({ banned: z.boolean(), reason: z.string().trim().max(240).default("") }).safeParse(req.body);
  if (!Number.isSafeInteger(id) || id < 1 || !body.success) {
    res.status(400).json({ error: "Ungültige Kundenänderung." });
    return;
  }
  if (supabase) {
    const { data, error } = await supabase.from("tisch_customers")
      .update({ banned: body.data.banned, ban_reason: body.data.reason })
      .eq("id", id).select("id, banned, ban_reason").maybeSingle();
    if (error) throw cloudError(error);
    if (!data) {
      res.status(404).json({ error: "Kundenakte nicht gefunden." });
      return;
    }
    res.json({ customer: { ...data, customer_number: String(data.id).padStart(5, "0") } });
    return;
  }
  const update = db.prepare("UPDATE customers SET banned = ?, ban_reason = ? WHERE id = ?")
    .run(Number(body.data.banned), body.data.reason, id);
  if (!update.changes) {
    res.status(404).json({ error: "Kundenakte nicht gefunden." });
    return;
  }
  res.json({
    customer: {
      id, banned: body.data.banned, ban_reason: body.data.reason,
      customer_number: String(id).padStart(5, "0"),
    },
  });
});

app.patch("/api/staff/orders/:id", staffOnly, requireOnePermission("orders.edit", "kitchen.edit", "cash.edit"), activeEvent, async (req, res) => {
  const eventId = res.locals.eventId as number;
  const id = pathParam(req, "id");
  if (!id) {
    res.status(400).json({ error: "Ungültige Bestellnummer." });
    return;
  }
  const body = z.object({
    status: z.enum(["new", "preparing", "ready", "paid"]),
    tipCents: z.number().int().min(0).max(100000).optional(),
  }).safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Ungültige Aktualisierung." });
    return;
  }
  const orderBeforeUpdate = supabase ? await cloudOrder(id, eventId) : await getOrder(id);
  if (!orderBeforeUpdate || orderBeforeUpdate.event_id !== eventId || orderBeforeUpdate.canceled_at) {
    res.status(404).json({ error: "Bestellung nicht gefunden." });
    return;
  }
  const allowedNextStatus: Partial<Record<Order["status"], Order["status"]>> = {
    new: "preparing",
    preparing: "ready",
    ready: "paid",
  };
  if (orderBeforeUpdate.status === "paid" || (
    orderBeforeUpdate.status !== body.data.status && allowedNextStatus[orderBeforeUpdate.status] !== body.data.status
  )) {
    res.status(409).json({ error: "Dieser Bestellstatus kann nicht geändert werden." });
    return;
  }
  const requiredPermission: Permission = body.data.status === "paid"
    ? "cash.edit"
    : body.data.status === "preparing" || body.data.status === "ready" ? "kitchen.edit" : "orders.edit";
  const staffUser = res.locals.staffUser as StaffUser;
  if (!staffUser.isAdmin && !staffUser.permissions.includes(requiredPermission)) {
    res.status(403).json({ error: "Für diese Bestelländerung fehlt dir die passende Berechtigung." });
    return;
  }
  if (supabase) {
    const update = await supabase.from("tisch_orders").update({
      status: body.data.status,
      ...(body.data.tipCents === undefined ? {} : { tip_cents: body.data.tipCents }),
      ...(body.data.status === "paid" ? { paid_at: new Date().toISOString() } : {}),
    }).eq("id", id).eq("event_id", eventId).is("canceled_at", null).select("id").maybeSingle();
    if (update.error) throw cloudError(update.error);
    if (!update.data) {
      res.status(404).json({ error: "Bestellung nicht gefunden." });
      return;
    }
    res.json({ order: await cloudOrder(id, eventId) });
    return;
  }
  const update = db.prepare(`
    UPDATE orders SET status = ?, tip_cents = COALESCE(?, tip_cents),
      paid_at = CASE WHEN ? = 'paid' THEN datetime('now') ELSE paid_at END
    WHERE id = ? AND event_id = ? AND canceled_at IS NULL
  `).run(body.data.status, body.data.tipCents ?? null, body.data.status, id, eventId);
  if (update.changes === 0) {
    res.status(404).json({ error: "Bestellung nicht gefunden." });
    return;
  }
  res.json({ order: await getOrder(id) });
});

app.get("/api/staff/finance", staffOnly, requirePermission("finance.view"), activeEvent, async (_req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  const eventId = res.locals.eventId as number;
  const entries = supabase
    ? await supabase.from("tisch_finance_entries").select("id, kind, amount_cents, description, entry_date, created_by, created_at")
      .eq("event_id", eventId).order("entry_date", { ascending: false }).order("id", { ascending: false }).limit(500)
      .then(({ data, error }) => {
        if (error) throw cloudError(error);
        return data ?? [];
      })
    : db.prepare("SELECT id, kind, amount_cents, description, entry_date, created_by, created_at FROM finance_entries WHERE event_id = ? ORDER BY entry_date DESC, id DESC LIMIT 500")
      .all(eventId) as Array<{ id: number; kind: "income" | "expense"; amount_cents: number; description: string; entry_date: string; created_by: string; created_at: string }>;
  const totals = supabase
    ? await supabase.rpc("tisch_finance_totals", { p_event_id: eventId }).then(({ data, error }) => {
      if (error) throw cloudError(error);
      const result = Array.isArray(data) ? data[0] : data;
      if (!result) throw new Error("Die Finanzsummen konnten nicht geladen werden.");
      return result as { paid_sales_cents: number; manual_income_cents: number; expenses_cents: number };
    })
    : db.prepare(`
      SELECT
        (SELECT coalesce(sum(total_cents + tip_cents), 0) FROM orders WHERE event_id = ? AND status = 'paid' AND canceled_at IS NULL) AS paid_sales_cents,
        (SELECT coalesce(sum(amount_cents), 0) FROM finance_entries WHERE event_id = ? AND kind = 'income') AS manual_income_cents,
        (SELECT coalesce(sum(amount_cents), 0) FROM finance_entries WHERE event_id = ? AND kind = 'expense') AS expenses_cents
    `).get(eventId, eventId, eventId) as { paid_sales_cents: number; manual_income_cents: number; expenses_cents: number };
  res.json({
    entries,
    paidSalesCents: Number(totals.paid_sales_cents),
    manualIncomeCents: Number(totals.manual_income_cents),
    expensesCents: Number(totals.expenses_cents),
    balanceCents: Number(totals.paid_sales_cents) + Number(totals.manual_income_cents) - Number(totals.expenses_cents),
  });
});

app.post("/api/staff/finance", staffOnly, requirePermission("finance.edit"), activeEvent, async (req, res) => {
  const body = z.object({
    kind: z.enum(["income", "expense"]),
    amountCents: z.number().int().min(1).max(100000000),
    description: z.string().trim().min(1).max(240),
    entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }).safeParse(req.body);
  const parsedDate = body.success ? new Date(`${body.data.entryDate}T00:00:00Z`) : null;
  if (!body.success || !parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== body.data.entryDate) {
    res.status(400).json({ error: "Bitte prüfe Art, Betrag, Beschreibung und Datum." });
    return;
  }
  const eventId = res.locals.eventId as number;
  const createdBy = (res.locals.staffUser as StaffUser).username;
  if (supabase) {
    const { data, error } = await supabase.from("tisch_finance_entries").insert({
      event_id: eventId, kind: body.data.kind, amount_cents: body.data.amountCents,
      description: body.data.description, entry_date: body.data.entryDate, created_by: createdBy,
    }).select("id, kind, amount_cents, description, entry_date, created_by, created_at").single();
    if (error) throw cloudError(error);
    res.status(201).json({ entry: data });
    return;
  }
  const result = db.prepare(`
    INSERT INTO finance_entries (event_id, kind, amount_cents, description, entry_date, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(eventId, body.data.kind, body.data.amountCents, body.data.description, body.data.entryDate, createdBy);
  res.status(201).json({
    entry: db.prepare("SELECT id, kind, amount_cents, description, entry_date, created_by, created_at FROM finance_entries WHERE id = ?")
      .get(result.lastInsertRowid),
  });
});

app.get("/api/staff/products", staffOnly, requireOnePermission("menu.view", "menu.edit"), activeEvent, async (_req, res) => {
  if (supabase) {
    const { data, error } = await supabase.from("tisch_products").select("*").eq("event_id", res.locals.eventId).order("category").order("name");
    if (error) throw cloudError(error);
    res.json({ products: data });
    return;
  }
  res.json({ products: db.prepare("SELECT * FROM products WHERE event_id = ? ORDER BY category, name").all(res.locals.eventId) });
});

app.post("/api/staff/products", staffOnly, requirePermission("menu.edit"), activeEvent, async (req, res) => {
  const body = productInput.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Bitte prüfe Name, Kategorie und Preis." });
    return;
  }
  if (supabase) {
    const { data, error } = await supabase.from("tisch_products").insert({
      event_id: res.locals.eventId,
      name: body.data.name,
      description: body.data.description,
      category: body.data.category,
      price_cents: body.data.priceCents,
      available: body.data.available,
    }).select("*").single();
    if (error) throw cloudError(error);
    res.status(201).json({ product: data });
    return;
  }
  const result = db.prepare("INSERT INTO products (event_id, name, description, category, price_cents, available) VALUES (?, ?, ?, ?, ?, ?)")
    .run(res.locals.eventId, body.data.name, body.data.description, body.data.category, body.data.priceCents, Number(body.data.available));
  res.status(201).json({ product: db.prepare("SELECT * FROM products WHERE id = ?").get(result.lastInsertRowid) });
});

app.patch("/api/staff/products/:id", staffOnly, requirePermission("menu.edit"), activeEvent, async (req, res) => {
  const id = pathParam(req, "id");
  if (!id) {
    res.status(400).json({ error: "Ungültige Produktnummer." });
    return;
  }
  const body = productInput.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Bitte prüfe Name, Kategorie und Preis." });
    return;
  }
  if (supabase) {
    const { data, error } = await supabase.from("tisch_products").update({
      name: body.data.name,
      description: body.data.description,
      category: body.data.category,
      price_cents: body.data.priceCents,
      available: body.data.available,
    }).eq("id", id).eq("event_id", res.locals.eventId).select("*").maybeSingle();
    if (error) throw cloudError(error);
    if (!data) {
      res.status(404).json({ error: "Produkt nicht gefunden." });
      return;
    }
    res.json({ product: data });
    return;
  }
  const result = db.prepare("UPDATE products SET name = ?, description = ?, category = ?, price_cents = ?, available = ? WHERE id = ? AND event_id = ?")
    .run(body.data.name, body.data.description, body.data.category, body.data.priceCents, Number(body.data.available), id, res.locals.eventId);
  if (result.changes === 0) {
    res.status(404).json({ error: "Produkt nicht gefunden." });
    return;
  }
  res.json({ product: db.prepare("SELECT * FROM products WHERE id = ?").get(id) });
});

app.get("/api/staff/tables", staffOnly, requireOnePermission("tables.view", "tables.edit"), activeEvent, async (_req, res) => {
  if (supabase) {
    const { data, error } = await supabase.from("tisch_tables").select("*").eq("event_id", res.locals.eventId).order("id");
    if (error) throw cloudError(error);
    res.json({ tables: data });
    return;
  }
  res.json({ tables: db.prepare("SELECT * FROM tables WHERE event_id = ? ORDER BY id").all(res.locals.eventId) });
});

app.post("/api/staff/tables", staffOnly, requirePermission("tables.edit"), activeEvent, async (req, res) => {
  const body = z.object({ name: z.string().trim().min(1).max(40) }).safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Bitte einen Tischnamen eingeben." });
    return;
  }
  if (supabase) {
    const { data, error } = await supabase.from("tisch_tables").insert({
      event_id: res.locals.eventId,
      name: body.data.name,
    }).select("*").single();
    if (error) {
      if (error.code === "23505") {
        res.status(409).json({ error: "Diesen Tischnamen gibt es bereits." });
        return;
      }
      throw cloudError(error);
    }
    res.status(201).json({ table: data });
    return;
  }
  try {
    const result = db.prepare("INSERT INTO tables (event_id, name) VALUES (?, ?)").run(res.locals.eventId, body.data.name);
    res.status(201).json({ table: db.prepare("SELECT * FROM tables WHERE id = ?").get(result.lastInsertRowid) });
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) {
      res.status(409).json({ error: "Diesen Tischnamen gibt es bereits." });
      return;
    }
    throw error;
  }
});

app.patch("/api/staff/tables/:id", staffOnly, requirePermission("tables.edit"), activeEvent, async (req, res) => {
  const id = pathParam(req, "id");
  if (!id) {
    res.status(400).json({ error: "Ungültige Tischnummer." });
    return;
  }
  const body = z.object({ name: z.string().trim().min(1).max(40), active: z.boolean() }).safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Bitte prüfe den Tischnamen." });
    return;
  }
  if (supabase) {
    const { data, error } = await supabase.from("tisch_tables").update({
      name: body.data.name,
      active: body.data.active,
    }).eq("id", id).eq("event_id", res.locals.eventId).select("*").maybeSingle();
    if (error) {
      if (error.code === "23505") {
        res.status(409).json({ error: "Diesen Tischnamen gibt es bereits." });
        return;
      }
      throw cloudError(error);
    }
    if (!data) {
      res.status(404).json({ error: "Tisch nicht gefunden." });
      return;
    }
    res.json({ table: data });
    return;
  }
  const result = db.prepare("UPDATE tables SET name = ?, active = ? WHERE id = ? AND event_id = ?").run(body.data.name, Number(body.data.active), id, res.locals.eventId);
  if (result.changes === 0) {
    res.status(404).json({ error: "Tisch nicht gefunden." });
    return;
  }
  res.json({ table: db.prepare("SELECT * FROM tables WHERE id = ?").get(id) });
});

const webRoot = resolve(process.cwd(), "public");
app.use(express.static(webRoot));
app.get(["/impressum", "/datenschutz"], (_req, res, next) => {
  res.sendFile(resolve(webRoot, "index.html"), (error) => {
    if (error) next(error);
  });
});
app.get("/e/:slug", (_req, res, next) => {
  res.sendFile(resolve(webRoot, "index.html"), (error) => {
    if (error) next(error);
  });
});
app.use((req, res, next) => {
  if (req.method !== "GET" || req.path.startsWith("/api/") || /\.[^/]+$/.test(req.path)) {
    next();
    return;
  }
  res.sendFile(resolve(webRoot, "index.html"), (error) => {
    if (error) next(error);
  });
});

app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(error);
  res.status(500).json({ error: "Es ist ein unerwarteter Fehler aufgetreten." });
});

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "127.0.0.1";
if (process.env.VERCEL !== "1") {
  app.listen(port, host, () => {
    console.log(`Tischzeit API läuft auf http://localhost:${port}`);
  });
}

export default app;
