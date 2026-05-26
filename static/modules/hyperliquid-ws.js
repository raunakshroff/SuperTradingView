// Hyperliquid WebSocket multiplexer for crypto candle subscriptions.
// The browser connects directly; server-side streaming is not used for crypto.

class HyperliquidWS {
  constructor() {
    this.url = "wss://api.hyperliquid.xyz/ws";
    this.ws = null;
    this.subs = new Map(); // key="COIN|INTERVAL" -> Set<callback>
    this.openPromise = null;
    this.backoff = 1000;
  }

  _key(coin, interval) { return `${coin.toUpperCase()}|${interval}`; }

  _connect() {
    if (this.openPromise) return this.openPromise;
    this.openPromise = new Promise((resolve) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.addEventListener("open", () => {
        this.backoff = 1000;
        for (const key of this.subs.keys()) {
          const [coin, interval] = key.split("|");
          ws.send(JSON.stringify({
            method: "subscribe",
            subscription: { type: "candle", coin, interval },
          }));
        }
        resolve();
      });
      ws.addEventListener("message", (ev) => this._onMessage(ev));
      ws.addEventListener("close", () => this._onClose());
      ws.addEventListener("error", () => { /* close handler will retry */ });
    });
    return this.openPromise;
  }

  _onClose() {
    this.ws = null;
    this.openPromise = null;
    const wait = this.backoff;
    this.backoff = Math.min(this.backoff * 2, 30000);
    setTimeout(() => {
      if (this.subs.size > 0) this._connect();
    }, wait);
    for (const cbs of this.subs.values()) {
      for (const cb of cbs) cb({ type: "status", status: "reconnecting" });
    }
  }

  _onMessage(ev) {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.channel !== "candle" || !msg.data) return;
    const d = msg.data;
    const key = this._key(d.s, d.i);
    const cbs = this.subs.get(key);
    if (!cbs) return;
    const candle = {
      time:   Math.floor(d.t / 1000),
      open:   Number(d.o),
      high:   Number(d.h),
      low:    Number(d.l),
      close:  Number(d.c),
      volume: Number(d.v),
    };
    for (const cb of cbs) cb({ type: "candle", candle });
  }

  async subscribe(coin, interval, cb) {
    const key = this._key(coin, interval);
    if (!this.subs.has(key)) this.subs.set(key, new Set());
    this.subs.get(key).add(cb);
    await this._connect();
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        method: "subscribe",
        subscription: { type: "candle", coin, interval },
      }));
    }
    return () => this._unsubscribe(coin, interval, cb);
  }

  _unsubscribe(coin, interval, cb) {
    const key = this._key(coin, interval);
    const cbs = this.subs.get(key);
    if (!cbs) return;
    cbs.delete(cb);
    if (cbs.size === 0) {
      this.subs.delete(key);
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          method: "unsubscribe",
          subscription: { type: "candle", coin, interval },
        }));
      }
    }
  }
}

export const HL = new HyperliquidWS();
