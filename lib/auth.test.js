"use strict";
const assert = require("assert");
const { createAuth } = require("./auth");

const auth = createAuth({ token: "test-token" });
const request = headers => ({ headers: headers || {} });

assert.strictEqual(auth.isLocalHost(request({ host: "localhost:3865" })), true);
assert.strictEqual(auth.isLocalHost(request({ host: "127.0.0.1:3865" })), true);
assert.strictEqual(auth.isLocalHost(request({ host: "public.example.com" })), false);
assert.strictEqual(auth.isAuthorized(request({ cookie: "linggan_session=test-token" })), true);
assert.strictEqual(auth.isAuthorized(request({ "x-linggan-token": "test-token" })), true);
assert.strictEqual(auth.isAuthorized(request({ cookie: "linggan_session=bad" })), false);
assert.strictEqual(auth.authorizationKind(request({ cookie: "linggan_session=test-token" })), "session");
assert.strictEqual(auth.authorizationKind(request({ "x-linggan-token": "test-token" })), "token");
assert.strictEqual(auth.isTrustedOrigin(request({ host: "127.0.0.1:3865", origin: "http://127.0.0.1:3865" })), true);
assert.strictEqual(auth.isTrustedOrigin(request({ host: "127.0.0.1:3865", origin: "http://127.0.0.1:9999" })), false);
assert.strictEqual(auth.isTrustedOrigin(request({ host: "localhost:3865" })), false);
assert.ok(auth.sessionCookie().includes("HttpOnly"));
assert.ok(auth.sessionCookie().includes("SameSite=Strict"));

console.log("auth: ALL PASS");
