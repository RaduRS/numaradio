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
