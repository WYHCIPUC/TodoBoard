"use strict";

const assert = require("assert");
delete process.env.ALLOW_PRIVATE_NETWORK;
const { assertPublicUrl, isPrivateIP } = require("./safeurl");

(async () => {
  assert.strictEqual(isPrivateIP("127.0.0.1"), true);
  assert.strictEqual(isPrivateIP("::1"), true);
  assert.strictEqual(isPrivateIP("::ffff:7f00:1"), true);
  assert.strictEqual(isPrivateIP("::ffff:a00:1"), true);
  assert.strictEqual(isPrivateIP("::ffff:0:7f00:1"), true);
  assert.strictEqual(isPrivateIP("::ffff:808:808"), false);
  assert.strictEqual(isPrivateIP("ff02::1"), true);
  assert.strictEqual(isPrivateIP("64:ff9b::7f00:1"), true);
  assert.strictEqual(isPrivateIP("2606:4700:4700::1111"), false);

  await assert.rejects(assertPublicUrl("file:///etc/passwd"), /http\(s\)/);
  await assert.rejects(assertPublicUrl("https://user:secret@example.com/private"), /用户名或密码/);
  await assert.rejects(assertPublicUrl("http://[::1]/private"), /本机|内网/);
  await assert.rejects(assertPublicUrl("http://[::ffff:127.0.0.1]/private"), /本机|内网/);
  await assert.doesNotReject(assertPublicUrl("http://[2606:4700:4700::1111]/"));

  console.log("safeurl: ALL PASS");
})().catch(error => {
  console.error(error);
  process.exit(1);
});
