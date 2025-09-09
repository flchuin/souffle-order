import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ShoppingCart, Minus, Plus, CheckCircle2, Loader2, Printer,
  QrCode, Trash2, Lock, Ticket, User, PlusCircle
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

/**
 * Centralized-QR Scan-to-Order — Event Edition (Soufflé + Drinks, Pay at Counter)
 * - One QR at counter, customers order on their phones, pay at counter.
 * - Staff view: add `?mode=staff` to URL.
 */

// ---- Product & Flavors ----
const PRODUCT = {
  id: "souffle",
  name: "Soufflé",
  basePrice: 12.0, // RM
  desc: "Freshly made Japanese-style soufflé — fluffy, jiggly, and made to order.",
  img: "https://images.unsplash.com/photo-1589301773859-c311e67898af?q=80&w=1200&auto=format&fit=crop",
};

type Flavor = { id: string; name: string; priceDelta?: number; popular?: boolean };
const FLAVORS: Flavor[] = [
  { id: "van", name: "Vanilla" },
  { id: "cho", name: "Chocolate", popular: true },
  { id: "mat", name: "Matcha", priceDelta: 1.5, popular: true },
  { id: "str", name: "Strawberry" },
  { id: "mng", name: "Mango" },
  { id: "egl", name: "Earl Grey" },
  { id: "hoj", name: "Hojicha", priceDelta: 1.5 },
  { id: "blu", name: "Blueberry" },
  { id: "bis", name: "Biscoff", priceDelta: 2.0 },
];

const DRINKS = [{ id: "drink-hojicha", name: "Hojicha (Drink)", price: 3.0 }] as const;
const CHEESE = { id: "addon-cheese", name: "Cheese Topping", price: 2.0 } as const;

// ---- Helpers & Config ----
const fmt = (n: number) => `RM ${n.toFixed(2)}`;
const priceFor = (f: Flavor) => PRODUCT.basePrice + (f.priceDelta || 0);
const fmtTime = (t: number) => new Date(t).toLocaleString();
const PAYMENT_WINDOW_MIN = 10; // minutes before auto-cancel

// ---- Types ----
interface Addon { id: string; name: string; price: number; qty: number }
interface CartItem { sku: string; flavorId: string; name: string; unitPrice: number; qty: number; addons?: Addon[] }
interface OrderItem { sku: string; name: string; unitPrice: number; qty: number; addons?: Addon[] }
interface Order {
  id: string;
  items: OrderItem[];
  total: number;
  status: "New" | "Paid" | "Preparing" | "Ready" | "Done" | "Cancelled";
  createdAt: number;
  expiresAt?: number;
  note?: string;
  pickupName: string;
  phone?: string;
  marketingOptIn?: boolean;
}

// ---- LocalStorage "backend" ----
const LS_ORDERS_KEY = "scan2order.orders.v2";
const LS_SEQ_KEY = "scan2order.seq.v1";

function getAllOrders(): Order[] {
  try {
    const raw = localStorage.getItem(LS_ORDERS_KEY);
    const arr = raw ? (JSON.parse(raw) as any[]) : [];
    const allowed = ["New", "Paid", "Preparing", "Ready", "Done", "Cancelled"] as const;
    type Status = typeof allowed[number];
    const normalize = (s: any): Status => (allowed.includes(s as Status) ? (s as Status) : "New");
    return arr.map((o) => ({
      id: o.id ?? "",
      items: (o.items ?? []) as OrderItem[],
      total: Number(o.total ?? 0),
      status: normalize(o.status),
      createdAt: Number(o.createdAt ?? Date.now()),
      expiresAt: o.expiresAt ? Number(o.expiresAt) : undefined,
      note: o.note ?? undefined,
      pickupName: o.pickupName ?? "",
      phone: o.phone ?? undefined,
      marketingOptIn: !!o.marketingOptIn,
    })) as Order[];
  } catch {
    return [];
  }
}
function saveAllOrders(orders: Order[]) {
  localStorage.setItem(LS_ORDERS_KEY, JSON.stringify(orders));
}
function subscribeOrders(cb: (orders: Order[]) => void) {
  const handler = () => cb(getAllOrders());
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}
function nextQueueNumber(): string {
  const nowYear = new Date().getFullYear();
  const raw = localStorage.getItem(LS_SEQ_KEY);
  let { y, n } = raw ? (JSON.parse(raw) as { y: number; n: number }) : { y: nowYear, n: 0 };
  if (y !== nowYear) {
    y = nowYear;
    n = 0;
  }
  n += 1;
  localStorage.setItem(LS_SEQ_KEY, JSON.stringify({ y, n }));
  return `Q-${String(n).padStart(3, "0")}`;
}

// ---- Main App ----
export default function App() {
  const url = new URL(window.location.href);
  const isStaffMode = url.searchParams.get("mode") === "staff";
  const isEvent = true; // keep event banner by default

  const [cart, setCart] = useState<CartItem[]>([]);
  const [note, setNote] = useState("");
  const [pickupName, setPickupName] = useState("");
  const [phone, setPhone] = useState("");
  const [marketing, setMarketing] = useState(true);
  const [placing, setPlacing] = useState(false);
  const [placed, setPlaced] = useState<Order | null>(null);

  const [orders, setOrders] = useState<Order[]>(getAllOrders());
  const [staffAuthed, setStaffAuthed] = useState(false);

  // subscribe + auto-cancel overdue "New" orders
  useEffect(() => {
    const unsub = subscribeOrders(setOrders);
    const tick = setInterval(() => {
      const now = Date.now();
      const current = getAllOrders();
      let mutated = false;
      const next = current.map((o) => {
        if (o.status === "New" && o.expiresAt && now > o.expiresAt) {
          mutated = true;
          return { ...o, status: "Cancelled" as const };
        }
        return o;
      });
      if (mutated) {
        saveAllOrders(next);
        setOrders(next);
      }
    }, 30000);
    return () => {
      unsub();
      clearInterval(tick);
    };
  }, []);

  const subtotal = useMemo(
    () =>
      cart.reduce((s, i) => {
        const base = i.unitPrice * i.qty;
        const add = (i.addons || []).reduce((a, ad) => a + ad.price * ad.qty, 0);
        return s + base + add;
      }, 0),
    [cart]
  );

  // add/remove items
  function addFlavor(f: Flavor) {
    setCart((prev) => {
      const sku = `${PRODUCT.id}-${f.id}`;
      const ex = prev.find((p) => p.sku === sku);
      if (ex) return prev.map((p) => (p.sku === sku ? { ...p, qty: p.qty + 1 } : p));
      return [
        ...prev,
        { sku, flavorId: f.id, name: `${PRODUCT.name} — ${f.name}`, unitPrice: priceFor(f), qty: 1, addons: [] },
      ];
    });
  }
  function addDrink(id: string) {
    const d = DRINKS.find((x) => x.id === id)!;
    setCart((prev) => {
      const ex = prev.find((p) => p.sku === d.id);
      if (ex) return prev.map((p) => (p.sku === d.id ? { ...p, qty: p.qty + 1 } : p));
      return [...prev, { sku: d.id, flavorId: "", name: d.name, unitPrice: d.price, qty: 1, addons: [] }];
    });
  }
  function addCheeseToSouffle(sku: string) {
    setCart((prev) =>
      prev.map((p) => {
        if (p.sku !== sku) return p;
        const addons = p.addons ? [...p.addons] : [];
        const ex = addons.find((a) => a.id === CHEESE.id);
        if (ex) ex.qty += 1;
        else addons.push({ id: CHEESE.id, name: CHEESE.name, price: CHEESE.price, qty: 1 });
        return { ...p, addons };
      })
    );
  }
  function addCheeseToDrink(sku: string) {
    setCart((prev) =>
      prev.map((p) => {
        if (p.sku !== sku) return p;
        const addons = p.addons ? [...p.addons] : [];
        const ex = addons.find((a) => a.id === CHEESE.id);
        const max = p.qty; // at most 1 cheese per drink unit
        if (ex) {
          if (ex.qty < max) ex.qty += 1;
        } else {
          addons.push({ id: CHEESE.id, name: CHEESE.name, price: CHEESE.price, qty: 1 });
        }
        return { ...p, addons };
      })
    );
  }
  function inc(sku: string) {
    setCart((prev) => prev.map((p) => (p.sku === sku ? { ...p, qty: p.qty + 1 } : p)));
  }
  function dec(sku: string) {
    setCart((prev) => {
      const x = prev.find((p) => p.sku === sku);
      if (!x) return prev;
      if (x.qty <= 1) return prev.filter((p) => p.sku !== sku);
      return prev.map((p) => (p.sku === sku ? { ...p, qty: p.qty - 1 } : p));
    });
  }
  function clearCart() {
    setCart([]);
  }

  function submitOrder() {
    if (cart.length === 0) return;
    if (!pickupName.trim()) {
      alert("Please enter a pickup name.");
      return;
    }
    setPlacing(true);
    setTimeout(() => {
      const order: Order = {
        id: nextQueueNumber(),
        items: cart.map((c) => ({
          sku: c.sku,
          name: c.name,
          unitPrice: c.unitPrice,
          qty: c.qty,
          addons: c.addons,
        })),
        total: parseFloat(subtotal.toFixed(2)),
        status: "New",
        createdAt: Date.now(),
        expiresAt: Date.now() + PAYMENT_WINDOW_MIN * 60 * 1000,
        note: note || undefined,
        pickupName: pickupName.trim(),
        phone: phone.trim() || undefined,
        marketingOptIn: marketing,
      };
      const next: Order[] = [order, ...getAllOrders()].slice(0, 300);
      saveAllOrders(next);
      setOrders(next);
      setPlaced(order);
      setCart([]);
      setNote("");
      setPickupName("");
      setPhone("");
      setMarketing(true);
      setPlacing(false);
    }, 400);
  }

  // routing
  if (isStaffMode)
    return (
      <StaffBoard
        authed={staffAuthed}
        setAuthed={setStaffAuthed}
        orders={orders}
        updateOrder={(id, patch) => {
          const next = getAllOrders().map((o) => (o.id === id ? { ...o, ...patch } : o));
          saveAllOrders(next);
          setOrders(next);
        }}
        deleteOrder={(id) => {
          const next = getAllOrders().filter((o) => o.id !== id);
          saveAllOrders(next);
          setOrders(next);
        }}
        wipeAll={() => {
          if (confirm("Clear ALL demo orders?")) {
            saveAllOrders([]);
            setOrders([]);
            localStorage.removeItem(LS_SEQ_KEY);
          }
        }}
      />
    );

  if (placed) return <OrderConfirmation order={placed} isEvent={isEvent} />;

  // customer view
  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-neutral-200">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-2xl bg-neutral-900 text-white grid place-content-center font-bold">S2O</div>
          <div className="flex-1">
            <h1 className="text-lg font-semibold leading-tight">Soufflé Pop-Up — Scan to Order</h1>
            <p className="text-xs text-neutral-500">Single QR at Counter • Pay at Counter</p>
          </div>
          <CartButton count={cart.reduce((s, i) => s + i.qty, 0)} subtotal={subtotal} onClear={clearCart} />
        </div>
      </header>

      {/* Event banner */}
      <div className="bg-neutral-900 text-white">
        <div className="max-w-5xl mx-auto px-4 py-2 text-sm flex items-center gap-2">
          <Ticket className="w-4 h-4" />
          <span>Event Mode: Orders are queued. Please pay at the counter after placing your order.</span>
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-4 pb-28 pt-4">
        {/* Product hero */}
        <div className="bg-white rounded-2xl border overflow-hidden">
          <div className="aspect-video w-full overflow-hidden">
            <img src={PRODUCT.img} className="w-full h-full object-cover" alt={PRODUCT.name} />
          </div>
          <div className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">{PRODUCT.name}</h2>
                <p className="text-sm text-neutral-600">{PRODUCT.desc}</p>
              </div>
              <div className="text-right">
                <div className="text-xs text-neutral-500">from</div>
                <div className="text-lg font-semibold">{fmt(PRODUCT.basePrice)}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Flavors */}
        <h3 className="mt-5 font-semibold">Choose your flavors</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mt-2">
          {FLAVORS.map((f) => (
            <motion.button
              key={f.id}
              onClick={() => addFlavor(f)}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-2xl border p-3 text-left hover:shadow-sm"
            >
              <div className="font-medium">{f.name}</div>
              <div className="text-xs text-neutral-500">{f.priceDelta ? `+ ${fmt(f.priceDelta)}` : "Included"}</div>
              {f.popular && (
                <div className="mt-2 inline-block text-[10px] px-2 py-0.5 rounded-full bg-neutral-900 text-white">
                  Popular
                </div>
              )}
            </motion.button>
          ))}
        </div>

        {/* Drinks */}
        <h3 className="mt-6 font-semibold">Drinks</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mt-2">
          {DRINKS.map((d) => (
            <motion.div
              key={d.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-2xl border p-3 text-left"
            >
              <div className="font-medium">{d.name}</div>
              <div className="text-xs text-neutral-500">{fmt(d.price)}</div>
              <div className="flex gap-2 mt-2">
                <button onClick={() => addDrink(d.id)} className="px-3 py-1.5 rounded-xl border text-xs">
                  Add
                </button>
                <button
                  onClick={() => {
                    const exist = cart.find((c) => c.sku === d.id);
                    if (!exist) {
                      addDrink(d.id);
                      setTimeout(() => addCheeseToDrink(d.id), 0);
                    } else {
                      addCheeseToDrink(d.id);
                    }
                  }}
                  className="px-3 py-1.5 rounded-xl border text-xs flex items-center gap-1"
                >
                  <PlusCircle className="w-3 h-3" /> Cheese + {fmt(CHEESE.price)}
                </button>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Order details */}
        <div className="mt-6 grid md:grid-cols-2 gap-4">
          <div className="bg-white rounded-2xl border p-4">
            <label className="text-sm font-medium flex items-center gap-2">
              <User className="w-4 h-4" /> Pickup Name
            </label>
            <input
              value={pickupName}
              onChange={(e) => setPickupName(e.target.value)}
              placeholder="e.g., Aisyah"
              className="mt-1 w-full border rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
            />
            <label className="text-sm font-medium mt-4 block">Note (optional)</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Less sugar? Allergy note?"
              className="mt-1 w-full border rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
              rows={3}
            />

            <label className="text-sm font-medium mt-4 block">Phone Number (optional)</label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="e.g., 012-3456789"
              inputMode="tel"
              className="mt-1 w-full border rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
            />

            <label className="mt-4 flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={marketing}
                onChange={(e) => setMarketing(e.target.checked)}
                className="mt-1"
              />
              <span>Receive future promotions & marketing updates (optional)</span>
            </label>
          </div>

          <div className="bg-white rounded-2xl border p-4">
            <div className="text-sm text-neutral-500">Your Order</div>
            <div className="mt-2 space-y-2">
              {cart.length === 0 ? (
                <p className="text-sm text-neutral-500">No items yet. Tap an item to add.</p>
              ) : (
                cart.map((i) => (
                  <div key={i.sku} className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">
                        {i.name} × {i.qty}
                      </div>
                      <div className="text-xs text-neutral-500">{fmt(i.unitPrice)} each</div>
                      {/* Addons */}
                      {i.addons && i.addons.length > 0 && (
                        <div className="mt-1 space-y-0.5">
                          {i.addons.map((a) => (
                            <div key={a.id} className="text-xs text-neutral-600">
                              + {a.name} × {a.qty} ({fmt(a.price * a.qty)})
                            </div>
                          ))}
                        </div>
                      )}
                      {/* Add Cheese for Soufflé lines */}
                      {i.sku.startsWith(`${PRODUCT.id}-`) && (
                        <button
                          onClick={() => addCheeseToSouffle(i.sku)}
                          className="mt-2 px-2.5 py-1 rounded-lg border text-[12px] flex items-center gap-1"
                        >
                          <PlusCircle className="w-3 h-3" /> Add Cheese {fmt(CHEESE.price)}
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => dec(i.sku)}
                        className="w-8 h-8 rounded-xl border grid place-content-center"
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                      <span className="w-6 text-center">{i.qty}</span>
                      <button
                        onClick={() => inc(i.sku)}
                        className="w-8 h-8 rounded-xl border grid place-content-center"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="font-medium whitespace-nowrap">
                      {fmt(
                        i.unitPrice * i.qty +
                          (i.addons || []).reduce((a, ad) => a + ad.price * ad.qty, 0)
                      )}
                    </div>
                  </div>
                ))
              )}
              {cart.length > 0 && (
                <div className="flex items-center justify-between pt-2 border-t mt-2">
                  <span>Total</span>
                  <span className="font-semibold">{fmt(subtotal)}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      <OrderBar items={cart} subtotal={subtotal} placing={placing} onPlace={submitOrder} onClear={clearCart} />
    </div>
  );
}

// ---- Components ----
function CartButton({
  count,
  subtotal,
  onClear,
}: {
  count: number;
  subtotal: number;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      {count > 0 && (
        <button onClick={onClear} className="text-xs text-neutral-600 hover:text-neutral-900 underline">
          Clear
        </button>
      )}
      <div className="relative">
        <ShoppingCart className="w-6 h-6" />
        {count > 0 && (
          <span className="absolute -top-2 -right-2 bg-neutral-900 text-white text-[10px] rounded-full px-1.5 py-0.5">
            {count}
          </span>
        )}
      </div>
      <div className="text-sm font-semibold">{fmt(subtotal)}</div>
    </div>
  );
}

function OrderBar({
  items,
  subtotal,
  placing,
  onPlace,
  onClear,
}: {
  items: CartItem[];
  subtotal: number;
  placing: boolean;
  onPlace: () => void;
  onClear: () => void;
}) {
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t shadow-lg">
      <div className="max-w-5xl mx-auto px-4 py-3">
        <details>
          <summary className="list-none cursor-pointer">
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <div className="text-sm text-neutral-500">Your Order</div>
                <div className="font-semibold">{fmt(subtotal)}</div>
              </div>
              <button
                disabled={items.length === 0 || placing}
                onClick={onPlace}
                className="px-4 py-2 rounded-xl bg-neutral-900 text-white text-sm flex items-center gap-2 disabled:opacity-50"
              >
                {placing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Place
                Order
              </button>
            </div>
          </summary>
          <AnimatePresence>
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
            >
              <div className="mt-3 bg-neutral-50 rounded-xl border p-3">
                {items.length === 0 ? (
                  <p className="text-sm text-neutral-500">Your cart is empty.</p>
                ) : (
                  <div className="space-y-2">
                    {items.map((i) => (
                      <div key={i.sku} className="text-sm">
                        <div className="flex items-center justify-between">
                          <span className="truncate">
                            {i.name} × {i.qty}
                          </span>
                          <span className="font-medium">
                            {fmt(i.unitPrice * i.qty + (i.addons || []).reduce((a, ad) => a + ad.price * ad.qty, 0))}
                          </span>
                        </div>
                        {i.addons && i.addons.length > 0 && (
                          <div className="pl-4 mt-0.5 space-y-0.5">
                            {i.addons.map((a) => (
                              <div key={a.id} className="text-xs text-neutral-600">
                                + {a.name} × {a.qty} ({fmt(a.price * a.qty)})
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                    <div className="flex items-center justify-between pt-2 border-t mt-2">
                      <span className="text-sm">Total</span>
                      <span className="font-semibold">{fmt(subtotal)}</span>
                    </div>
                    <div className="flex items-center gap-3 pt-2">
                      <button onClick={onClear} className="px-3 py-1.5 rounded-xl border text-sm flex items-center gap-2">
                        <Trash2 className="w-4 h-4" /> Clear
                      </button>
                      <span className="text-xs text-neutral-700 font-medium">
                        Please <span className="underline">pay at the counter</span>. Your order will be confirmed only
                        after payment.
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </AnimatePresence>
        </details>
      </div>
    </div>
  );
}

function OrderConfirmation({ order, isEvent }: { order: Order; isEvent: boolean }) {
  // live countdown
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!order.expiresAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [order.expiresAt]);
  const remainingMs = order.expiresAt ? Math.max(0, order.expiresAt - now) : 0;
  const remMin = Math.floor(remainingMs / 60000);
  const remSec = Math.floor((remainingMs % 60000) / 1000);

  return (
    <div className="min-h-screen bg-neutral-50">
      <div className="max-w-xl mx-auto p-6">
        <div className="bg-white border rounded-2xl p-6 mt-8">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-6 h-6 text-green-600" />
            <h2 className="text-xl font-semibold">Order Placed!</h2>
          </div>
          <p className="text-sm text-neutral-600 mt-2">
            Please pay at the counter within <span className="font-medium">{PAYMENT_WINDOW_MIN} minute{PAYMENT_WINDOW_MIN > 1 ? "s" : ""}</span> to confirm your order.
            {order.expiresAt && (
              <>
                {" "}
                Pay by <span className="font-medium">{fmtTime(order.expiresAt)}</span>.{" "}
                {remainingMs > 0 ? (
                  <span className="text-neutral-800">
                    Time left: {remMin}:{String(remSec).padStart(2, "0")}
                  </span>
                ) : (
                  <span className="text-red-600 font-medium">Expired</span>
                )}
              </>
            )}
          </p>

          <div className="mt-4 p-4 bg-neutral-50 rounded-xl border text-center">
            <div className="text-xs text-neutral-500">Queue Number</div>
            <div className="text-2xl font-bold tracking-wide">{order.id}</div>
            <div className="text-xs text-neutral-500 mt-1">Name: {order.pickupName}</div>
            {order.phone && <div className="text-xs text-neutral-500 mt-1">Phone: {order.phone}</div>}
            {order.marketingOptIn && <div className="text-[11px] text-neutral-500 mt-1">Promo updates: opted in</div>}
          </div>

          <div className="mt-4 space-y-1 text-sm">
            <div className="text-xs text-neutral-500">
              Placed: {fmtTime(order.createdAt)}
              {order.expiresAt && <> • Pay by: {fmtTime(order.expiresAt)}</>}
            </div>
            {order.items.map((i) => (
              <div key={i.sku}>
                <div className="flex items-center justify-between">
                  <span className="truncate">
                    {i.name} × {i.qty}
                  </span>
                  <span className="font-medium">
                    {fmt(i.unitPrice * i.qty + (i.addons || []).reduce((a, ad) => a + ad.price * ad.qty, 0))}
                  </span>
                </div>
                {i.addons && i.addons.length > 0 && (
                  <div className="pl-4 mt-0.5 space-y-0.5">
                    {i.addons.map((a) => (
                      <div key={a.id} className="text-xs text-neutral-600">
                        + {a.name} × {a.qty} ({fmt(a.price * a.qty)})
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <div className="flex items-center justify-between pt-2 border-t mt-2">
              <span>Total</span>
              <span className="font-semibold">{fmt(order.total)}</span>
            </div>
          </div>

          <div className="mt-6 flex flex-col items-center gap-3">
            <button onClick={() => window.print()} className="px-4 py-2 rounded-xl border text-sm flex items-center gap-2">
              <Printer className="w-4 h-4" /> Print receipt
            </button>
            {isEvent && <div className="text-xs text-neutral-500">Please allow 10–15 minutes during peak times.</div>}
          </div>
        </div>

        {/* Customer page: QR intentionally removed */}
        <div className="text-center mt-8">
          <a href={window.location.pathname} className="underline text-sm">
            Start a new order
          </a>
        </div>
      </div>
    </div>
  );
}

function StaffBoard({
  authed,
  setAuthed,
  orders,
  updateOrder,
  deleteOrder,
  wipeAll,
}: {
  authed: boolean;
  setAuthed: (v: boolean) => void;
  orders: Order[];
  updateOrder: (id: string, patch: Partial<Order>) => void;
  deleteOrder: (id: string) => void;
  wipeAll: () => void;
}) {
  const [pin, setPin] = useState("");
  const [filter, setFilter] = useState<string>("Active");

  const filtered = useMemo(() => {
    const base = [...orders].sort((a, b) => b.createdAt - a.createdAt);
    if (filter === "All") return base;
    if (filter === "Active")
      return base.filter((o) => ["New", "Paid", "Preparing", "Ready"].includes(o.status));
    return base.filter((o) => o.status === filter);
  }, [orders, filter]);

  if (!authed)
    return (
      <div className="min-h-screen grid place-content-center bg-neutral-50 p-6">
        <div className="bg-white border rounded-2xl p-6 w-[360px]">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4" />
            <h2 className="font-semibold">Staff Login</h2>
          </div>
          <p className="text-sm text-neutral-600 mt-1">
            Enter PIN to view orders. (Demo PIN: <span className="font-mono">1234</span>)
          </p>
          <input
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="PIN"
            className="mt-3 w-full border rounded-xl p-3 text-sm"
          />
          <button
            onClick={() => setAuthed(pin === "1234")}
            className="mt-3 w-full px-4 py-2 rounded-xl bg-neutral-900 text-white text-sm"
          >
            Enter
          </button>
        </div>
      </div>
    );

  const siteUrl = `${window.location.origin}${window.location.pathname}`;

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-neutral-200">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-2xl bg-neutral-900 text-white grid place-content-center font-bold">S2O</div>
          <div className="flex-1">
            <h1 className="text-lg font-semibold leading-tight">Orders Board</h1>
            <p className="text-xs text-neutral-500">Mark orders as Paid at the counter; update status as you prepare.</p>
          </div>
          <button onClick={wipeAll} className="px-3 py-1.5 rounded-xl border text-xs">
            Clear All (demo)
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-4">
        {/* Centralized QR (print for counter) */}
        <div className="bg-white rounded-2xl border p-4 flex items-center gap-4">
          <div>
            <div className="text-sm font-semibold flex items-center gap-2">
              <QrCode className="w-4 h-4" /> Centralized QR
            </div>
            <p className="text-xs text-neutral-600">Print this and place at the counter for guests to scan.</p>
          </div>
          <div className="ml-auto text-center">
            <QRCodeSVG value={siteUrl} size={100} />
            <div className="text-[10px] text-neutral-500 mt-1 break-all max-w-[200px]">{siteUrl}</div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 overflow-auto pb-2 mt-3">
          {["Active", "All", "New", "Paid", "Preparing", "Ready", "Done", "Cancelled"].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-full border text-sm whitespace-nowrap ${
                filter === f ? "bg-neutral-900 text-white border-neutral-900" : "bg-white"
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Orders grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-3">
          {filtered.map((o) => (
            <div key={o.id} className="bg-white rounded-2xl border p-4 flex flex-col">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs text-neutral-500">Queue</div>
                  <div className="font-semibold">{o.id}</div>
                  <div className="text-xs text-neutral-500 mt-0.5">Name: {o.pickupName}</div>
                  {o.phone && <div className="text-xs text-neutral-500 mt-0.5">Phone: {o.phone}</div>}
                </div>
                <span className="text-xs px-2 py-1 rounded-full border bg-neutral-50">
                  {o.status}
                  {o.status === "New" && o.expiresAt && Date.now() > o.expiresAt && (
                    <span className="ml-2 text-red-600">• Overdue</span>
                  )}
                </span>
              </div>

              <div className="mt-3 text-sm flex-1">
                <div className="text-[11px] text-neutral-500">
                  Placed: {fmtTime(o.createdAt)}
                  {o.expiresAt && <> • Pay by: {fmtTime(o.expiresAt)}</>}
                </div>

                {o.items.map((i) => (
                  <div key={i.sku}>
                    <div className="flex items-center justify-between">
                      <span className="truncate">
                        {i.name} × {i.qty}
                      </span>
                      <span className="font-medium">
                        {fmt(i.unitPrice * i.qty + (i.addons || []).reduce((a, ad) => a + ad.price * ad.qty, 0))}
                      </span>
                    </div>
                    {i.addons && i.addons.length > 0 && (
                      <div className="pl-4 mt-0.5 space-y-0.5">
                        {i.addons.map((a) => (
                          <div key={a.id} className="text-xs text-neutral-600">
                            + {a.name} × {a.qty} ({fmt(a.price * a.qty)})
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}

                <div className="flex items-center justify-between pt-2 border-t mt-2">
                  <span>Total</span>
                  <span className="font-semibold">{fmt(o.total)}</span>
                </div>

                {o.note && <div className="mt-2 text-xs bg-neutral-50 border rounded-lg p-2">Note: {o.note}</div>}
                {o.marketingOptIn && (
                  <div className="mt-2 text-xs text-neutral-500">Marketing: Opted in</div>
                )}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                {o.status === "New" && (
                  <button
                    onClick={() => updateOrder(o.id, { status: "Paid" })}
                    className="px-3 py-1.5 rounded-xl bg-neutral-900 text-white text-xs"
                  >
                    Mark Paid
                  </button>
                )}
                {o.status !== "Preparing" && (
                  <button
                    onClick={() => updateOrder(o.id, { status: "Preparing" })}
                    className="px-3 py-1.5 rounded-xl border text-xs"
                  >
                    Preparing
                  </button>
                )}
                {o.status !== "Ready" && (
                  <button
                    onClick={() => updateOrder(o.id, { status: "Ready" })}
                    className="px-3 py-1.5 rounded-xl border text-xs"
                  >
                    Ready
                  </button>
                )}
                {o.status !== "Done" && (
                  <button
                    onClick={() => updateOrder(o.id, { status: "Done" })}
                    className="px-3 py-1.5 rounded-xl border text-xs"
                  >
                    Done
                  </button>
                )}
                {o.status !== "Cancelled" && (
                  <button
                    onClick={() => updateOrder(o.id, { status: "Cancelled" })}
                    className="px-3 py-1.5 rounded-xl border text-xs"
                  >
                    Cancel
                  </button>
                )}
                <button
                  onClick={() => deleteOrder(o.id)}
                  className="ml-auto px-3 py-1.5 rounded-xl border text-xs"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="text-right mt-6">
          <button onClick={wipeAll} className="px-3 py-1.5 rounded-xl border text-xs">
            Clear All Orders (demo)
          </button>
        </div>
      </main>
    </div>
  );
}
