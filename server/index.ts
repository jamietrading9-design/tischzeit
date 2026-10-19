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
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
db.prepare("INSERT OR IGNORE INTO events (id, name, slug) VALUES (1, 'Feuerwehrfest', 'feuerwehrfest')").run();

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
    expires_at TEXT NOT NULL
  );
`);
}

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
  items: Array<{ product_name: string; quantity: number; unit_price_cents: number; note: string }>;
};
type EventRecord = { id: number; name: string; slug: string; created_at: string };

const sessionCookie = "tischzeit_session";
const sessionDurationMs = 8 * 60 * 60 * 1000;
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
  const rawCookie = req.headers.cookie?.split("; ").find((part) => part.startsWith(`${sessionCookie}=`));
  const token = rawCookie?.slice(sessionCookie.length + 1);
  if (!token) {
    res.status(401).json({ error: "Bitte melde dich an." });
    return;
  }
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const session = supabase
    ? await supabase.from("tisch_staff_sessions").select("token_hash").eq("token_hash", tokenHash).gt("expires_at", new Date().toISOString()).maybeSingle().then(({ data, error }) => {
      if (error) throw cloudError(error);
      return data;
    })
    : db.prepare("SELECT token_hash FROM staff_sessions WHERE token_hash = ? AND expires_at > datetime('now')").get(tokenHash);
  if (!session) {
    res.setHeader("Set-Cookie", `${sessionCookie}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
    res.status(401).json({ error: "Deine Sitzung ist abgelaufen. Bitte melde dich erneut an." });
    return;
  }
  res.locals.sessionTokenHash = tokenHash;
  next();
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

app.get("/api/public/:slug", async (req, res) => {
  const slug = pathParam(req, "slug");
  const event = slug
    ? supabase ? await cloudEvent(slug) : db.prepare("SELECT id, name, slug FROM events WHERE slug = ?").get(slug) as EventRecord | undefined
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
  res.json({ venueName: event.name, eventSlug: event.slug, products, tables });
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
    const { data, error: orderError } = await supabase.rpc("tisch_place_order", {
      p_event_slug: event.slug,
      p_table_id: parsed.data.tableId,
      p_items: parsed.data.items,
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
      throw cloudError(orderError);
    }
    res.status(201).json({ order: data as Order });
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
  const id = randomUUID();
  const createOrder = db.transaction(() => {
    db.prepare("INSERT INTO orders (id, event_id, table_id, total_cents) VALUES (?, ?, ?, ?)").run(id, event.id, parsed.data.tableId, total);
    const addItem = db.prepare("INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price_cents, note) VALUES (?, ?, ?, ?, ?, ?)");
    for (const item of validItems) {
      addItem.run(id, item.product.id, item.product.name, item.quantity, item.product.price_cents, item.note);
    }
  });
  createOrder();
  res.status(201).json({ order: await getOrder(id) });
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
  res.json({ order });
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
  let passwordMatches = false;
  if (credentials.success && /^[a-f0-9]{32}$/i.test(saltHex) && /^[a-f0-9]{128}$/i.test(hashHex)) {
    const actual = scryptSync(credentials.data.password, Buffer.from(saltHex, "hex"), 64);
    const expected = Buffer.from(hashHex, "hex");
    passwordMatches = timingSafeEqual(actual, expected);
  }
  if (!credentials.success || credentials.data.username !== expectedUser || !passwordMatches) {
    const nextCount = attempts && attempts.resetAt > Date.now() ? attempts.count + 1 : 1;
    failedLogins.set(ip, { count: nextCount, resetAt: Date.now() + 15 * 60 * 1000 });
    res.status(401).json({ error: "Benutzername oder Passwort stimmen nicht." });
    return;
  }
  failedLogins.delete(ip);
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  if (supabase) {
    const { error: cleanupError } = await supabase.from("tisch_staff_sessions").delete().lte("expires_at", new Date().toISOString());
    if (cleanupError) throw cloudError(cleanupError);
    const { error } = await supabase.from("tisch_staff_sessions").insert({
      token_hash: tokenHash,
      expires_at: new Date(Date.now() + sessionDurationMs).toISOString(),
    });
    if (error) throw cloudError(error);
  } else {
    db.prepare("DELETE FROM staff_sessions WHERE expires_at <= datetime('now')").run();
    db.prepare("INSERT INTO staff_sessions (token_hash, expires_at) VALUES (?, datetime('now', '+8 hours'))").run(tokenHash);
  }
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${sessionCookie}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${sessionDurationMs / 1000}${secure}`);
  res.json({ ok: true });
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

app.get("/api/staff/events", staffOnly, async (_req, res) => {
  if (supabase) {
    const { data, error } = await supabase.from("tisch_events").select("id, name, slug, created_at").order("id", { ascending: false });
    if (error) throw cloudError(error);
    res.json({ events: data });
    return;
  }
  res.json({ events: db.prepare("SELECT id, name, slug, created_at FROM events ORDER BY id DESC").all() });
});

app.post("/api/staff/events", staffOnly, async (req, res) => {
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

app.get("/api/staff/orders", staffOnly, activeEvent, async (_req, res) => {
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

app.patch("/api/staff/orders/:id", staffOnly, activeEvent, async (req, res) => {
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
  if (supabase) {
    const update = await supabase.from("tisch_orders").update({
      status: body.data.status,
      ...(body.data.tipCents === undefined ? {} : { tip_cents: body.data.tipCents }),
      ...(body.data.status === "paid" ? { paid_at: new Date().toISOString() } : {}),
    }).eq("id", id).eq("event_id", eventId).select("id").maybeSingle();
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
    WHERE id = ? AND event_id = ?
  `).run(body.data.status, body.data.tipCents ?? null, body.data.status, id, eventId);
  if (update.changes === 0) {
    res.status(404).json({ error: "Bestellung nicht gefunden." });
    return;
  }
  res.json({ order: await getOrder(id) });
});

app.get("/api/staff/products", staffOnly, activeEvent, async (_req, res) => {
  if (supabase) {
    const { data, error } = await supabase.from("tisch_products").select("*").eq("event_id", res.locals.eventId).order("category").order("name");
    if (error) throw cloudError(error);
    res.json({ products: data });
    return;
  }
  res.json({ products: db.prepare("SELECT * FROM products WHERE event_id = ? ORDER BY category, name").all(res.locals.eventId) });
});

app.post("/api/staff/products", staffOnly, activeEvent, async (req, res) => {
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

app.patch("/api/staff/products/:id", staffOnly, activeEvent, async (req, res) => {
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

app.get("/api/staff/tables", staffOnly, activeEvent, async (_req, res) => {
  if (supabase) {
    const { data, error } = await supabase.from("tisch_tables").select("*").eq("event_id", res.locals.eventId).order("id");
    if (error) throw cloudError(error);
    res.json({ tables: data });
    return;
  }
  res.json({ tables: db.prepare("SELECT * FROM tables WHERE event_id = ? ORDER BY id").all(res.locals.eventId) });
});

app.post("/api/staff/tables", staffOnly, activeEvent, async (req, res) => {
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

app.patch("/api/staff/tables/:id", staffOnly, activeEvent, async (req, res) => {
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
