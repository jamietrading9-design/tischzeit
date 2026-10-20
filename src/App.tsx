import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownLeft, ArrowLeft, ArrowRight, BadgeCheck, Banknote, Beer, Check, ChefHat,
  ChevronDown, CircleHelp, Clock3, Coffee, Flame, LayoutDashboard, Minus, Plus,
  Printer, QrCode, ReceiptText, Settings2, ShoppingBag, Soup, Utensils, X,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

type Product = { id: number; name: string; description: string; category: string; price_cents: number; available?: number };
type Table = { id: number; name: string; active?: number };
type OrderItem = { product_name: string; quantity: number; unit_price_cents: number; note: string };
type Order = {
  id: string; table_id: number; table_name: string; status: "new" | "preparing" | "ready" | "paid";
  total_cents: number; tip_cents: number; created_at: string; paid_at: string | null;
  customer_id: number | null; canceled_at: string | null; cancellation_reason: string | null; canceled_by: string | null;
  items: OrderItem[];
};
type EventSummary = { id: number; name: string; slug: string; created_at: string };
type PublicData = { venueName: string; eventSlug: string; welcomeText: string; accentColor: string; products: Product[]; tables: Table[] };
type Permission =
  | "orders.view" | "orders.edit" | "kitchen.view" | "kitchen.edit" | "cash.view" | "cash.edit"
  | "menu.view" | "menu.edit" | "tables.view" | "tables.edit" | "receipts.view" | "receipts.cancel"
  | "customers.view" | "customers.manage" | "users.manage" | "roles.manage" | "settings.manage"
  | "finance.view" | "finance.edit";
type StaffUser = {
  username: string; role: "admin" | "staff"; roleId: string; roleName: string;
  permissions: Permission[]; isAdmin: boolean; sessionMinutes: number;
};
type StaffRole = { id: string; name: string; permissions: Permission[]; session_minutes: number; is_admin: boolean };
type Receipt = {
  id: string; venue_name: string; total_cents: number; tip_cents: number; created_at: string; paid_at: string;
  items: OrderItem[];
};
type CustomerRecord = {
  id: number; customer_number: string; banned: boolean; ban_reason: string; created_at: string;
  orders: Array<{ id: string; status: string; total_cents: number; created_at: string; canceled_at: string | null }>;
};

const ORGANIZATION_NAME = "Jugendfeuerwehr Steinbergkirche";
const euro = (cents: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(cents / 100);
const localDateTime = (value: string) => new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`).toLocaleString("de-DE");
const shortId = (id: string) => id.slice(0, 5).toUpperCase();
const request = async <T,>(path: string, options: RequestInit = {}, eventId?: number): Promise<T> => {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(eventId ? { "x-event-id": String(eventId) } : {}), ...options.headers },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Die Anfrage ist fehlgeschlagen.");
  return data as T;
};

function App() {
  const tableParam = new URLSearchParams(window.location.search).get("t");
  const eventRoute = window.location.pathname.match(/^\/e\/([a-z0-9-]+)\/?$/i);
  const eventSlug = eventRoute?.[1] ?? (tableParam !== null ? "feuerwehrfest" : null);
  if (window.location.pathname === "/impressum" || window.location.pathname === "/datenschutz") {
    return <LegalPage kind={window.location.pathname === "/impressum" ? "imprint" : "privacy"} />;
  }
  if (/^\/rechnung\/?$/i.test(window.location.pathname)) return <CustomerReceipts />;
  return eventSlug ? <GuestApp eventSlug={eventSlug} requestedTable={Number(tableParam)} /> : <StaffApp />;
}

function CustomerReceipts() {
  const [customerNumber, setCustomerNumber] = useState(new URLSearchParams(window.location.search).get("kundennummer") ?? "");
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const loadReceipts = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true); setError(""); setLoaded(false);
    try {
      const result = await request<{ receipts: Receipt[] }>(`/api/customer/receipts?customerNumber=${encodeURIComponent(customerNumber.trim())}`);
      setReceipts(result.receipts); setLoaded(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return <main className="customer-receipts-page">
    <header className="guest-header"><a className="brand" href="/"><span className="brand-mark"><Flame size={18} /></span><span className="brand-name">{ORGANIZATION_NAME}</span></a><a className="text-button" href="/">Zurück <ArrowLeft size={15} /></a></header>
    <section className="customer-receipts-content">
      <span className="eyebrow">BELEGE</span><h1>Meine Rechnungen<span className="title-period">.</span></h1>
      <p>Hier findest du bezahlte Bestellungen. Zur Sicherheit ist der Abruf nur auf dem Browser möglich, mit dem bestellt wurde.</p>
      <form className="receipt-lookup" onSubmit={loadReceipts}>
        <label className="field-label" htmlFor="customer-number">Kundennummer<input id="customer-number" className="text-input" inputMode="numeric" autoComplete="off" required maxLength={12} value={customerNumber} onChange={(event) => setCustomerNumber(event.target.value.replace(/\D/g, ""))} /></label>
        <button className="primary-button" disabled={busy}>{busy ? "Wird gesucht …" : <>Belege anzeigen <ArrowRight size={16} /></>}</button>
      </form>
      {error && <p className="inline-error">{error}</p>}
      {loaded && !receipts.length && <p className="empty-state">Für diese Kundennummer sind noch keine bezahlten Belege vorhanden.</p>}
      {receipts.map((receipt) => <article className="paid-receipt" key={receipt.id}>
        <div className="receipt-top"><div className="receipt-brand"><Flame size={16} /> {receipt.venue_name}</div><strong className="receipt-heading">Kassenbeleg</strong></div>
        <div className="receipt-rule" />
        <div className="receipt-meta"><span>Beleg #{shortId(receipt.id)}</span><span>Bezahlt am {localDateTime(receipt.paid_at)}</span></div>
        <div className="receipt-rule" />
        {receipt.items.map((item, index) => <div className="receipt-line" key={`${item.product_name}-${index}`}><span>{item.quantity} × {item.product_name}</span><strong>{euro(item.quantity * item.unit_price_cents)}</strong></div>)}
        {receipt.tip_cents > 0 && <div className="receipt-line"><span>Trinkgeld</span><strong>{euro(receipt.tip_cents)}</strong></div>}
        <div className="receipt-rule" />
        <div className="receipt-total"><span>Gesamtbetrag</span><strong>{euro(receipt.total_cents + receipt.tip_cents)}</strong></div>
        <p className="receipt-legal">Zahlungsbeleg · kein TSE-Kassenbeleg</p>
        <button className="text-button receipt-print-button" onClick={() => window.print()}><Printer size={16} /> Drucken oder als PDF sichern</button>
      </article>)}
    </section>
  </main>;
}

function LegalPage({ kind }: { kind: "imprint" | "privacy" }) {
  const isImprint = kind === "imprint";
  return <main className="legal-page">
    <header className="guest-header"><a className="brand" href="/"><span className="brand-mark"><Flame size={18} /></span><span className="brand-name">{ORGANIZATION_NAME}</span></a><a className="text-button" href="/">Zurück zur Startseite <ArrowLeft size={15} /></a></header>
    <article className="legal-content"><span className="eyebrow">{ORGANIZATION_NAME.toLocaleUpperCase("de-DE")} · MUSTERVORLAGE</span><h1>{isImprint ? "Impressum" : "Datenschutzerklärung"}<span className="title-period">.</span></h1><div className="legal-notice"><CircleHelp size={19} /><p><strong>Bitte vor dem Einsatz ausfüllen.</strong> Diese Vorlage ist keine Rechtsberatung. Ersetze alle Angaben in eckigen Klammern durch die tatsächlichen Veranstalterdaten und lass die Texte bei Bedarf rechtlich prüfen.</p></div>
      {isImprint ? <>
        <h2>Angaben gemäß § 5 DDG</h2><p>[Name des Vereins / Veranstalters]<br />[Vertretungsberechtigte Person]<br />[Straße und Hausnummer]<br />[PLZ und Ort]</p>
        <h2>Kontakt</h2><p>Telefon: [Telefonnummer]<br />E-Mail: [E-Mail-Adresse]</p>
        <h2>Verantwortlich für den Inhalt</h2><p>[Name und Anschrift der verantwortlichen Person]</p>
        <h2>Hinweis zum Veranstaltungsangebot</h2><p>Die Speisekarte und die Bestellmöglichkeit auf dieser Website beziehen sich auf das Angebot des oben genannten Veranstalters. Die Bestellung wird erst mit Annahme durch den Veranstalter verbindlich.</p>
      </> : <>
        <h2>1. Verantwortlicher</h2><p>[Name des Vereins / Veranstalters]<br />[Anschrift]<br />E-Mail: [E-Mail-Adresse]</p>
        <h2>2. Welche Daten wir verarbeiten</h2><p>Bei einer Bestellung verarbeiten wir die ausgewählten Produkte, einen optionalen Sonderwunsch, die Tischzuordnung und Bestellzeit. Ein notwendiges, zufälliges Cookie ordnet weitere Bestellungen desselben Browsers derselben pseudonymen Kundenakte und Kundennummer zu. Nach der Zahlung lassen sich Belege unter „/rechnung“ mit der Kundennummer und demselben Browser-Cookie abrufen. Die Akte enthält Bestellungen und kann bei Missbrauch für weitere Bestellungen gesperrt werden. Namen, Kontaktangaben und IP-Adressen werden von der Anwendung nicht in der Kundenakte gespeichert. Der Hosting-Anbieter kann IP-Adressen nach seinen eigenen Angaben in technischen Protokollen verarbeiten.</p>
        <h2>3. Zweck und Rechtsgrundlage</h2><p>Wir verarbeiten Bestelldaten zur Durchführung der Bestellung und Abrechnung (Art. 6 Abs. 1 lit. b DSGVO). Technisch notwendige Serverprotokolle können zur sicheren Bereitstellung und Fehleranalyse verarbeitet werden (Art. 6 Abs. 1 lit. f DSGVO).</p>
        <h2>4. Speicherdauer</h2><p>Bestellungen, Kundenakten, Sperren und dokumentierte Stornierungen werden in der Datenbank des Betreibers gespeichert. Der Betreiber muss vor dem Einsatz passende Löschfristen festlegen und gesetzliche Aufbewahrungspflichten für Abrechnungsunterlagen beachten. Das Geräte-Cookie bleibt bis zu einem Jahr gültig oder bis es im Browser gelöscht wird.</p>
        <h2>5. Hosting und Empfänger</h2><p>Die Daten werden auf dem für diese Anwendung eingerichteten Hosting- und Datenbankdienst verarbeitet. [Hosting-Anbieter, Auftragsverarbeitung und mögliche Drittlandübermittlungen konkret ergänzen.]</p>
        <h2>6. Ihre Rechte</h2><p>Betroffene Personen haben im Rahmen der gesetzlichen Voraussetzungen Rechte auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit und Widerspruch. Außerdem besteht ein Beschwerderecht bei einer Datenschutzaufsichtsbehörde.</p>
        <h2>7. Kontakt zum Datenschutz</h2><p>Fragen zum Datenschutz richten Sie bitte an: [E-Mail-Adresse des Veranstalters].</p>
      </>}
      <p className="legal-updated">Vorlage, Stand: Oktober 2026</p>
    </article>
  </main>;
}

function GuestApp({ eventSlug, requestedTable }: { eventSlug: string; requestedTable: number }) {
  const [data, setData] = useState<PublicData | null>(null);
  const [tableId, setTableId] = useState(requestedTable);
  const [cart, setCart] = useState<Record<number, number>>({});
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [category, setCategory] = useState("Alles");
  const [order, setOrder] = useState<Order | null>(null);
  const [customerNumber, setCustomerNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { request<PublicData>(`/api/public/${encodeURIComponent(eventSlug)}`).then(setData).catch((e: Error) => setError(e.message)); }, [eventSlug]);
  const categories = useMemo(() => ["Alles", ...new Set(data?.products.map((p) => p.category) ?? [])], [data]);
  const visibleProducts = data?.products.filter((p) => category === "Alles" || p.category === category) ?? [];
  const accentColor = data?.accentColor ?? "#963b35";
  const cartCount = Object.values(cart).reduce((sum, count) => sum + count, 0);
  const total = data?.products.reduce((sum, product) => sum + (cart[product.id] ?? 0) * product.price_cents, 0) ?? 0;
  const updateQuantity = (id: number, delta: number) => setCart((current) => {
    const quantity = Math.max(0, (current[id] ?? 0) + delta);
    const next = { ...current };
    if (quantity === 0) delete next[id]; else next[id] = quantity;
    return next;
  });
  const submitOrder = async () => {
    setBusy(true); setError("");
    try {
      const result = await request<{ order: Order; customerNumber: string }>(`/api/events/${encodeURIComponent(eventSlug)}/orders`, {
        method: "POST",
        body: JSON.stringify({
          tableId,
          items: Object.entries(cart).map(([productId, quantity]) => ({ productId: Number(productId), quantity, note: notes[Number(productId)] ?? "" })),
        }),
      });
      setOrder(result.order);
      setCustomerNumber(result.customerNumber);
      setCart({});
      setNotes({});
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  if (!data && !error) return <div className="loading"><div className="brand-mark"><Flame size={19} /></div><span>Speisekarte wird geladen …</span></div>;
  if (order) return <GuestConfirmation order={order} venueName={data?.venueName ?? ORGANIZATION_NAME} customerNumber={customerNumber} onMore={() => setOrder(null)} />;

  return (
    <main className="guest-page" style={{ "--olive": accentColor, "--olive-dark": accentColor, "--olive-pale": `${accentColor}20` } as React.CSSProperties}>
      <header className="guest-header">
        <a className="brand" href="/"><span className="brand-mark"><Flame size={18} /></span><span className="brand-name">{ORGANIZATION_NAME}</span></a>
      </header>
      <section className="guest-hero">
        <div className="hero-copy">
          <span className="eyebrow"><span className="eyebrow-line" /> SPEISEKARTE</span>
          <h1 className="venue-title">{data?.venueName ?? ORGANIZATION_NAME}<br /><em>Speisekarte.</em></h1>
          <p>{data?.welcomeText ?? "Artikel auswählen und Bestellung an die Küche senden."}</p>
          <label className="table-select"><Utensils size={17} /><span>Dein Platz</span>
            <select value={tableId} onChange={(event) => setTableId(Number(event.target.value))}>
              {data?.tables.map((table) => <option key={table.id} value={table.id}>{table.name}</option>)}
            </select><ChevronDown size={15} />
          </label>
        </div>
        <div className="hero-art" aria-label="Illustration von Getränken und Abendessen">
          <div className="sun-orb" /><div className="hero-plate"><div className="plate-center"><span>JF</span></div></div>
          <div className="hero-glass glass-one"><Beer size={30} /></div><div className="hero-glass glass-two"><Coffee size={23} /></div>
        </div>
      </section>
      <section className="menu-section">
        <div className="section-title"><div><span className="eyebrow">{data?.venueName ?? ORGANIZATION_NAME}</span><h2>Speisekarte<span className="title-period">.</span></h2></div><span className="menu-count">{data?.products.length ?? 0} Produkte</span></div>
        <nav className="category-tabs">{categories.map((item) => <button key={item} onClick={() => setCategory(item)} className={category === item ? "category-tab active" : "category-tab"}>{item}</button>)}</nav>
        {error && <div className="notice error-notice">{error}</div>}
        <div className="product-grid">
          {visibleProducts.map((product, index) => (
            <article className="product-card" key={product.id}>
              <div className={`product-art product-art-${index % 4}`}>
                <span className="product-category">{product.category}</span>
                {index % 4 === 0 ? <Flame size={38} strokeWidth={1.3} /> : index % 4 === 1 ? <Soup size={38} strokeWidth={1.3} /> : index % 4 === 2 ? <Beer size={38} strokeWidth={1.3} /> : <Coffee size={38} strokeWidth={1.3} />}
                <span className="product-number">{String(index + 1).padStart(2, "0")}</span>
              </div>
              <div className="product-info"><div><h3>{product.name}</h3><p>{product.description}</p></div><strong>{euro(product.price_cents)}</strong></div>
              {cart[product.id] ? <div className="quantity-control"><button aria-label="Anzahl verringern" onClick={() => updateQuantity(product.id, -1)}><Minus size={15} /></button><span>{cart[product.id]}</span><button aria-label="Anzahl erhöhen" onClick={() => updateQuantity(product.id, 1)}><Plus size={15} /></button></div> :
                <button className="add-button" onClick={() => updateQuantity(product.id, 1)}><Plus size={16} /> Hinzufügen</button>}
              {cart[product.id] > 0 && <input className="item-note" placeholder="Sonderwunsch? (optional)" maxLength={160} value={notes[product.id] ?? ""} onChange={(event) => setNotes({ ...notes, [product.id]: event.target.value })} />}
            </article>
          ))}
          {!visibleProducts.length && <p className="empty-state">Gerade ist hier nichts auf der Karte.</p>}
        </div>
      </section>
      <footer className="guest-footer"><a className="brand" href={`/e/${encodeURIComponent(eventSlug)}?t=${tableId}`}><span className="brand-mark"><Flame size={16} /></span><span className="brand-name">{ORGANIZATION_NAME}</span></a><span><a href="/impressum">Impressum</a> · <a href="/datenschutz">Datenschutz</a></span></footer>
      {cartCount > 0 && <div className="cart-bar"><div className="cart-summary"><span className="cart-count">{cartCount}</span><span>Artikel</span><strong>{euro(total)}</strong></div><button className="primary-button" onClick={submitOrder} disabled={busy}>{busy ? "Wird gesendet …" : <>Bestellung abschicken <ArrowRight size={17} /></>}</button></div>}
    </main>
  );
}

function GuestConfirmation({ order, venueName, customerNumber, onMore }: { order: Order; venueName: string; customerNumber: string; onMore: () => void }) {
  return <main className="confirmation-page">
    <a className="brand" href="/"><span className="brand-mark"><Flame size={18} /></span><span className="brand-name">{ORGANIZATION_NAME}</span></a>
    <div className="confirmation-card">
      <div className="confirmation-icon"><BadgeCheck size={34} /></div>
      <span className="eyebrow">BESTELLUNG</span>
      <h1>Bestellung<br /><em>eingegangen.</em></h1>
      <p>Die Küche hat deine Bestellung erhalten.</p>
      <section className="guest-order-receipt">
        <div className="receipt-top">
          <div className="receipt-brand"><Flame size={16} /> {venueName}</div>
          <strong className="receipt-heading">Bestellübersicht</strong>
        </div>
        <div className="receipt-rule" />
        <div className="receipt-meta">
          <span>Bestellung #{shortId(order.id)}</span>
          <span>Kundennummer {customerNumber}</span>
          <span>{order.table_name} · {new Date(order.created_at).toLocaleString("de-DE")}</span>
        </div>
        <div className="receipt-rule" />
        {order.items.map((item, index) => (
          <div className="receipt-item" key={`${item.product_name}-${index}`}>
            <div className="receipt-line">
              <span>{item.quantity} × {item.product_name}</span>
              <strong>{euro(item.quantity * item.unit_price_cents)}</strong>
            </div>
            {item.note && <small>{item.note}</small>}
          </div>
        ))}
        <div className="receipt-rule" />
        <div className="receipt-total"><span>Gesamtbetrag</span><strong>{euro(order.total_cents)}</strong></div>
        <p className="receipt-legal">Bestellung · noch nicht bezahlt</p>
      </section>
      <div className="cash-note"><Banknote size={18} /><span>Bezahlt wird bar an der Kasse.</span></div>
      <a className="text-button" href={`/rechnung?kundennummer=${encodeURIComponent(customerNumber)}`}>Belege ansehen <ArrowRight size={16} /></a>
      <button className="text-button" onClick={onMore}>Weiter bestellen <ArrowRight size={16} /></button>
    </div>
  </main>;
}

type StaffTab = "orders" | "kitchen" | "cash" | "menu" | "tables" | "history" | "customers" | "users" | "roles" | "settings" | "finance";
const permissionGroups: Array<{ title: string; items: Array<{ view?: Permission; edit?: Permission; label: string }> }> = [
  { title: "Bestellungen", items: [{ label: "Bestellungen", view: "orders.view", edit: "orders.edit" }, { label: "Küche", view: "kitchen.view", edit: "kitchen.edit" }, { label: "Kasse", view: "cash.view", edit: "cash.edit" }] },
  { title: "Verwaltung", items: [{ label: "Speisekarte", view: "menu.view", edit: "menu.edit" }, { label: "Tische und QR-Codes", view: "tables.view", edit: "tables.edit" }, { label: "Belege", view: "receipts.view", edit: "receipts.cancel" }, { label: "Kundenakten", view: "customers.view", edit: "customers.manage" }] },
  { title: "Zugänge und Finanzen", items: [{ label: "Finanzen", view: "finance.view", edit: "finance.edit" }, { label: "Benutzer verwalten", edit: "users.manage" }, { label: "Rollen verwalten", edit: "roles.manage" }, { label: "Veranstaltungsseite", edit: "settings.manage" }] },
];
function StaffApp() {
  const [username, setUsername] = useState(localStorage.getItem("staff-username") ?? "");
  const [staffUser, setStaffUser] = useState<StaffUser | null>(null);
  const [password, setPassword] = useState("");
  const [isLoggedIn, setLoggedIn] = useState(false);
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [activeEventId, setActiveEventId] = useState(Number(localStorage.getItem("active-event-id")) || 0);
  const [tab, setTab] = useState<StaffTab>("orders");
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<"product" | "table" | "qr" | "event" | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [selectedTable, setSelectedTable] = useState<Table | null>(null);
  const [tipOrder, setTipOrder] = useState<Order | null>(null);
  const [receiptOrder, setReceiptOrder] = useState<Order | null>(null);
  const [receiptVenueName, setReceiptVenueName] = useState("");
  const activeEvent = events.find((event) => event.id === activeEventId) ?? null;
  const can = (permission: Permission) => {
    const impliedEdit: Partial<Record<Permission, Permission>> = {
      "orders.view": "orders.edit", "kitchen.view": "kitchen.edit", "cash.view": "cash.edit",
      "menu.view": "menu.edit", "tables.view": "tables.edit", "customers.view": "customers.manage",
      "receipts.view": "receipts.cancel", "finance.view": "finance.edit",
    };
    return staffUser?.isAdmin === true || staffUser?.permissions.includes(permission) === true
      || Boolean(impliedEdit[permission] && staffUser?.permissions.includes(impliedEdit[permission]!));
  };
  const canAny = (...permissions: Permission[]) => permissions.some(can);

  const refreshEvents = useCallback(async () => {
    const result = await request<{ events: EventSummary[] }>("/api/staff/events");
    setEvents(result.events);
    const savedId = Number(localStorage.getItem("active-event-id"));
    const nextId = result.events.some((event) => event.id === activeEventId)
      ? activeEventId
      : result.events.some((event) => event.id === savedId) ? savedId : result.events[0]?.id ?? 0;
    setActiveEventId(nextId);
    if (nextId) localStorage.setItem("active-event-id", String(nextId));
    return result.events;
  }, [activeEventId]);

  useEffect(() => {
    void request<{ user: StaffUser }>("/api/staff/me")
      .then(({ user }) => {
        setStaffUser(user);
        setUsername(user.username);
        return refreshEvents();
      })
      .then(() => setLoggedIn(true))
      .catch(() => setLoggedIn(false));
  }, [refreshEvents]);

  const loadAll = useCallback(async () => {
    if (!activeEventId) return;
    try {
      const [orderData, productData, tableData] = await Promise.all([
        canAny("orders.view", "kitchen.view", "cash.view")
          ? request<{ orders: Order[] }>("/api/staff/orders", {}, activeEventId) : Promise.resolve({ orders: [] }),
        canAny("menu.view", "menu.edit")
          ? request<{ products: Product[] }>("/api/staff/products", {}, activeEventId) : Promise.resolve({ products: [] }),
        canAny("tables.view", "tables.edit")
          ? request<{ tables: Table[] }>("/api/staff/tables", {}, activeEventId) : Promise.resolve({ tables: [] }),
      ]);
      setOrders(orderData.orders); setProducts(productData.products); setTables(tableData.tables); setError("");
    } catch (e) {
      setError((e as Error).message);
      if ((e as Error).message.includes("Sitzung") || (e as Error).message.includes("anmelden")) setLoggedIn(false);
    }
  }, [activeEventId, staffUser]);
  useEffect(() => { if (isLoggedIn) void loadAll(); }, [isLoggedIn, loadAll]);
  useEffect(() => {
    if (!isLoggedIn) return;
    const timer = window.setInterval(() => { void loadAll(); }, 5000);
    return () => window.clearInterval(timer);
  }, [isLoggedIn, loadAll]);
  useEffect(() => {
    if (!isLoggedIn) return;
    const timer = window.setInterval(() => {
      void request<{ user: StaffUser }>("/api/staff/me")
        .then(({ user }) => setStaffUser(user))
        .catch((e: Error) => {
          if (e.message.includes("Sitzung") || e.message.includes("anmelden")) setLoggedIn(false);
          else setError(e.message);
        });
    }, 30000);
    return () => window.clearInterval(timer);
  }, [isLoggedIn]);

  const login = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError("");
    try {
      await request<{ user: StaffUser }>("/api/staff/login", { method: "POST", body: JSON.stringify({ username, password }) });
      const { user } = await request<{ user: StaffUser }>("/api/staff/me");
      setStaffUser(user);
      setUsername(user.username);
      localStorage.setItem("staff-username", user.username);
      setPassword("");
      await refreshEvents();
      setLoggedIn(true);
    } catch (e) { setError((e as Error).message); }
  };
  const updateOrder = async (order: Order, status: Order["status"], tipCents?: number) => {
    try {
      const updated = await request<{ order: Order }>(`/api/staff/orders/${order.id}`, { method: "PATCH", body: JSON.stringify({ status, ...(tipCents === undefined ? {} : { tipCents }) }) }, activeEventId);
      setTipOrder(null);
      if (status === "paid") {
        setReceiptVenueName(activeEvent?.name ?? "Veranstaltung");
        setReceiptOrder(updated.order);
      }
      await loadAll();
    } catch (e) { setError((e as Error).message); }
  };

  const nav = useMemo(() => {
    const all: Array<{ id: StaffTab; label: string; icon: typeof LayoutDashboard; count?: number; permissions: Permission[] }> = [
      { id: "orders", label: "Bestellungen", icon: ShoppingBag, count: orders.filter((o) => o.status === "new").length, permissions: ["orders.view"] },
      { id: "kitchen", label: "Küche", icon: ChefHat, count: orders.filter((o) => o.status === "new" || o.status === "preparing").length, permissions: ["kitchen.view"] },
      { id: "cash", label: "Kasse", icon: Banknote, count: orders.filter((o) => o.status === "ready" && !o.canceled_at).length, permissions: ["cash.view"] },
      { id: "menu", label: "Speisekarte", icon: Soup, permissions: ["menu.view", "menu.edit"] },
      { id: "tables", label: "Tische & QR", icon: QrCode, permissions: ["tables.view", "tables.edit"] },
      { id: "history", label: "Belege", icon: ReceiptText, permissions: ["receipts.view"] },
      { id: "customers", label: "Kunden", icon: ShoppingBag, permissions: ["customers.view", "customers.manage"] },
      { id: "finance", label: "Finanzen", icon: Banknote, permissions: ["finance.view"] },
      { id: "users", label: "Benutzer", icon: LayoutDashboard, permissions: ["users.manage"] },
      { id: "roles", label: "Rollen", icon: Settings2, permissions: ["roles.manage"] },
      { id: "settings", label: "Seite", icon: Settings2, permissions: ["settings.manage"] },
    ];
    return all.filter((item) => staffUser?.isAdmin || item.permissions.some((permission) => staffUser?.permissions.includes(permission)));
  }, [staffUser, orders]);
  useEffect(() => {
    if (isLoggedIn && nav.length && !nav.some((item) => item.id === tab)) setTab(nav[0].id);
  }, [isLoggedIn, nav, tab]);

  if (!isLoggedIn) return <main className="login-page"><div className="login-brand brand"><span className="brand-mark"><Flame size={18} /></span><span className="brand-name">{ORGANIZATION_NAME}</span><span className="staff-pill">PERSONAL</span></div><form className="login-card" onSubmit={login}><div className="login-icon"><LayoutDashboard size={24} /></div><span className="eyebrow">PERSONALBEREICH</span><h1>Anmelden<span className="title-period">.</span></h1><p>Melde dich mit deinem Veranstalter-Konto an.</p><label className="field-label" htmlFor="staff-username">Benutzername<input autoFocus id="staff-username" className="text-input" autoComplete="username" required maxLength={64} value={username} onChange={(e) => setUsername(e.target.value)} /></label><label className="field-label" htmlFor="staff-password">Passwort<input id="staff-password" className="text-input" autoComplete="current-password" required type="password" maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} /></label><button className="primary-button full-button">Anmelden <ArrowRight size={17} /></button>{error && <p className="inline-error">{error}</p>}</form></main>;

  if (!activeEvent) return <main className="loading"><div className="brand-mark"><Utensils size={19} /></div><span>Veranstaltungen werden geladen …</span></main>;

  const activeOrders = orders.filter((order) => order.status !== "paid" && !order.canceled_at);
  const due = orders.filter((order) => order.status === "ready" && !order.canceled_at).reduce((sum, order) => sum + order.total_cents, 0);
  return <div className="admin-shell">
    <aside className="sidebar"><a className="brand sidebar-brand" href="/"><span className="brand-mark"><Flame size={18} /></span><span className="brand-name">{ORGANIZATION_NAME}</span></a><div className="sidebar-label">VERANSTALTUNG</div><div className="event-name"><span className="event-icon"><Flame size={17} /></span><select aria-label="Veranstaltung wählen" value={activeEventId} onChange={(event) => { const id = Number(event.target.value); setActiveEventId(id); localStorage.setItem("active-event-id", String(id)); }} className="event-picker">{events.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select>{can("settings.manage") && <button className="add-event-button" title="Veranstaltung erstellen" onClick={() => setModal("event")}><Plus size={17} /></button>}</div><div className="sidebar-label nav-label">ARBEITSBEREICH</div><nav className="side-nav">{nav.map(({ id, label, icon: Icon, count }) => <button key={id} onClick={() => setTab(id)} className={`nav-item ${tab === id ? "selected" : ""}`}><Icon size={17} /><span>{label}</span>{count ? <span className="nav-count">{count}</span> : null}</button>)}</nav><div className="sidebar-bottom"><div className="staff-profile"><div className="avatar">{username.slice(0, 2).toUpperCase()}</div><div><strong>{username}</strong><small>{staffUser?.roleName}</small></div><button title="Abmelden" className="logout-button" onClick={async () => { try { await request("/api/staff/logout", { method: "POST" }); } finally { localStorage.removeItem("staff-username"); setStaffUser(null); setLoggedIn(false); } }}><ArrowDownLeft size={16} /></button></div></div></aside>
    <main className="admin-main"><header className="admin-topbar"><div className="breadcrumb">{activeEvent.name} <span>/</span> {nav.find((item) => item.id === tab)?.label}</div><div className="topbar-right"><button className="icon-button" title="Daten neu laden" onClick={() => void loadAll()}><Clock3 size={18} /></button><div className="avatar small-avatar" title={`${username} · ${staffUser?.roleName} · Sitzung ${staffUser?.sessionMinutes} Minuten`}>{username.slice(0, 2).toUpperCase()}</div></div></header>
      <div className="admin-content">
        {error && <div className="notice error-notice">{error}<button onClick={() => setError("")}><X size={15} /></button></div>}
        {tab === "orders" && <OrdersView orders={orders} setTab={setTab} />}
        {tab === "kitchen" && <KitchenView orders={activeOrders.filter((order) => order.status === "new" || order.status === "preparing")} updateOrder={updateOrder} />}
        {tab === "cash" && <CashView orders={orders.filter((order) => order.status === "ready" && !order.canceled_at)} due={due} onPay={setTipOrder} />}
        {tab === "menu" && <MenuView products={products} canEdit={can("menu.edit")} onAdd={() => { setEditingProduct(null); setModal("product"); }} onEdit={(product) => { setEditingProduct(product); setModal("product"); }} onToggle={async (product) => {
          try { await request(`/api/staff/products/${product.id}`, { method: "PATCH", body: JSON.stringify({ ...product, priceCents: product.price_cents, available: !product.available }) }, activeEventId); await loadAll(); } catch (e) { setError((e as Error).message); }
        }} />}
        {tab === "tables" && <TablesView tables={tables} canEdit={can("tables.edit")} onAdd={() => setModal("table")} onQR={(table) => { setSelectedTable(table); setModal("qr"); }} onToggle={async (table) => {
          try { await request(`/api/staff/tables/${table.id}`, { method: "PATCH", body: JSON.stringify({ name: table.name, active: !table.active }) }, activeEventId); await loadAll(); } catch (e) { setError((e as Error).message); }
        }} />}
        {tab === "history" && can("receipts.view") && <OrderHistoryView eventId={activeEventId} canCancel={can("receipts.cancel")} onReceipt={(order) => { setReceiptVenueName(activeEvent.name); setReceiptOrder(order); }} />}
        {tab === "customers" && canAny("customers.view", "customers.manage") && <CustomersView canManage={can("customers.manage")} />}
        {tab === "users" && can("users.manage") && <AdminUsersView currentUsername={username} canCreateAdmin={staffUser?.isAdmin === true} />}
        {tab === "roles" && can("roles.manage") && <RolesView />}
        {tab === "finance" && can("finance.view") && <FinanceView eventId={activeEventId} canEdit={can("finance.edit")} />}
        {tab === "settings" && can("settings.manage") && <EventSettingsView eventId={activeEventId} eventSlug={activeEvent.slug} eventName={activeEvent.name} onSaved={(name) => setEvents((current) => current.map((event) => event.id === activeEventId ? { ...event, name } : event))} />}
      </div>
      {modal === "product" && <ProductModal product={editingProduct} eventId={activeEventId} onClose={() => setModal(null)} onSaved={async () => { setModal(null); await loadAll(); }} />}
      {modal === "table" && <TableModal eventId={activeEventId} onClose={() => setModal(null)} onSaved={async () => { setModal(null); await loadAll(); }} />}
      {modal === "event" && can("settings.manage") && <EventModal onClose={() => setModal(null)} onSaved={async (newEvent) => { setEvents((current) => [...current, newEvent]); setActiveEventId(newEvent.id); localStorage.setItem("active-event-id", String(newEvent.id)); setTab("orders"); setModal(null); }} />}
      {modal === "qr" && selectedTable && <QRModal table={selectedTable} eventSlug={activeEvent.slug} onClose={() => setModal(null)} />}
      {tipOrder && <PaymentModal order={tipOrder} onClose={() => setTipOrder(null)} onPay={(tip) => void updateOrder(tipOrder, "paid", tip)} />}
      {receiptOrder && <ReceiptModal order={receiptOrder} venueName={receiptVenueName} onClose={() => setReceiptOrder(null)} />}
    </main>
  </div>;
}

function PageHeading({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail: string; action?: React.ReactNode }) {
  return <div className="page-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}<span className="title-period">.</span></h1><p>{detail}</p></div>{action}</div>;
}
function MetricCard({ label, value, detail, icon: Icon, tone }: { label: string; value: string; detail: string; icon: typeof Clock3; tone: string }) {
  return <div className="metric-card"><div className={`metric-icon ${tone}`}><Icon size={19} /></div><span className="metric-label">{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}
function OrdersView({ orders, setTab }: { orders: Order[]; setTab: (tab: StaffTab) => void }) {
  const open = orders.filter((o) => o.status !== "paid" && !o.canceled_at);
  const todayTotal = orders.reduce((sum, o) => sum + (o.status === "paid" && !o.canceled_at ? o.total_cents + o.tip_cents : 0), 0);
  const today = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }).format(new Date()).toLocaleUpperCase("de-DE");
  return <><PageHeading eyebrow={today} title="Übersicht" detail="Bestellungen, Küche und Tagesumsatz." />
    <div className="metric-grid"><MetricCard label="Offene Bestellungen" value={String(open.length).padStart(2, "0")} detail="Warten auf die Küche" icon={ShoppingBag} tone="tone-coral" /><MetricCard label="In der Küche" value={String(orders.filter((o) => o.status === "preparing" && !o.canceled_at).length).padStart(2, "0")} detail="In Zubereitung" icon={ChefHat} tone="tone-amber" /><MetricCard label="Umsatz heute" value={euro(todayTotal)} detail={`${orders.filter((o) => o.status === "paid" && !o.canceled_at).length} bezahlt`} icon={Banknote} tone="tone-green" /><MetricCard label="Bereit zur Zahlung" value={String(orders.filter((o) => o.status === "ready" && !o.canceled_at).length).padStart(2, "0")} detail="Warten auf die Kasse" icon={ReceiptText} tone="tone-blue" /></div>
    <section className="panel recent-panel"><div className="panel-heading"><div><span className="eyebrow">BESTELLUNGEN</span><h2>Letzte Bestellungen</h2></div><button className="subtle-button" onClick={() => setTab("kitchen")}>Zur Küche <ArrowRight size={15} /></button></div>
    {orders.length ? <div className="order-table-wrap"><table className="order-table"><thead><tr><th>BESTELLUNG</th><th>TISCH</th><th>INHALT</th><th>BETRAG</th><th>STATUS</th><th>ZEIT</th></tr></thead><tbody>{orders.slice(0, 8).map((order) => <tr key={order.id}><td><strong>#{shortId(order.id)}</strong></td><td>{order.table_name}</td><td className="order-content">{order.items.map((i) => `${i.quantity}× ${i.product_name}`).join(", ")}</td><td><strong>{euro(order.total_cents)}</strong></td><td><StatusBadge status={order.status} /></td><td className="time-cell">{new Date(`${order.created_at.replace(" ", "T")}Z`).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}</td></tr>)}</tbody></table></div> : <EmptyPanel icon={ShoppingBag} title="Keine Bestellungen" text="Bestellungen erscheinen hier." />}</section>
    </>;
}
function StatusBadge({ status }: { status: Order["status"] }) {
  const labels = { new: "Neu", preparing: "In Zubereitung", ready: "Bereit", paid: "Bezahlt" };
  return <span className={`status-badge status-${status}`}><span />{labels[status]}</span>;
}
function EmptyPanel({ icon: Icon, title, text }: { icon: typeof Clock3; title: string; text: string }) {
  return <div className="empty-panel"><span className="empty-icon"><Icon size={22} /></span><strong>{title}</strong><span>{text}</span></div>;
}
function KitchenView({ orders, updateOrder }: { orders: Order[]; updateOrder: (order: Order, status: Order["status"]) => void }) {
  return <><PageHeading eyebrow="KÜCHE" title="Bestellungen" detail="Offene Bestellungen und Zubereitungsstatus." />
    {orders.length ? <div className="kitchen-grid">{orders.map((order) => <article className={`kitchen-card kitchen-${order.status}`} key={order.id}><header><span className="kitchen-order-id">#{shortId(order.id)}</span><StatusBadge status={order.status} /><span className="kitchen-time">{new Date(`${order.created_at.replace(" ", "T")}Z`).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}</span></header><div className="kitchen-table">{order.table_name}</div><div className="kitchen-items">{order.items.map((item, i) => <div className="kitchen-item" key={`${item.product_name}-${i}`}><strong>{item.quantity}×</strong><span>{item.product_name}{item.note && <small>↳ {item.note}</small>}</span></div>)}</div><div className="kitchen-card-foot"><span>{euro(order.total_cents)}</span>{order.status === "new" ? <button className="primary-button" onClick={() => updateOrder(order, "preparing")}>Zubereitung starten <ArrowRight size={16} /></button> : <button className="ready-button" onClick={() => updateOrder(order, "ready")}><Check size={16} /> Fertig — zur Kasse</button>}</div></article>)}</div> : <EmptyPanel icon={ChefHat} title="Keine offenen Bestellungen" text="Neue Bestellungen erscheinen hier." />}</>;
}
function CashView({ orders, due, onPay }: { orders: Order[]; due: number; onPay: (order: Order) => void }) {
  return <><PageHeading eyebrow="KASSE" title="Zahlungen" detail="Bestellungen abrechnen und Belege drucken." /><div className="cash-summary"><div className="cash-summary-icon"><Banknote size={21} /></div><div><small>OFFENER BETRAG</small><strong>{euro(due)}</strong></div><span>{orders.length} {orders.length === 1 ? "Bestellung" : "Bestellungen"} bereit</span></div>
    {orders.length ? <div className="cash-list">{orders.map((order) => <article className="cash-card" key={order.id}><div className="cash-card-main"><div className="cash-card-top"><strong>#{shortId(order.id)}</strong><span>{order.table_name}</span><StatusBadge status={order.status} /></div><p>{order.items.map((i) => `${i.quantity}× ${i.product_name}`).join(", ")}</p></div><strong className="cash-total">{euro(order.total_cents)}</strong><button className="primary-button" onClick={() => onPay(order)}><Banknote size={17} /> Bar kassieren</button></article>)}</div> : <EmptyPanel icon={Banknote} title="Keine Bestellungen offen" text="Fertige Bestellungen erscheinen hier." />}</>;
}
function MenuView({ products, canEdit, onAdd, onEdit, onToggle }: { products: Product[]; canEdit: boolean; onAdd: () => void; onEdit: (p: Product) => void; onToggle: (p: Product) => void }) {
  const categories = [...new Set(products.map((p) => p.category))];
  return <><PageHeading eyebrow="SPEISEKARTE" title="Produkte" detail="Produkte und Preise für die Veranstaltung." action={canEdit ? <button className="primary-button" onClick={onAdd}><Plus size={17} /> Produkt hinzufügen</button> : undefined} />
    {products.length ? categories.map((category) => <section className="panel menu-admin-panel" key={category}><div className="menu-category-heading"><span>{category}</span><span>{products.filter((p) => p.category === category).length} Produkte</span></div>{products.filter((p) => p.category === category).map((product) => <div className={`menu-admin-row ${!product.available ? "unavailable" : ""}`} key={product.id}><div className="menu-admin-icon">{product.category.toLowerCase().includes("getränk") ? <Beer size={19} /> : <Soup size={19} />}</div><div className="menu-admin-info"><strong>{product.name}</strong><span>{product.description || "Keine Beschreibung"}</span></div><strong className="menu-admin-price">{euro(product.price_cents)}</strong>{canEdit && <><button className={`toggle-switch ${product.available ? "on" : ""}`} aria-label={product.available ? "Produkt ausblenden" : "Produkt anbieten"} onClick={() => onToggle(product)}><span /></button><button className="edit-button" onClick={() => onEdit(product)}>Bearbeiten</button></>}</div>)}</section>) : <EmptyPanel icon={Soup} title="Noch keine Produkte" text="Füge dein erstes Angebot hinzu." />}</>;
}
function TablesView({ tables, canEdit, onAdd, onQR, onToggle }: { tables: Table[]; canEdit: boolean; onAdd: () => void; onQR: (t: Table) => void; onToggle: (t: Table) => void }) {
  const activeCount = tables.filter((t) => t.active).length;
  return <><PageHeading eyebrow="TISCHE & QR-CODES" title="Tische" detail="Für jeden Tisch gibt es einen eigenen QR-Code." action={canEdit ? <button className="primary-button" onClick={onAdd}><Plus size={17} /> Tisch hinzufügen</button> : undefined} /><div className="table-summary"><div><span className="summary-number">{String(activeCount).padStart(2, "0")}</span><span>aktive Tische</span></div><span className="summary-note"><QrCode size={17} /> QR-Code scannen und Speisekarte öffnen</span></div>
    <div className="table-grid">{tables.map((table, index) => <article className={`table-card ${!table.active ? "inactive-table" : ""}`} key={table.id}><div className="table-card-top"><span className="table-number">{String(index + 1).padStart(2, "0")}</span><span className={`table-dot ${table.active ? "" : "off-dot"}`} /></div><div className="table-card-name">{table.name}</div><span className="table-card-status">{table.active ? "Bestellen möglich" : "Pausiert"}</span><div className="table-card-actions"><button className="subtle-button" disabled={!table.active} onClick={() => onQR(table)}><QrCode size={15} /> QR-Code</button>{canEdit && <button className="text-icon-button" title={table.active ? "Tisch pausieren" : "Tisch aktivieren"} onClick={() => onToggle(table)}><Settings2 size={16} /></button>}</div></article>)}</div>
    </>;
}

function RolesView() {
  const [roles, setRoles] = useState<StaffRole[]>([]);
  const [editing, setEditing] = useState<StaffRole | null>(null);
  const [name, setName] = useState("");
  const [sessionMinutes, setSessionMinutes] = useState(10);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () => {
    try {
      const result = await request<{ roles: StaffRole[] }>("/api/staff/roles");
      setRoles(result.roles);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => { void load(); }, []);
  const startNew = () => { setEditing(null); setName(""); setSessionMinutes(10); setPermissions([]); };
  const editRole = (role: StaffRole) => { setEditing(role); setName(role.name); setSessionMinutes(role.session_minutes); setPermissions(role.permissions); };
  const togglePermission = (permission: Permission, checked: boolean) => {
    const implied: Partial<Record<Permission, Permission>> = {
      "orders.edit": "orders.view", "kitchen.edit": "kitchen.view", "cash.edit": "cash.view",
      "menu.edit": "menu.view", "tables.edit": "tables.view", "customers.manage": "customers.view",
      "receipts.cancel": "receipts.view", "finance.edit": "finance.view",
    };
    setPermissions((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(permission);
        if (implied[permission]) next.add(implied[permission]!);
      } else {
        next.delete(permission);
        const edit = Object.entries(implied).find(([, view]) => view === permission)?.[0] as Permission | undefined;
        if (edit) next.delete(edit);
      }
      return [...next];
    });
  };
  const saveRole = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const body = JSON.stringify({ name, permissions, sessionMinutes });
      await request(editing ? `/api/staff/roles/${encodeURIComponent(editing.id)}` : "/api/staff/roles", {
        method: editing ? "PATCH" : "POST", body,
      });
      startNew();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return <>
    <PageHeading eyebrow="BERECHTIGUNGEN" title="Rollen" detail="Lege fest, welche Bereiche Mitarbeiter sehen oder bearbeiten dürfen." />
    <form className="panel admin-form-panel role-editor" onSubmit={saveRole}>
      <h2>{editing ? `Rolle bearbeiten: ${editing.name}` : "Neue Rolle"}</h2>
      <div className="form-row">
        <label className="field-label">Rollenname<input className="text-input" required minLength={2} maxLength={64} disabled={editing?.is_admin} value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className="field-label">Sitzungsdauer in Minuten<input className="text-input" type="number" required min={10} max={10080} value={sessionMinutes} onChange={(event) => setSessionMinutes(Number(event.target.value))} /><small>Nach Ablauf muss man sich erneut anmelden (10 bis 10.080 Minuten).</small></label>
      </div>
      <div className="permission-groups">{permissionGroups.map((group) => <section className="permission-group" key={group.title}><h3>{group.title}</h3>{group.items.map((item) => <div className="permission-row" key={item.label}><strong>{item.label}</strong><div>{item.view && <label><input type="checkbox" disabled={editing?.is_admin} checked={permissions.includes(item.view)} onChange={(event) => togglePermission(item.view!, event.target.checked)} /> Ansehen</label>}{item.edit && <label><input type="checkbox" disabled={editing?.is_admin} checked={permissions.includes(item.edit)} onChange={(event) => togglePermission(item.edit!, event.target.checked)} /> Bearbeiten</label>}</div></div>)}</section>)}</div>
      {error && <p className="inline-error">{error}</p>}
      <div className="button-group"><button className="primary-button" disabled={busy || !name.trim()}>{busy ? "Wird gespeichert …" : editing ? "Änderungen speichern" : "Rolle erstellen"}</button>{editing && <button className="subtle-button" type="button" onClick={startNew}>Abbrechen</button>}</div>
    </form>
    <section className="panel admin-list-panel">
      <div className="panel-heading"><div><span className="eyebrow">ROLLEN</span><h2>Vorhandene Rollen</h2></div></div>
      {roles.map((role) => <div className="admin-list-row" key={role.id}><div><strong>{role.name}</strong><small>{role.is_admin ? `Voller Zugriff · Rechte geschützt · ${role.session_minutes} Minuten Sitzung` : `${role.permissions.length} Rechte · ${role.session_minutes} Minuten Sitzung`}</small></div><button className="subtle-button" onClick={() => editRole(role)}>{role.is_admin ? "Sitzungsdauer" : "Bearbeiten"}</button></div>)}
    </section>
  </>;
}

function FinanceView({ eventId, canEdit }: { eventId: number; canEdit: boolean }) {
  type Entry = { id: number; kind: "income" | "expense"; amount_cents: number; description: string; entry_date: string; created_by: string };
  const [entries, setEntries] = useState<Entry[]>([]);
  const [paidSalesCents, setPaidSalesCents] = useState(0);
  const [manualIncomeCents, setManualIncomeCents] = useState(0);
  const [expensesCents, setExpensesCents] = useState(0);
  const [kind, setKind] = useState<"income" | "expense">("expense");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () => {
    try {
      const result = await request<{ entries: Entry[]; paidSalesCents: number; manualIncomeCents: number; expensesCents: number }>(
        "/api/staff/finance", {}, eventId,
      );
      setEntries(result.entries);
      setPaidSalesCents(result.paidSalesCents);
      setManualIncomeCents(result.manualIncomeCents);
      setExpensesCents(result.expensesCents);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => { void load(); }, [eventId]);
  const addEntry = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cents = Math.round(Number(amount.replace(",", ".")) * 100);
    if (!Number.isSafeInteger(cents) || cents < 1) { setError("Bitte einen gültigen Betrag eingeben."); return; }
    setBusy(true); setError("");
    try {
      await request("/api/staff/finance", {
        method: "POST", body: JSON.stringify({ kind, amountCents: cents, description, entryDate }),
      }, eventId);
      setAmount(""); setDescription("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return <>
    <PageHeading eyebrow="KASSENBUCH" title="Finanzen" detail="Bezahlte Bestellungen werden automatisch als Einnahmen berücksichtigt." />
    <div className="metric-grid finance-metrics">
      <MetricCard label="Bezahlte Bestellungen" value={euro(paidSalesCents)} detail="inklusive Trinkgeld" icon={Banknote} tone="tone-green" />
      <MetricCard label="Weitere Einnahmen" value={euro(manualIncomeCents)} detail="Manuell erfasst" icon={ArrowDownLeft} tone="tone-blue" />
      <MetricCard label="Ausgaben" value={euro(expensesCents)} detail="Manuell erfasst" icon={ArrowRight} tone="tone-coral" />
      <MetricCard label="Zwischensaldo" value={euro(paidSalesCents + manualIncomeCents - expensesCents)} detail="Vorläufige Übersicht" icon={ReceiptText} tone="tone-amber" />
    </div>
    {canEdit && <form className="panel admin-form-panel finance-form" onSubmit={addEntry}>
      <h2>Einnahme oder Ausgabe eintragen</h2>
      <div className="form-row">
        <label className="field-label">Art<select className="text-input" value={kind} onChange={(event) => setKind(event.target.value as "income" | "expense")}><option value="expense">Ausgabe</option><option value="income">Weitere Einnahme</option></select></label>
        <label className="field-label">Betrag in Euro<input className="text-input" inputMode="decimal" required value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0,00" /></label>
        <label className="field-label">Datum<input className="text-input" type="date" required value={entryDate} onChange={(event) => setEntryDate(event.target.value)} /></label>
      </div>
      <label className="field-label">Beschreibung<input className="text-input" required minLength={1} maxLength={240} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="z. B. Einkauf Getränke" /></label>
      {error && <p className="inline-error">{error}</p>}
      <button className="primary-button" disabled={busy}>{busy ? "Wird gebucht …" : "Eintrag speichern"} <Plus size={16} /></button>
    </form>}
    {!canEdit && error && <p className="inline-error">{error}</p>}
    <section className="panel admin-list-panel">
      <div className="panel-heading"><div><span className="eyebrow">MANUELLE BUCHUNGEN</span><h2>Einnahmen und Ausgaben</h2></div></div>
      {entries.map((entry) => <div className="finance-entry" key={entry.id}><span className={`finance-entry-kind ${entry.kind}`}>{entry.kind === "income" ? "Einnahme" : "Ausgabe"}</span><div><strong>{entry.description}</strong><small>{new Date(`${entry.entry_date}T00:00:00`).toLocaleDateString("de-DE")} · {entry.created_by}</small></div><strong className={entry.kind === "expense" ? "expense-amount" : "income-amount"}>{entry.kind === "expense" ? "−" : "+"}{euro(entry.amount_cents)}</strong></div>)}
      {!entries.length && <p className="muted-copy">Noch keine manuellen Buchungen.</p>}
    </section>
  </>;
}

function AdminUsersView({ currentUsername, canCreateAdmin }: { currentUsername: string; canCreateAdmin: boolean }) {
    type UserRecord = { username: string; role: "admin" | "staff"; role_id: string | null; active: boolean; created_at?: string };
    const [users, setUsers] = useState<UserRecord[]>([]);
    const [roles, setRoles] = useState<StaffRole[]>([]);
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [roleId, setRoleId] = useState("");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const loadUsers = async () => {
      try {
        const [usersResult, rolesResult] = await Promise.all([
          request<{ users: UserRecord[] }>("/api/staff/users"),
          request<{ roles: StaffRole[] }>("/api/staff/roles"),
        ]);
        setUsers(usersResult.users);
        setRoles(rolesResult.roles);
        setRoleId((current) => current || rolesResult.roles.find((roleItem) => !roleItem.is_admin)?.id || "");
        setError("");
      } catch (e) {
        setError((e as Error).message);
      }
    };
    useEffect(() => { void loadUsers(); }, []);
    const createUser = async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setBusy(true);
      setError("");
      try {
        await request("/api/staff/users", {
          method: "POST",
          body: JSON.stringify({ username, password, roleId }),
        });
        setUsername("");
        setPassword("");
        await loadUsers();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    };
    const setActive = async (user: UserRecord) => {
      try {
        await request(`/api/staff/users/${encodeURIComponent(user.username)}`, {
          method: "PATCH",
          body: JSON.stringify({ active: !user.active }),
        });
        await loadUsers();
      } catch (e) {
        setError((e as Error).message);
      }
    };
    const setUserRole = async (user: UserRecord) => {
      try {
        await request(`/api/staff/users/${encodeURIComponent(user.username)}`, {
          method: "PATCH", body: JSON.stringify({ roleId: user.role_id }),
        });
        await loadUsers();
      } catch (e) {
        setError((e as Error).message);
      }
    };
    return <>
      <PageHeading eyebrow="ZUGÄNGE" title="Benutzer" detail="Konten für den Personalbereich verwalten." />
      <form className="panel admin-form-panel" onSubmit={createUser}>
        <h2>Benutzer anlegen</h2>
        <div className="form-row">
          <label className="field-label">Benutzername<input className="text-input" required minLength={3} maxLength={64} autoComplete="off" value={username} onChange={(event) => setUsername(event.target.value)} /></label>
          <label className="field-label">Rolle<select className="text-input" required value={roleId} onChange={(event) => setRoleId(event.target.value)}>{roles.filter((item) => !item.is_admin || canCreateAdmin).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        </div>
        <label className="field-label">Startpasswort<input className="text-input" required type="password" minLength={12} maxLength={128} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /><small>Mindestens 12 Zeichen. Teile das Passwort sicher mit der Person.</small></label>
        {error && <p className="inline-error">{error}</p>}
        <button className="primary-button" disabled={busy}>{busy ? "Wird angelegt …" : "Benutzer anlegen"} <Plus size={16} /></button>
      </form>
      <section className="panel admin-list-panel">
        <div className="panel-heading"><div><span className="eyebrow">PERSONAL</span><h2>Vorhandene Benutzer</h2></div></div>
        {users.map((user) => <div className="admin-list-row" key={user.username}>
          <div><strong>{user.username}</strong><small>{roles.find((roleItem) => roleItem.id === user.role_id)?.name ?? (user.role === "admin" ? "Administrator" : "Personal")}{user.username === currentUsername ? " · Du" : ""}</small></div>
          {user.username !== currentUsername && <select aria-label={`Rolle für ${user.username}`} className="text-input user-role-picker" value={user.role_id ?? "personal"} onChange={(event) => void setUserRole({ ...user, role_id: event.target.value })} disabled={user.role === "admin" && !canCreateAdmin}>{roles.filter((item) => !item.is_admin || canCreateAdmin).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
          <span className={`record-state ${user.active ? "record-active" : "record-blocked"}`}>{user.active ? "Aktiv" : "Gesperrt"}</span>
          <button className="subtle-button" disabled={user.username === currentUsername} onClick={() => void setActive(user)}>{user.active ? "Sperren" : "Freigeben"}</button>
        </div>)}
      </section>
    </>;
}

function CustomersView({ canManage }: { canManage: boolean }) {
    const [customers, setCustomers] = useState<CustomerRecord[]>([]);
    const [query, setQuery] = useState("");
    const [search, setSearch] = useState("");
    const [error, setError] = useState("");
    const loadCustomers = async (customerQuery: string) => {
      try {
        const result = await request<{ customers: CustomerRecord[] }>(`/api/staff/customers${customerQuery ? `?q=${encodeURIComponent(customerQuery)}` : ""}`);
        setCustomers(result.customers);
        setError("");
      } catch (e) {
        setError((e as Error).message);
      }
    };
    useEffect(() => { void loadCustomers(""); }, []);
    const toggleBan = async (customer: CustomerRecord) => {
      const reason = customer.banned ? "" : window.prompt(`Grund für die Sperre von Kunde ${customer.customer_number}:`);
      if (!customer.banned && reason === null) return;
      if (!customer.banned && !reason?.trim()) {
        setError("Bitte einen Grund für die Sperre angeben.");
        return;
      }
      try {
        await request(`/api/staff/customers/${customer.id}`, {
          method: "PATCH",
          body: JSON.stringify({ banned: !customer.banned, reason: reason ?? "" }),
        });
        await loadCustomers(search);
      } catch (e) {
        setError((e as Error).message);
      }
    };
    return <>
      <PageHeading eyebrow="BESTELLER" title="Kundenakten" detail="Kundennummern und zugehörige Bestellungen. Es werden keine IP-Adressen angezeigt." />
      <form className="customer-search" onSubmit={(event) => { event.preventDefault(); setSearch(query.trim()); void loadCustomers(query.trim()); }}>
        <label className="field-label">Nach Kundennummer suchen<input className="text-input" inputMode="numeric" placeholder="z. B. 00001" value={query} onChange={(event) => setQuery(event.target.value.replace(/\D/g, ""))} /></label>
        <button className="primary-button"><ShoppingBag size={16} /> Suchen</button>
        {search && <button type="button" className="subtle-button" onClick={() => { setSearch(""); setQuery(""); void loadCustomers(""); }}>Alle anzeigen</button>}
      </form>
      {error && <div className="notice error-notice">{error}</div>}
      <section className="customer-list">
        {customers.map((customer) => <article className="panel customer-card" key={customer.id}>
          <header className="customer-card-header">
            <div><span className="eyebrow">KUNDENNUMMER</span><h2>{customer.customer_number}</h2><small>Seit {new Date(`${customer.created_at.replace(" ", "T")}Z`).toLocaleDateString("de-DE")}</small></div>
            <span className={`record-state ${customer.banned ? "record-blocked" : "record-active"}`}>{customer.banned ? "Gesperrt" : "Aktiv"}</span>
            {canManage && <button className={customer.banned ? "subtle-button" : "danger-button"} onClick={() => void toggleBan(customer)}>{customer.banned ? "Sperre aufheben" : "Bestellen sperren"}</button>}
          </header>
          {customer.banned && customer.ban_reason && <p className="ban-reason">Grund: {customer.ban_reason}</p>}
          <div className="customer-orders">
            <strong>{customer.orders.length} Bestellungen</strong>
            {customer.orders.map((order) => <div className="customer-order-row" key={order.id}>
              <span>#{shortId(order.id)} · {new Date(`${order.created_at.replace(" ", "T")}Z`).toLocaleString("de-DE")}</span>
              <strong>{euro(order.total_cents)}</strong>
              <span>{order.canceled_at ? "Storniert" : order.status === "paid" ? "Bezahlt" : "Offen"}</span>
            </div>)}
            {!customer.orders.length && <span className="muted-copy">Noch keine Bestellungen.</span>}
          </div>
        </article>)}
        {!customers.length && <EmptyPanel icon={ShoppingBag} title="Keine Kundenakten gefunden" text="Kundenakten entstehen mit der ersten Bestellung." />}
      </section>
    </>;
}

function OrderHistoryView({ eventId, canCancel, onReceipt }: { eventId: number; canCancel: boolean; onReceipt: (order: Order) => void }) {
    const [orders, setOrders] = useState<Order[]>([]);
    const [query, setQuery] = useState("");
    const [error, setError] = useState("");
    const loadHistory = async () => {
      try {
        const result = await request<{ orders: Order[] }>("/api/staff/orders/history", {}, eventId);
        setOrders(result.orders);
        setError("");
      } catch (e) {
        setError((e as Error).message);
      }
    };
    useEffect(() => { void loadHistory(); }, [eventId]);
    const cancelOrder = async (order: Order) => {
      const reason = window.prompt(`Stornogrund für Bestellung #${shortId(order.id)}. Eine Rückzahlung wird hier nicht ausgeführt:`);
      if (reason === null) return;
      if (reason.trim().length < 3) {
        setError("Bitte einen Stornogrund mit mindestens 3 Zeichen angeben.");
        return;
      }
      try {
        await request(`/api/staff/orders/${encodeURIComponent(order.id)}/cancel`, {
          method: "POST",
          body: JSON.stringify({ reason }),
        }, eventId);
        await loadHistory();
      } catch (e) {
        setError((e as Error).message);
      }
    };
    const filteredOrders = orders.filter((order) => order.id.toLowerCase().includes(query.toLowerCase()) || shortId(order.id).includes(query.toUpperCase()));
    return <>
      <PageHeading eyebrow="KASSE" title="Belege" detail="Belege früherer Bestellungen ansehen oder mit Grund stornieren. Eine Rückzahlung muss separat erfolgen." />
      <label className="field-label history-search">Bestellnummer suchen<input className="text-input" placeholder="Bestellnummer" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      {error && <div className="notice error-notice">{error}</div>}
      <section className="panel history-panel">
        {filteredOrders.length ? filteredOrders.map((order) => <article className="history-row" key={order.id}>
          <div><strong>#{shortId(order.id)}</strong><small>{order.table_name} · {new Date(`${order.created_at.replace(" ", "T")}Z`).toLocaleString("de-DE")}</small></div>
          <div><strong>{euro(order.total_cents + (order.status === "paid" ? order.tip_cents : 0))}</strong><small>{order.canceled_at ? `Storniert: ${order.cancellation_reason}` : order.status === "paid" ? "Bezahlt" : "Noch offen"}</small></div>
          <button className="subtle-button" onClick={() => onReceipt(order)}><ReceiptText size={15} /> Beleg ansehen</button>
          {canCancel && !order.canceled_at && <button className="danger-button" onClick={() => void cancelOrder(order)}>Stornieren</button>}
        </article>) : <EmptyPanel icon={ReceiptText} title="Keine Belege gefunden" text="Für diese Suche gibt es keine Bestellungen." />}
      </section>
    </>;
}

function EventSettingsView({ eventId, eventSlug, eventName, onSaved }: { eventId: number; eventSlug: string; eventName: string; onSaved: (name: string) => void }) {
    const [name, setName] = useState(eventName);
    const [welcomeText, setWelcomeText] = useState("");
    const [accentColor, setAccentColor] = useState("#963b35");
    const [error, setError] = useState("");
    const [saved, setSaved] = useState(false);
    useEffect(() => {
      setName(eventName);
      void request<PublicData>(`/api/public/${encodeURIComponent(eventSlug)}`)
        .then((data) => { setWelcomeText(data.welcomeText); setAccentColor(data.accentColor); })
        .catch((e: Error) => setError(e.message));
    }, [eventId, eventSlug, eventName]);
    const save = async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setError("");
      setSaved(false);
      try {
        await request(`/api/staff/events/${eventId}`, {
          method: "PATCH",
          body: JSON.stringify({ name, welcomeText, accentColor }),
        });
        onSaved(name);
        setSaved(true);
      } catch (e) {
        setError((e as Error).message);
      }
    };
    return <>
      <PageHeading eyebrow="DARSTELLUNG" title="Webseite" detail="Veranstaltungsname, Begrüßung und Akzentfarbe auf der Speisekarte ändern." />
      <form className="panel admin-form-panel" onSubmit={save}>
        <label className="field-label">Veranstaltungsname<input className="text-input" required minLength={2} maxLength={80} value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className="field-label">Begrüßungstext<input className="text-input" required maxLength={180} value={welcomeText} onChange={(event) => setWelcomeText(event.target.value)} /></label>
        <label className="field-label color-field">Akzentfarbe<input type="color" value={accentColor} onChange={(event) => setAccentColor(event.target.value)} /><span>{accentColor.toUpperCase()}</span></label>
        {error && <p className="inline-error">{error}</p>}
        {saved && <p className="save-confirmation">Änderungen gespeichert.</p>}
        <button className="primary-button">Änderungen speichern <Check size={16} /></button>
      </form>
    </>;
}

function ProductModal({ product, eventId, onClose, onSaved }: { product: Product | null; eventId: number; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(product?.name ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [category, setCategory] = useState(product?.category ?? "Speisen");
  const [price, setPrice] = useState(product ? (product.price_cents / 100).toFixed(2).replace(".", ",") : "");
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    const parsedPrice = Number(price.replace(",", "."));
    if (!Number.isFinite(parsedPrice) || parsedPrice < 0 || parsedPrice > 1000) { setError("Bitte einen gültigen Preis eingeben."); setBusy(false); return; }
    try {
      await request(product ? `/api/staff/products/${product.id}` : "/api/staff/products", {
        method: product ? "PATCH" : "POST",
        body: JSON.stringify({ name, description, category, priceCents: Math.round(parsedPrice * 100), available: Boolean(product?.available ?? true) }),
      }, eventId);
      onSaved();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return <ModalShell onClose={onClose}><form className="modal-card" onSubmit={save}><div className="modal-top"><span className="modal-icon"><Soup size={20} /></span><button type="button" className="close-button" onClick={onClose}><X size={19} /></button></div><span className="eyebrow">{product ? "PRODUKT BEARBEITEN" : "NEUES PRODUKT"}</span><h2>{product ? "Produkt bearbeiten" : "Produkt hinzufügen"}</h2><label className="field-label">Produktname<input className="text-input" required maxLength={80} placeholder="z. B. Bratwurst im Weckle" value={name} onChange={(e) => setName(e.target.value)} /></label><label className="field-label">Beschreibung<input className="text-input" maxLength={240} placeholder="Beschreibung für die Speisekarte" value={description} onChange={(e) => setDescription(e.target.value)} /></label><div className="form-row"><label className="field-label">Kategorie<input className="text-input" required maxLength={40} value={category} onChange={(e) => setCategory(e.target.value)} /></label><label className="field-label">Preis in Euro<input className="text-input" required inputMode="decimal" placeholder="4,50" value={price} onChange={(e) => setPrice(e.target.value)} /></label></div>{error && <p className="inline-error">{error}</p>}<div className="modal-actions"><button type="button" className="subtle-button" onClick={onClose}>Abbrechen</button><button className="primary-button" disabled={busy}>{busy ? "Wird gespeichert …" : "Speichern"} <Check size={16} /></button></div></form></ModalShell>;
}
function TableModal({ eventId, onClose, onSaved }: { eventId: number; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(""); const [error, setError] = useState("");
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setError("");
    try { await request("/api/staff/tables", { method: "POST", body: JSON.stringify({ name }) }, eventId); onSaved(); }
    catch (e) { setError((e as Error).message); }
  };
  return <ModalShell onClose={onClose}><form className="modal-card" onSubmit={save}><div className="modal-top"><span className="modal-icon"><Utensils size={20} /></span><button type="button" className="close-button" onClick={onClose}><X size={19} /></button></div><span className="eyebrow">TISCHE</span><h2>Tisch hinzufügen</h2><p className="modal-description">Für den Tisch wird ein eigener QR-Code erstellt.</p><label className="field-label">Tischname<input autoFocus className="text-input" required maxLength={40} placeholder="z. B. Bierbank links" value={name} onChange={(e) => setName(e.target.value)} /></label>{error && <p className="inline-error">{error}</p>}<div className="modal-actions"><button type="button" className="subtle-button" onClick={onClose}>Abbrechen</button><button className="primary-button">Tisch hinzufügen <Plus size={16} /></button></div></form></ModalShell>;
}
function EventModal({ onClose, onSaved }: { onClose: () => void; onSaved: (event: EventSummary) => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async (formEvent: React.FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await request<{ event: EventSummary }>("/api/staff/events", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      onSaved(result.event);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return <ModalShell onClose={onClose}><form className="modal-card" onSubmit={save}><div className="modal-top"><span className="modal-icon"><Flame size={20} /></span><button type="button" className="close-button" onClick={onClose}><X size={19} /></button></div><span className="eyebrow">VERANSTALTUNG</span><h2>Veranstaltung hinzufügen</h2><p className="modal-description">Für jede Veranstaltung gibt es eine eigene Speisekarte, Tische und Bestellungen.</p><label className="field-label">Name der Veranstaltung<input autoFocus className="text-input" required minLength={2} maxLength={80} placeholder="z. B. Sommerfest 2027" value={name} onChange={(e) => setName(e.target.value)} /></label>{error && <p className="inline-error">{error}</p>}<div className="modal-actions"><button type="button" className="subtle-button" onClick={onClose}>Abbrechen</button><button className="primary-button" disabled={busy}>{busy ? "Wird erstellt …" : "Hinzufügen"} <Plus size={16} /></button></div></form></ModalShell>;
}
function QRModal({ table, eventSlug, onClose }: { table: Table; eventSlug: string; onClose: () => void }) {
  const link = `${window.location.origin}/e/${encodeURIComponent(eventSlug)}?t=${table.id}`;
  return <ModalShell onClose={onClose}><div className="modal-card qr-modal"><div className="modal-top"><span className="modal-icon"><QrCode size={20} /></span><button className="close-button no-print" onClick={onClose}><X size={19} /></button></div><span className="eyebrow">QR-CODE</span><h2>{table.name}</h2><p className="modal-description">Der QR-Code öffnet die Speisekarte für diesen Tisch.</p><div className="qr-code-wrap"><QRCodeSVG value={link} size={206} level="H" includeMargin fgColor="#29291f" /></div><span className="qr-link">{link}</span><div className="modal-actions no-print"><button className="subtle-button" onClick={() => void navigator.clipboard.writeText(link)}>Link kopieren</button><button className="primary-button" onClick={() => window.print()}><Printer size={16} /> QR-Code drucken</button></div></div></ModalShell>;
}
function PaymentModal({ order, onClose, onPay }: { order: Order; onClose: () => void; onPay: (tip: number) => void }) {
  const [tip, setTip] = useState("0"); const tipCents = Math.round(Math.max(0, Number(tip.replace(",", ".")) || 0) * 100);
  return <ModalShell onClose={onClose}><div className="modal-card"><div className="modal-top"><span className="modal-icon cash-modal-icon"><Banknote size={20} /></span><button className="close-button" onClick={onClose}><X size={19} /></button></div><span className="eyebrow">BARZAHLUNG</span><h2>Zu zahlen: {euro(order.total_cents + tipCents)}</h2><p className="modal-description">{order.table_name} · Bestellung #{shortId(order.id)} · Warenwert {euro(order.total_cents)}</p><label className="field-label">Trinkgeld in Euro<input autoFocus className="text-input" inputMode="decimal" placeholder="0,00" value={tip} onChange={(e) => setTip(e.target.value)} /></label><div className="payment-total"><span>Gesamtbetrag</span><strong>{euro(order.total_cents + tipCents)}</strong></div><div className="modal-actions"><button className="subtle-button" onClick={onClose}>Zurück</button><button className="primary-button" onClick={() => onPay(tipCents)}><Check size={16} /> Zahlung bestätigen</button></div></div></ModalShell>;
}
function ReceiptModal({ order, venueName, onClose }: { order: Order; venueName: string; onClose: () => void }) {
  const receiptDate = order.paid_at ?? order.created_at;
  const formattedDate = new Date(receiptDate.endsWith("Z") ? receiptDate : `${receiptDate.replace(" ", "T")}Z`);
  return (
    <ModalShell onClose={onClose}>
      <div className="modal-card receipt-modal">
        <div className="receipt-top">
          <div className="receipt-brand"><Flame size={16} /> {venueName}</div>
          <strong className="receipt-heading">{order.canceled_at ? "Stornobeleg" : order.status === "paid" ? "Kassenbeleg" : "Bestellübersicht"}</strong>
        </div>
        <div className="receipt-rule" />
        <div className="receipt-meta">
          <span>Bestellung #{shortId(order.id)}</span>
          <span>{order.table_name}</span>
          <span>{formattedDate.toLocaleString("de-DE")}</span>
          {order.status === "paid" && <span>Zahlungsart: Bar</span>}
        </div>
        <div className="receipt-rule" />
        {order.items.map((item, index) => (
          <div className="receipt-item" key={`${item.product_name}-${index}`}>
            <div className="receipt-line">
              <span>{item.product_name}</span>
              <strong>{euro(item.quantity * item.unit_price_cents)}</strong>
            </div>
            <small>{item.quantity} × {euro(item.unit_price_cents)}</small>
          </div>
        ))}
        <div className="receipt-rule" />
        <div className="receipt-line"><span>Warenwert</span><strong>{euro(order.total_cents)}</strong></div>
        {order.tip_cents > 0 && (
          <div className="receipt-line"><span>Trinkgeld</span><strong>{euro(order.tip_cents)}</strong></div>
        )}
        <div className="receipt-rule" />
        <div className="receipt-total">
          <span>Gesamtbetrag</span>
          <strong>{euro(order.total_cents + order.tip_cents)}</strong>
        </div>
        {order.canceled_at && <p className="receipt-legal">Storniert von {order.canceled_by ?? "Administrator"} am {new Date(order.canceled_at).toLocaleString("de-DE")}<br />Grund: {order.cancellation_reason}</p>}
        <p className="receipt-legal">{order.canceled_at ? "Storniert · ursprünglicher Beleg bleibt erhalten" : order.status === "paid" ? "Zahlungsbeleg · kein TSE-Kassenbeleg" : "Bestellübersicht · noch nicht bezahlt"}</p>
        <div className="modal-actions no-print">
          <button className="subtle-button" onClick={onClose}>Schließen</button>
          <button className="primary-button" onClick={() => window.print()}><Printer size={16} /> {order.status === "paid" ? "Beleg drucken" : "Übersicht drucken"}</button>
        </div>
      </div>
    </ModalShell>
  );
}
function ModalShell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><div className="modal-position">{children}</div></div>;
}

export default App;
