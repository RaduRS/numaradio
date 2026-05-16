import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server, type Socket } from "node:net";
import { LiquidsoapSocket, SupervisedSocket } from "./socket.ts";

function tcpServer(onConnect: (s: Socket) => void): Promise<{ port: number; server: Server }> {
  return new Promise((resolve) => {
    const server = createServer((s) => {
      onConnect(s);
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (typeof addr === "object" && addr) resolve({ port: addr.port, server });
    });
  });
}

test("LiquidsoapSocket connects and sends commands", async () => {
  const received: string[] = [];
  const { port, server } = await tcpServer((s) => {
    s.on("data", (d) => received.push(d.toString()));
  });

  const sock = new LiquidsoapSocket({ host: "127.0.0.1", port });
  await sock.connect();
  await sock.send("priority.push https://example.com/a.mp3");
  // Give the server a tick to receive.
  await new Promise((r) => setTimeout(r, 50));

  sock.close();
  server.close();

  assert.equal(received.length, 1);
  assert.equal(received[0], "priority.push https://example.com/a.mp3\n");
});

test("LiquidsoapSocket emits lines received from the server", async () => {
  const lines: string[] = [];
  const { port, server } = await tcpServer((s) => {
    s.write("hello\nworld\n");
  });

  const sock = new LiquidsoapSocket({ host: "127.0.0.1", port });
  sock.onLine((l) => lines.push(l));
  await sock.connect();
  await new Promise((r) => setTimeout(r, 50));

  sock.close();
  server.close();

  assert.deepEqual(lines, ["hello", "world"]);
});

test("LiquidsoapSocket reports isConnected correctly", async () => {
  const { port, server } = await tcpServer(() => {});
  const sock = new LiquidsoapSocket({ host: "127.0.0.1", port });
  assert.equal(sock.isConnected(), false);
  await sock.connect();
  assert.equal(sock.isConnected(), true);
  sock.close();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(sock.isConnected(), false);
  server.close();
});

test("SupervisedSocket reconnects after server restart", async () => {
  const reconnects: number[] = [];
  const sink: string[] = [];

  // Start first server, letting the OS pick a port.
  const first = await tcpServer((s) => {
    s.on("data", (d) => sink.push(d.toString()));
  });

  const sup = new SupervisedSocket(
    { host: "127.0.0.1", port: first.port },
    { baseDelayMs: 20, maxDelayMs: 40 },
  );
  sup.onReconnect(() => reconnects.push(Date.now()));
  await sup.start();
  await sup.send("hello");
  await new Promise((r) => setTimeout(r, 40));

  // Restart the server on the SAME port.
  first.server.close();
  await new Promise((r) => setTimeout(r, 200));
  const second = await new Promise<{ port: number; server: Server }>((resolve) => {
    const srv = createServer((s) => {
      s.on("data", (d) => sink.push(d.toString()));
    });
    srv.listen(first.port, "127.0.0.1", () => resolve({ port: first.port, server: srv }));
  });

  // Wait up to 500ms for the supervisor to reconnect.
  const deadline = Date.now() + 500;
  while (Date.now() < deadline && reconnects.length < 1) {
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.ok(reconnects.length >= 1, "expected at least one reconnect");

  await sup.send("world");
  await new Promise((r) => setTimeout(r, 40));

  sup.stop();
  second.server.close();

  assert.ok(sink.some((s) => s.includes("hello")));
  assert.ok(sink.some((s) => s.includes("world")));
});

test("SupervisedSocket.send rejects fast when not connected", async () => {
  const sup = new SupervisedSocket(
    { host: "127.0.0.1", port: 1 /* bogus */ },
    { baseDelayMs: 10_000, maxDelayMs: 10_000 },
  );
  // Do not call start(); we just want to confirm the "not connected" path.
  await assert.rejects(() => sup.send("x"), /not connected/);
});

test("LiquidsoapSocket.request collects response lines until END", async () => {
  const { port, server } = await tcpServer((s) => {
    s.on("data", (d) => {
      if (d.toString().startsWith("priority.queue")) s.write("100 101\nEND\n");
    });
  });
  const sock = new LiquidsoapSocket({ host: "127.0.0.1", port });
  await sock.connect();
  const lines = await sock.request("priority.queue");
  sock.close();
  server.close();
  assert.deepEqual(lines, ["100 101"]);
});

test("LiquidsoapSocket.request times out when no END arrives", async () => {
  const { port, server } = await tcpServer((s) => {
    s.on("data", () => s.write("partial\n"));
  });
  const sock = new LiquidsoapSocket({ host: "127.0.0.1", port });
  await sock.connect();
  await assert.rejects(() => sock.request("priority.queue", 100), /timeout/);
  sock.close();
  server.close();
});

test("LiquidsoapSocket.request serializes concurrent callers", async () => {
  const order: string[] = [];
  const { port, server } = await tcpServer((s) => {
    s.on("data", (d) => {
      const cmd = d.toString().trim();
      order.push(`recv:${cmd}`);
      setTimeout(() => s.write(`reply-to-${cmd}\nEND\n`), 30);
    });
  });
  const sock = new LiquidsoapSocket({ host: "127.0.0.1", port });
  await sock.connect();
  const [a, b] = await Promise.all([sock.request("cmd-a"), sock.request("cmd-b")]);
  sock.close();
  server.close();
  assert.deepEqual(order, ["recv:cmd-a", "recv:cmd-b"]);
  assert.deepEqual(a, ["reply-to-cmd-a"]);
  assert.deepEqual(b, ["reply-to-cmd-b"]);
});
