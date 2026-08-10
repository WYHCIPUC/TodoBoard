"use strict";

const assert = require("assert");
const wecom = require("./wecom");

const xml = "<xml><Content><![CDATA[请保存 https://example.com/item，稍后查看]]></Content><FromUserName><![CDATA[user-1]]></FromUserName></xml>";
assert.strictEqual(wecom.extractUrl(xml), "https://example.com/item");
assert.strictEqual(wecom.xmlField(xml, "FromUserName"), "user-1");
assert.strictEqual(wecom.extractUrl("<xml><Content>没有链接</Content></xml>"), "");
assert.strictEqual(typeof wecom.isEnabled(), "boolean");
console.log("wecom: ALL PASS");
