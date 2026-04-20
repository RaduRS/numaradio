import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server, type Socket } from "node:net";
import { LiquidsoapSocket } from "./socket.ts";

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
