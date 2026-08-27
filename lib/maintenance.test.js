"use strict";

const assert = require("assert");
const { MaintenanceCoordinator } = require("./maintenance");

(async () => {
  const events = [];
  const coordinator = new MaintenanceCoordinator({
    timeoutMs: 30,
    pause: async () => events.push("pause"),
    resume: async () => events.push("resume"),
  });
  const token = coordinator.acquireMutation();
  assert.deepStrictEqual(coordinator.status(), { mode: "normal", activeMutations: 1 });
  assert.strictEqual(coordinator.acquireMutation(token), token);
  assert.strictEqual(coordinator.releaseMutation(token), true);
  assert.strictEqual(coordinator.status().activeMutations, 1);
  const maintenancePromise = coordinator.acquireMaintenance({ timeoutMs: 100 });
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(coordinator.status().mode, "waiting");
  assert.throws(() => coordinator.acquireMutation(), error => error.code === "maintenance_locked");
  coordinator.releaseMutation(token);
  const maintenance = await maintenancePromise;
  assert.strictEqual(coordinator.status().mode, "maintenance");
  await assert.rejects(coordinator.acquireMaintenance(), error => error.code === "transaction_busy");
  assert.strictEqual(await coordinator.releaseMaintenance({}), false);
  assert.strictEqual(await coordinator.releaseMaintenance(maintenance), true);
  assert.deepStrictEqual(events, ["pause", "resume"]);

  let nestedToken;
  const result = await coordinator.withMutation(async current => {
    nestedToken = current;
    return coordinator.withMutation(async same => {
      assert.strictEqual(same, current);
      return 42;
    }, current);
  });
  assert.strictEqual(result, 42);
  assert.strictEqual(nestedToken.released, true);
  assert.strictEqual(coordinator.releaseMutation(nestedToken), false);
  assert.throws(() => coordinator.acquireMutation(nestedToken), error => error.code === "maintenance_locked");

  const blocked = new MaintenanceCoordinator({ timeoutMs: 5, pause: async () => events.push("pause2"), resume: async () => events.push("resume2") });
  const held = blocked.acquireMutation();
  await assert.rejects(blocked.acquireMaintenance(), error => error.code === "maintenance_timeout");
  assert.deepStrictEqual(blocked.status(), { mode: "normal", activeMutations: 1 });
  blocked.releaseMutation(held);

  const wrapped = await coordinator.withMaintenance(async lease => {
    assert.strictEqual(lease.kind, "maintenance");
    return "done";
  });
  assert.strictEqual(wrapped, "done");
  const defaults = new MaintenanceCoordinator();
  const defaultLease = await defaults.acquireMaintenance();
  assert.strictEqual(await defaults.releaseMaintenance(defaultLease), true);
  console.log("maintenance: ALL PASS");
})().catch(error => {
  console.error(error);
  process.exit(1);
});
