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
  total_cents: number; tip_cents: number; created_at: string; paid_at: string | null; items: OrderItem[];
};
type EventSummary = { id: number; name: string; slug: string; created_at: string };
type PublicData = { venueName: string; eventSlug: string; products: Product[]; tables: Table[] };

const euro = (cents: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(cents / 100);
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
  return eventSlug ? <GuestApp eventSlug={eventSlug} requestedTable={Number(tableParam)} /> : <StaffApp />;
}

function LegalPage({ kind }: { kind: "imprint" | "privacy" }) {
  const isImprint = kind === "imprint";
  return <main className="legal-page">
    <header className="guest-header"><a className="brand" href="/"><span className="brand-mark"><Utensils size={18} /></span><span>tischzeit</span></a><a className="text-button" href="/">Zurück zur Startseite <ArrowLeft size={15} /></a></header>
    <article className="legal-content"><span className="eyebrow">TISCHZEIT · MUSTERVORLAGE</span><h1>{isImprint ? "Impressum" : "Datenschutzerklärung"}<span className="title-period">.</span></h1><div className="legal-notice"><CircleHelp size={19} /><p><strong>Bitte vor dem Einsatz ausfüllen.</strong> Diese Vorlage ist keine Rechtsberatung. Ersetze alle Angaben in eckigen Klammern durch die tatsächlichen Veranstalterdaten und lass die Texte bei Bedarf rechtlich prüfen.</p></div>
      {isImprint ? <>
        <h2>Angaben gemäß § 5 DDG</h2><p>[Name des Vereins / Veranstalters]<br />[Vertretungsberechtigte Person]<br />[Straße und Hausnummer]<br />[PLZ und Ort]</p>
        <h2>Kontakt</h2><p>Telefon: [Telefonnummer]<br />E-Mail: [E-Mail-Adresse]</p>
        <h2>Verantwortlich für den Inhalt</h2><p>[Name und Anschrift der verantwortlichen Person]</p>
        <h2>Hinweis zum Veranstaltungsangebot</h2><p>Die Speisekarte und die Bestellmöglichkeit auf dieser Website beziehen sich auf das Angebot des oben genannten Veranstalters. Die Bestellung wird erst mit Annahme durch den Veranstalter verbindlich.</p>
      </> : <>
        <h2>1. Verantwortlicher</h2><p>[Name des Vereins / Veranstalters]<br />[Anschrift]<br />E-Mail: [E-Mail-Adresse]</p>
        <h2>2. Welche Daten wir verarbeiten</h2><p>Bei einer Bestellung verarbeiten wir die ausgewählten Produkte, einen optionalen Sonderwunsch, die Tischzuordnung und eine zufällig erzeugte Bestellnummer, um die Bestellung zuzubereiten und abzurechnen. Die Anwendung erstellt keine Kundenkonten und fragt keine Namen oder Kontaktdaten von Gästen ab.</p>
        <h2>3. Zweck und Rechtsgrundlage</h2><p>Wir verarbeiten Bestelldaten zur Durchführung der Bestellung und Abrechnung (Art. 6 Abs. 1 lit. b DSGVO). Technisch notwendige Serverprotokolle können zur sicheren Bereitstellung und Fehleranalyse verarbeitet werden (Art. 6 Abs. 1 lit. f DSGVO).</p>
        <h2>4. Speicherdauer</h2><p>Bestellungen werden lokal in der Datenbank des Veranstalters gespeichert. Bitte legen Sie vor dem produktiven Einsatz eine angemessene Aufbewahrungs- und Löschfrist fest. Gesetzliche Aufbewahrungspflichten für Abrechnungsunterlagen bleiben unberührt.</p>
        <h2>5. Hosting und Empfänger</h2><p>Im vorgesehenen lokalen Betrieb verbleiben die Daten auf dem Server, auf dem die Anwendung installiert wurde. [Hosting-Anbieter und Drittlandübermittlungen ergänzen, falls zutreffend.]</p>
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { request<PublicData>(`/api/public/${encodeURIComponent(eventSlug)}`).then(setData).catch((e: Error) => setError(e.message)); }, [eventSlug]);
  const categories = useMemo(() => ["Alles", ...new Set(data?.products.map((p) => p.category) ?? [])], [data]);
  const visibleProducts = data?.products.filter((p) => category === "Alles" || p.category === category) ?? [];
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
      const result = await request<{ order: Order }>(`/api/events/${encodeURIComponent(eventSlug)}/orders`, {
        method: "POST",
        body: JSON.stringify({
          tableId,
          items: Object.entries(cart).map(([productId, quantity]) => ({ productId: Number(productId), quantity, note: notes[Number(productId)] ?? "" })),
        }),
      });
      setOrder(result.order);
      setCart({});
      setNotes({});
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  if (!data && !error) return <div className="loading"><div className="brand-mark"><Utensils size={19} /></div><span>Die Karte wird gedeckt …</span></div>;
  if (order) return <GuestConfirmation order={order} venueName={data?.venueName ?? "Tischzeit"} onMore={() => setOrder(null)} />;

  return (
    <main className="guest-page">
      <header className="guest-header">
        <a className="brand" href="/"><span className="brand-mark"><Utensils size={18} /></span><span>tischzeit</span></a>
        <span className="guest-event-name">{data?.venueName ?? "Speisekarte"}</span>
      </header>
      <section className="guest-hero">
        <div className="hero-copy">
          <span className="eyebrow"><span className="eyebrow-line" /> SPEISEKARTE</span>
          <h1 className="venue-title">{data?.venueName ?? "Tischzeit"}<br /><em>Speisekarte.</em></h1>
          <p>Wähle deine Bestellung. Bezahlt wird später an der Kasse.</p>
          <label className="table-select"><Utensils size={17} /><span>Dein Platz</span>
            <select value={tableId} onChange={(event) => setTableId(Number(event.target.value))}>
              {data?.tables.map((table) => <option key={table.id} value={table.id}>{table.name}</option>)}
            </select><ChevronDown size={15} />
          </label>
        </div>
        <div className="hero-art" aria-label="Illustration von Getränken und Abendessen">
          <div className="sun-orb" /><div className="hero-plate"><div className="plate-center"><span>GUT</span><span>ESSEN</span></div></div>
          <div className="hero-glass glass-one"><Beer size={30} /></div><div className="hero-glass glass-two"><Coffee size={23} /></div>
          <div className="art-caption"><span className="caption-dot" /> UNSER ANGEBOT</div>
        </div>
      </section>
      <section className="menu-section">
        <div className="section-title"><div><span className="eyebrow">{data?.venueName ?? "Tischzeit"}</span><h2>Speisekarte<span className="title-period">.</span></h2></div><span className="menu-count">{data?.products.length ?? 0} Produkte</span></div>
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
      <footer className="guest-footer"><a className="brand" href={`/e/${encodeURIComponent(eventSlug)}?t=${tableId}`}><span className="brand-mark"><Utensils size={16} /></span><span>tischzeit</span></a><span>{data?.venueName} · <a href="/impressum">Impressum</a> · <a href="/datenschutz">Datenschutz</a></span></footer>
      {cartCount > 0 && <div className="cart-bar"><div className="cart-summary"><span className="cart-count">{cartCount}</span><span>Artikel</span><strong>{euro(total)}</strong></div><button className="primary-button" onClick={submitOrder} disabled={busy}>{busy ? "Wird gesendet …" : <>Bestellung abschicken <ArrowRight size={17} /></>}</button></div>}
    </main>
  );
}

function GuestConfirmation({ order, venueName, onMore }: { order: Order; venueName: string; onMore: () => void }) {
  return <main className="confirmation-page">
    <a className="brand" href="/"><span className="brand-mark"><Utensils size={18} /></span><span>tischzeit</span></a>
    <div className="confirmation-card"><div className="confirmation-icon"><BadgeCheck size={34} /></div><span className="eyebrow">BESTELLUNG EINGEGANGEN</span><h1>Danke für<br /><em>deine Bestellung.</em></h1><p>Die Küche hat deine Bestellung erhalten. Sie wird an deinen Tisch gebracht.</p>
      <div className="confirmation-details"><span>Deine Bestellung <strong>#{shortId(order.id)}</strong></span><span>{order.table_name}</span><hr />{order.items.map((item, i) => <span key={`${item.product_name}-${i}`}>{item.quantity} × {item.product_name}<strong>{euro(item.quantity * item.unit_price_cents)}</strong></span>)}<hr /><span>Gesamtbetrag<strong>{euro(order.total_cents)}</strong></span></div>
      <div className="cash-note"><Banknote size={18} /><span>Die Zahlung erfolgt bar an der Kasse.</span></div><button className="text-button" onClick={onMore}>Weitere Bestellung <ArrowRight size={16} /></button>
    </div><span className="confirmation-venue">{venueName} · Schönen Abend!</span>
  </main>;
}

type StaffTab = "orders" | "kitchen" | "cash" | "menu" | "tables";
function StaffApp() {
  const [username, setUsername] = useState(localStorage.getItem("staff-username") ?? "");
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
    void refreshEvents().then(() => setLoggedIn(true)).catch(() => setLoggedIn(false));
  }, [refreshEvents]);

  const loadAll = useCallback(async () => {
    if (!activeEventId) return;
    try {
      const [orderData, productData, tableData] = await Promise.all([
        request<{ orders: Order[] }>("/api/staff/orders", {}, activeEventId),
        request<{ products: Product[] }>("/api/staff/products", {}, activeEventId),
        request<{ tables: Table[] }>("/api/staff/tables", {}, activeEventId),
      ]);
      setOrders(orderData.orders); setProducts(productData.products); setTables(tableData.tables); setError("");
    } catch (e) {
      setError((e as Error).message);
      if ((e as Error).message.includes("Sitzung") || (e as Error).message.includes("anmelden")) setLoggedIn(false);
    }
  }, [activeEventId]);
  useEffect(() => { if (isLoggedIn) void loadAll(); }, [isLoggedIn, loadAll]);
  useEffect(() => {
    if (!isLoggedIn) return;
    const timer = window.setInterval(() => { void loadAll(); }, 5000);
    return () => window.clearInterval(timer);
  }, [isLoggedIn, loadAll]);

  const login = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError("");
    try {
      await request("/api/staff/login", { method: "POST", body: JSON.stringify({ username, password }) });
      localStorage.setItem("staff-username", username);
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

  if (!isLoggedIn) return <main className="login-page"><div className="login-brand brand"><span className="brand-mark"><Utensils size={18} /></span><span>tischzeit</span><span className="staff-pill">PERSONAL</span></div><form className="login-card" onSubmit={login}><div className="login-icon"><LayoutDashboard size={24} /></div><span className="eyebrow">SCHÖN, DASS DU DA BIST</span><h1>Der Überblick<span className="title-period">.</span></h1><p>Melde dich mit deinem Veranstalter-Konto an.</p><label className="field-label" htmlFor="staff-username">Benutzername<input autoFocus id="staff-username" className="text-input" autoComplete="username" required maxLength={64} value={username} onChange={(e) => setUsername(e.target.value)} /></label><label className="field-label" htmlFor="staff-password">Passwort<input id="staff-password" className="text-input" autoComplete="current-password" required type="password" maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} /></label><button className="primary-button full-button">Anmelden <ArrowRight size={17} /></button>{error && <p className="inline-error">{error}</p>}</form></main>;

  if (!activeEvent) return <main className="loading"><div className="brand-mark"><Utensils size={19} /></div><span>Veranstaltungen werden geladen …</span></main>;

  const activeOrders = orders.filter((order) => order.status !== "paid");
  const due = orders.filter((order) => order.status === "ready").reduce((sum, order) => sum + order.total_cents, 0);
  const nav: Array<{ id: StaffTab; label: string; icon: typeof LayoutDashboard; count?: number }> = [
    { id: "orders", label: "Bestellungen", icon: ShoppingBag, count: activeOrders.filter((o) => o.status === "new").length },
    { id: "kitchen", label: "Küche", icon: ChefHat, count: activeOrders.filter((o) => o.status === "new" || o.status === "preparing").length },
    { id: "cash", label: "Kasse", icon: Banknote, count: orders.filter((o) => o.status === "ready").length },
    { id: "menu", label: "Speisekarte", icon: Soup },
    { id: "tables", label: "Tische & QR", icon: QrCode },
  ];

  return <div className="admin-shell">
    <aside className="sidebar"><a className="brand sidebar-brand" href="/"><span className="brand-mark"><Utensils size={18} /></span><span>tischzeit</span></a><div className="sidebar-label">VERANSTALTUNG</div><div className="event-name"><span className="event-icon"><Flame size={17} /></span><select aria-label="Veranstaltung wählen" value={activeEventId} onChange={(event) => { const id = Number(event.target.value); setActiveEventId(id); localStorage.setItem("active-event-id", String(id)); }} className="event-picker">{events.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select><button className="add-event-button" title="Veranstaltung erstellen" onClick={() => setModal("event")}><Plus size={17} /></button></div><div className="sidebar-label nav-label">ARBEITSBEREICH</div><nav className="side-nav">{nav.map(({ id, label, icon: Icon, count }) => <button key={id} onClick={() => setTab(id)} className={`nav-item ${tab === id ? "selected" : ""}`}><Icon size={17} /><span>{label}</span>{count ? <span className="nav-count">{count}</span> : null}</button>)}</nav><div className="sidebar-bottom"><div className="sidebar-help"><CircleHelp size={17} /><span>Alles im Griff?</span><ArrowRight size={14} /></div><div className="staff-profile"><div className="avatar">{username.slice(0, 2).toUpperCase()}</div><div><strong>{username}</strong><small>Veranstalter</small></div><button title="Abmelden" className="logout-button" onClick={async () => { try { await request("/api/staff/logout", { method: "POST" }); } finally { localStorage.removeItem("staff-username"); setLoggedIn(false); } }}><ArrowDownLeft size={16} /></button></div></div></aside>
    <main className="admin-main"><header className="admin-topbar"><div className="breadcrumb">{activeEvent.name} <span>/</span> {nav.find((item) => item.id === tab)?.label}</div><div className="topbar-right"><span className="open-indicator"><span className="live-dot" /> Betrieb läuft</span><button className="icon-button" title="Aktualisieren" onClick={() => void loadAll()}><Clock3 size={18} /></button><div className="avatar small-avatar">{username.slice(0, 2).toUpperCase()}</div></div></header>
      <div className="admin-content">
        {error && <div className="notice error-notice">{error}<button onClick={() => setError("")}><X size={15} /></button></div>}
        {tab === "orders" && <OrdersView orders={orders} setTab={setTab} />}
        {tab === "kitchen" && <KitchenView orders={activeOrders.filter((order) => order.status === "new" || order.status === "preparing")} updateOrder={updateOrder} />}
        {tab === "cash" && <CashView orders={orders.filter((order) => order.status === "ready")} due={due} onPay={setTipOrder} />}
        {tab === "menu" && <MenuView products={products} onAdd={() => { setEditingProduct(null); setModal("product"); }} onEdit={(product) => { setEditingProduct(product); setModal("product"); }} onToggle={async (product) => {
          try { await request(`/api/staff/products/${product.id}`, { method: "PATCH", body: JSON.stringify({ ...product, priceCents: product.price_cents, available: !product.available }) }, activeEventId); await loadAll(); } catch (e) { setError((e as Error).message); }
        }} />}
        {tab === "tables" && <TablesView tables={tables} onAdd={() => setModal("table")} onQR={(table) => { setSelectedTable(table); setModal("qr"); }} onToggle={async (table) => {
          try { await request(`/api/staff/tables/${table.id}`, { method: "PATCH", body: JSON.stringify({ name: table.name, active: !table.active }) }, activeEventId); await loadAll(); } catch (e) { setError((e as Error).message); }
        }} />}
      </div>
      {modal === "product" && <ProductModal product={editingProduct} eventId={activeEventId} onClose={() => setModal(null)} onSaved={async () => { setModal(null); await loadAll(); }} />}
      {modal === "table" && <TableModal eventId={activeEventId} onClose={() => setModal(null)} onSaved={async () => { setModal(null); await loadAll(); }} />}
      {modal === "event" && <EventModal onClose={() => setModal(null)} onSaved={async (newEvent) => { setEvents((current) => [...current, newEvent]); setActiveEventId(newEvent.id); localStorage.setItem("active-event-id", String(newEvent.id)); setTab("orders"); setModal(null); }} />}
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
  const open = orders.filter((o) => o.status !== "paid");
  const todayTotal = orders.reduce((sum, o) => sum + (o.status === "paid" ? o.total_cents + o.tip_cents : 0), 0);
  const today = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }).format(new Date()).toLocaleUpperCase("de-DE");
  return <><PageHeading eyebrow={today} title="Guten Abend" detail="Hier läuft alles zusammen. Danke, dass du den Laden schmeißt." action={<span className="open-indicator large-indicator"><span className="live-dot" /> Live · aktualisiert sich automatisch</span>} />
    <div className="metric-grid"><MetricCard label="Offene Bestellungen" value={String(open.length).padStart(2, "0")} detail="Warten auf Zubereitung oder Abholung" icon={ShoppingBag} tone="tone-coral" /><MetricCard label="In der Küche" value={String(orders.filter((o) => o.status === "preparing").length).padStart(2, "0")} detail="Gerade in Arbeit" icon={ChefHat} tone="tone-amber" /><MetricCard label="Umsatz heute" value={euro(todayTotal)} detail={`${orders.filter((o) => o.status === "paid").length} bezahlte Bestellungen`} icon={Banknote} tone="tone-green" /><MetricCard label="Wartet auf Kasse" value={String(orders.filter((o) => o.status === "ready").length).padStart(2, "0")} detail="Bereit zum Bezahlen" icon={ReceiptText} tone="tone-blue" /></div>
    <section className="panel recent-panel"><div className="panel-heading"><div><span className="eyebrow">IM ÜBERBLICK</span><h2>Die letzten Bestellungen</h2></div><button className="subtle-button" onClick={() => setTab("kitchen")}>Zur Küche <ArrowRight size={15} /></button></div>
    {orders.length ? <div className="order-table-wrap"><table className="order-table"><thead><tr><th>BESTELLUNG</th><th>TISCH</th><th>INHALT</th><th>BETRAG</th><th>STATUS</th><th>ZEIT</th></tr></thead><tbody>{orders.slice(0, 8).map((order) => <tr key={order.id}><td><strong>#{shortId(order.id)}</strong></td><td>{order.table_name}</td><td className="order-content">{order.items.map((i) => `${i.quantity}× ${i.product_name}`).join(", ")}</td><td><strong>{euro(order.total_cents)}</strong></td><td><StatusBadge status={order.status} /></td><td className="time-cell">{new Date(`${order.created_at.replace(" ", "T")}Z`).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}</td></tr>)}</tbody></table></div> : <EmptyPanel icon={ShoppingBag} title="Noch keine Bestellungen" text="Sobald Gäste bestellen, tauchen sie hier auf." />}</section>
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
  return <><PageHeading eyebrow="KÜCHENPASS" title="Ab an den Grill" detail="Die Bestellungen kommen direkt vom Tisch. Alles im Blick, nichts geht verloren." action={<span className="kitchen-clock"><span className="live-dot" /> LIVE</span>} />
    {orders.length ? <div className="kitchen-grid">{orders.map((order) => <article className={`kitchen-card kitchen-${order.status}`} key={order.id}><header><span className="kitchen-order-id">#{shortId(order.id)}</span><StatusBadge status={order.status} /><span className="kitchen-time">{new Date(`${order.created_at.replace(" ", "T")}Z`).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}</span></header><div className="kitchen-table">{order.table_name}</div><div className="kitchen-items">{order.items.map((item, i) => <div className="kitchen-item" key={`${item.product_name}-${i}`}><strong>{item.quantity}×</strong><span>{item.product_name}{item.note && <small>↳ {item.note}</small>}</span></div>)}</div><div className="kitchen-card-foot"><span>{euro(order.total_cents)}</span>{order.status === "new" ? <button className="primary-button" onClick={() => updateOrder(order, "preparing")}>Zubereitung starten <ArrowRight size={16} /></button> : <button className="ready-button" onClick={() => updateOrder(order, "ready")}><Check size={16} /> Fertig — zur Kasse</button>}</div></article>)}</div> : <EmptyPanel icon={ChefHat} title="Durchatmen, gerade ist alles ruhig" text="Neue Bestellungen erscheinen hier von selbst." />}</>;
}
function CashView({ orders, due, onPay }: { orders: Order[]; due: number; onPay: (order: Order) => void }) {
  return <><PageHeading eyebrow="KASSE" title="Alles bereit" detail="Bestellungen abkassieren, Trinkgeld eintragen und Beleg ausdrucken." /><div className="cash-summary"><div className="cash-summary-icon"><Banknote size={21} /></div><div><small>OFFEN ZUM ABKASSIEREN</small><strong>{euro(due)}</strong></div><span>{orders.length} {orders.length === 1 ? "Bestellung" : "Bestellungen"} bereit</span></div>
    {orders.length ? <div className="cash-list">{orders.map((order) => <article className="cash-card" key={order.id}><div className="cash-card-main"><div className="cash-card-top"><strong>#{shortId(order.id)}</strong><span>{order.table_name}</span><StatusBadge status={order.status} /></div><p>{order.items.map((i) => `${i.quantity}× ${i.product_name}`).join(", ")}</p></div><strong className="cash-total">{euro(order.total_cents)}</strong><button className="primary-button" onClick={() => onPay(order)}><Banknote size={17} /> Bar kassieren</button></article>)}</div> : <EmptyPanel icon={Banknote} title="Gerade nichts abzukassieren" text="Fertige Bestellungen aus der Küche erscheinen hier." />}</>;
}
function MenuView({ products, onAdd, onEdit, onToggle }: { products: Product[]; onAdd: () => void; onEdit: (p: Product) => void; onToggle: (p: Product) => void }) {
  const categories = [...new Set(products.map((p) => p.category))];
  return <><PageHeading eyebrow="ANGEBOT & PREISE" title="Deine Speisekarte" detail="Was es heute gibt — und worauf die Gäste Lust bekommen." action={<button className="primary-button" onClick={onAdd}><Plus size={17} /> Produkt hinzufügen</button>} />
    {products.length ? categories.map((category) => <section className="panel menu-admin-panel" key={category}><div className="menu-category-heading"><span>{category}</span><span>{products.filter((p) => p.category === category).length} Produkte</span></div>{products.filter((p) => p.category === category).map((product) => <div className={`menu-admin-row ${!product.available ? "unavailable" : ""}`} key={product.id}><div className="menu-admin-icon">{product.category.toLowerCase().includes("getränk") ? <Beer size={19} /> : <Soup size={19} />}</div><div className="menu-admin-info"><strong>{product.name}</strong><span>{product.description || "Keine Beschreibung"}</span></div><strong className="menu-admin-price">{euro(product.price_cents)}</strong><button className={`toggle-switch ${product.available ? "on" : ""}`} aria-label={product.available ? "Produkt ausblenden" : "Produkt anbieten"} onClick={() => onToggle(product)}><span /></button><button className="edit-button" onClick={() => onEdit(product)}>Bearbeiten</button></div>)}</section>) : <EmptyPanel icon={Soup} title="Noch keine Produkte" text="Füge dein erstes Angebot hinzu." />}</>;
}
function TablesView({ tables, onAdd, onQR, onToggle }: { tables: Table[]; onAdd: () => void; onQR: (t: Table) => void; onToggle: (t: Table) => void }) {
  const activeCount = tables.filter((t) => t.active).length;
  return <><PageHeading eyebrow="PLATZNEHMEN & BESTELLEN" title="Deine Tische" detail="Jeder Tisch hat seinen eigenen QR-Code. Einfach ausdrucken und aufstellen." action={<button className="primary-button" onClick={onAdd}><Plus size={17} /> Tisch hinzufügen</button>} /><div className="table-summary"><div><span className="summary-number">{String(activeCount).padStart(2, "0")}</span><span>aktive Tische</span></div><span className="summary-note"><QrCode size={17} /> Scannen, Karte öffnen, bestellen. So einfach.</span></div>
    <div className="table-grid">{tables.map((table, index) => <article className={`table-card ${!table.active ? "inactive-table" : ""}`} key={table.id}><div className="table-card-top"><span className="table-number">{String(index + 1).padStart(2, "0")}</span><span className={`table-dot ${table.active ? "" : "off-dot"}`} /></div><div className="table-card-name">{table.name}</div><span className="table-card-status">{table.active ? "Bestellen möglich" : "Pausiert"}</span><div className="table-card-actions"><button className="subtle-button" disabled={!table.active} onClick={() => onQR(table)}><QrCode size={15} /> QR-Code</button><button className="text-icon-button" title={table.active ? "Tisch pausieren" : "Tisch aktivieren"} onClick={() => onToggle(table)}><Settings2 size={16} /></button></div></article>)}</div>
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
  return <ModalShell onClose={onClose}><form className="modal-card" onSubmit={save}><div className="modal-top"><span className="modal-icon"><Soup size={20} /></span><button type="button" className="close-button" onClick={onClose}><X size={19} /></button></div><span className="eyebrow">{product ? "ANGEBOT BEARBEITEN" : "NEUES ANGEBOT"}</span><h2>{product ? "Ein bisschen Feinschliff." : "Was gibt’s Leckeres?"}</h2><label className="field-label">Produktname<input className="text-input" required maxLength={80} placeholder="z. B. Bratwurst im Weckle" value={name} onChange={(e) => setName(e.target.value)} /></label><label className="field-label">Beschreibung<input className="text-input" maxLength={240} placeholder="Ein kurzer Satz für hungrige Gäste" value={description} onChange={(e) => setDescription(e.target.value)} /></label><div className="form-row"><label className="field-label">Kategorie<input className="text-input" required maxLength={40} value={category} onChange={(e) => setCategory(e.target.value)} /></label><label className="field-label">Preis in Euro<input className="text-input" required inputMode="decimal" placeholder="4,50" value={price} onChange={(e) => setPrice(e.target.value)} /></label></div>{error && <p className="inline-error">{error}</p>}<div className="modal-actions"><button type="button" className="subtle-button" onClick={onClose}>Abbrechen</button><button className="primary-button" disabled={busy}>{busy ? "Wird gespeichert …" : "Speichern"} <Check size={16} /></button></div></form></ModalShell>;
}
function TableModal({ eventId, onClose, onSaved }: { eventId: number; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(""); const [error, setError] = useState("");
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setError("");
    try { await request("/api/staff/tables", { method: "POST", body: JSON.stringify({ name }) }, eventId); onSaved(); }
    catch (e) { setError((e as Error).message); }
  };
  return <ModalShell onClose={onClose}><form className="modal-card" onSubmit={save}><div className="modal-top"><span className="modal-icon"><Utensils size={20} /></span><button type="button" className="close-button" onClick={onClose}><X size={19} /></button></div><span className="eyebrow">EIN PLATZ FÜR ALLE</span><h2>Noch ein Tisch?</h2><p className="modal-description">Ein QR-Code wird automatisch erstellt — der Tisch erscheint sofort auf der Gästekarte.</p><label className="field-label">Tischname<input autoFocus className="text-input" required maxLength={40} placeholder="z. B. Bierbank links" value={name} onChange={(e) => setName(e.target.value)} /></label>{error && <p className="inline-error">{error}</p>}<div className="modal-actions"><button type="button" className="subtle-button" onClick={onClose}>Abbrechen</button><button className="primary-button">Tisch hinzufügen <Plus size={16} /></button></div></form></ModalShell>;
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
  return <ModalShell onClose={onClose}><form className="modal-card" onSubmit={save}><div className="modal-top"><span className="modal-icon"><Flame size={20} /></span><button type="button" className="close-button" onClick={onClose}><X size={19} /></button></div><span className="eyebrow">EINE NEUE RUNDE</span><h2>Was steht an?</h2><p className="modal-description">Jedes Fest erhält eine eigene Speisekarte, Tische, QR-Codes und Bestellungen.</p><label className="field-label">Name des Fests<input autoFocus className="text-input" required minLength={2} maxLength={80} placeholder="z. B. Sommerfest 2027" value={name} onChange={(e) => setName(e.target.value)} /></label>{error && <p className="inline-error">{error}</p>}<div className="modal-actions"><button type="button" className="subtle-button" onClick={onClose}>Abbrechen</button><button className="primary-button" disabled={busy}>{busy ? "Wird erstellt …" : "Fest erstellen"} <Plus size={16} /></button></div></form></ModalShell>;
}
function QRModal({ table, eventSlug, onClose }: { table: Table; eventSlug: string; onClose: () => void }) {
  const link = `${window.location.origin}/e/${encodeURIComponent(eventSlug)}?t=${table.id}`;
  return <ModalShell onClose={onClose}><div className="modal-card qr-modal"><div className="modal-top"><span className="modal-icon"><QrCode size={20} /></span><button className="close-button no-print" onClick={onClose}><X size={19} /></button></div><span className="eyebrow">EINMAL SCANNEN, BITTE</span><h2>{table.name}</h2><p className="modal-description">Gäste scannen diesen Code und landen direkt auf der Karte — mit dem richtigen Tisch schon ausgewählt.</p><div className="qr-code-wrap"><QRCodeSVG value={link} size={206} level="H" includeMargin fgColor="#29291f" /></div><span className="qr-link">{link}</span><div className="modal-actions no-print"><button className="subtle-button" onClick={() => void navigator.clipboard.writeText(link)}>Link kopieren</button><button className="primary-button" onClick={() => window.print()}><Printer size={16} /> QR-Code drucken</button></div></div></ModalShell>;
}
function PaymentModal({ order, onClose, onPay }: { order: Order; onClose: () => void; onPay: (tip: number) => void }) {
  const [tip, setTip] = useState("0"); const tipCents = Math.round(Math.max(0, Number(tip.replace(",", ".")) || 0) * 100);
  return <ModalShell onClose={onClose}><div className="modal-card"><div className="modal-top"><span className="modal-icon cash-modal-icon"><Banknote size={20} /></span><button className="close-button" onClick={onClose}><X size={19} /></button></div><span className="eyebrow">BARZAHLUNG</span><h2>Das macht {euro(order.total_cents + tipCents)}.</h2><p className="modal-description">{order.table_name} · Bestellung #{shortId(order.id)} · {euro(order.total_cents)} Warenwert</p><label className="field-label">Trinkgeld in Euro<input autoFocus className="text-input" inputMode="decimal" placeholder="0,00" value={tip} onChange={(e) => setTip(e.target.value)} /></label><div className="payment-total"><span>Gesamt in bar</span><strong>{euro(order.total_cents + tipCents)}</strong></div><div className="modal-actions"><button className="subtle-button" onClick={onClose}>Zurück</button><button className="primary-button" onClick={() => onPay(tipCents)}><Check size={16} /> Bezahlt & Beleg</button></div></div></ModalShell>;
}
function ReceiptModal({ order, venueName, onClose }: { order: Order; venueName: string; onClose: () => void }) {
  const paidAt = order.paid_at
    ? new Date(order.paid_at.endsWith("Z") ? order.paid_at : `${order.paid_at.replace(" ", "T")}Z`)
    : new Date();
  return <ModalShell onClose={onClose}><div className="modal-card receipt-modal"><div className="receipt-top"><div className="receipt-brand"><Flame size={16} /> {venueName}</div><strong className="receipt-heading">Zahlungsbeleg</strong><span>Barzahlung · Bestellung #{shortId(order.id)}</span></div><div className="receipt-rule" /><div className="receipt-meta"><span>{order.table_name}</span><span>{paidAt.toLocaleString("de-DE")}</span></div><div className="receipt-rule" />{order.items.map((item, i) => <div className="receipt-line" key={`${item.product_name}-${i}`}><span>{item.quantity} × {item.product_name}</span><strong>{euro(item.quantity * item.unit_price_cents)}</strong></div>)}<div className="receipt-rule" /><div className="receipt-line"><span>Warenwert</span><strong>{euro(order.total_cents)}</strong></div>{order.tip_cents > 0 && <div className="receipt-line"><span>Trinkgeld</span><strong>{euro(order.tip_cents)}</strong></div>}<div className="receipt-total"><span>Bar bezahlt</span><strong>{euro(order.total_cents + order.tip_cents)}</strong></div><p className="receipt-legal">Vereinfachter Bewirtungsbeleg. Kein TSE-Kassenbeleg.</p><p className="receipt-thanks">Vielen Dank für deinen Besuch.</p><div className="modal-actions no-print"><button className="subtle-button" onClick={onClose}>Schließen</button><button className="primary-button" onClick={() => window.print()}><Printer size={16} /> Beleg drucken</button></div></div></ModalShell>;
}
function ModalShell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><div className="modal-position">{children}</div></div>;
}

export default App;
