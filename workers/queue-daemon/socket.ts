import { Socket } from "node:net";

export type SocketOpts = { host: string; port: number };

export class LiquidsoapSocket {
  private readonly opts: SocketOpts;
  private sock: Socket | null = null;
  private connected = false;
  private buffer = "";
  private lineListeners = new Set<(line: string) => void>();
  private disconnectListeners = new Set<() => void>();

  constructor(opts: SocketOpts) {
    this.opts = opts;
  }

  isConnected(): boolean {
    return this.connected;
  }

  onLine(fn: (line: string) => void): () => void {
    this.lineListeners.add(fn);
    return () => this.lineListeners.delete(fn);
  }

  onDisconnect(fn: () => void): () => void {
    this.disconnectListeners.add(fn);
    return () => this.disconnectListeners.delete(fn);
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const s = new Socket();
      s.setEncoding("utf8");
      s.setKeepAlive(true, 10_000);
      const onError = (err: Error) => {
        s.removeAllListeners();
        this.sock = null;
        this.connected = false;
        reject(err);
      };
      s.once("error", onError);
      s.connect(this.opts.port, this.opts.host, () => {
        s.removeListener("error", onError);
        this.sock = s;
        this.connected = true;
        s.on("data", (chunk: string) => this.handleData(chunk));
        s.on("close", () => this.handleClose());
        s.on("error", () => this.handleClose());
        resolve();
      });
    });
  }

  private handleData(chunk: string): void {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, idx).replace(/\r$/, "");
      this.buffer = this.buffer.slice(idx + 1);
      for (const fn of this.lineListeners) fn(line);
    }
  }

  private handleClose(): void {
    if (!this.connected) return;
    this.connected = false;
    this.sock = null;
    for (const fn of this.disconnectListeners) fn();
  }

  send(line: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.sock || !this.connected) return reject(new Error("not connected"));
      this.sock.write(line + "\n", (err) => (err ? reject(err) : resolve()));
    });
  }

  close(): void {
    if (this.sock) {
      this.sock.destroy();
      this.sock = null;
    }
    this.connected = false;
  }
}

export type SupervisorOpts = { baseDelayMs?: number; maxDelayMs?: number };

export class SupervisedSocket {
  private inner: LiquidsoapSocket;
  private stopped = false;
  private reconnectListeners = new Set<() => void | Promise<void>>();
  private lineListeners = new Set<(line: string) => void>();
  private readonly base: number;
  private readonly max: number;

  constructor(opts: SocketOpts, sup: SupervisorOpts = {}) {
    this.inner = new LiquidsoapSocket(opts);
    this.base = sup.baseDelayMs ?? 2_000;
    this.max = sup.maxDelayMs ?? 30_000;
    this.inner.onDisconnect(() => {
      if (!this.stopped) void this.loop(this.base);
    });
    this.inner.onLine((l) => {
      for (const fn of this.lineListeners) fn(l);
    });
  }

  onLine(fn: (line: string) => void): void {
    this.lineListeners.add(fn);
  }

  onReconnect(fn: () => void | Promise<void>): void {
    this.reconnectListeners.add(fn);
  }

  isConnected(): boolean {
    return this.inner.isConnected();
  }

  async start(): Promise<void> {
    await this.loop(this.base);
  }

  stop(): void {
    this.stopped = true;
    this.inner.close();
  }

  async send(line: string): Promise<void> {
    await this.inner.send(line);
  }

  private async loop(delay: number): Promise<void> {
    while (!this.stopped) {
      try {
        await this.inner.connect();
        for (const fn of this.reconnectListeners) await fn();
        return;
      } catch {
        // Add up to 1s of jitter so multiple supervised sockets
        // restarting together (e.g. after a Liquidsoap reload) don't
        // hammer the telnet endpoint at exactly the same instants.
        const jitter = Math.random() * 1000;
        await new Promise((r) => setTimeout(r, delay + jitter));
        delay = Math.min(delay * 2, this.max);
      }
    }
  }
}
