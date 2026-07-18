import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../browser/adapter.js", import.meta.url), "utf8");
const entrypoint = await readFile(new URL("../entrypoint.sh", import.meta.url), "utf8");

async function loadStandaloneAdapter() {
  const listeners = new Map();
  const window = {
    addEventListener(name, listener) {
      listeners.set(name, listener);
    },
    console: { warn() {} },
    location: { assign() {}, reload() {} },
  };
  const context = vm.createContext({
    URL,
    console,
    document: {},
    fetch: async () => ({ ok: true, async json() { return { enabled: false }; } }),
    Number,
    Set,
    sessionStorage: { getItem() { return null; }, removeItem() {}, setItem() {} },
    window,
  });
  vm.runInContext(source, context, { filename: "adapter.js" });
  await window.lilaVortex.ready;
  return window.lilaVortex;
}

test("accepts only a same-origin hosted Vortex SDK URL", async () => {
  const adapter = await loadStandaloneAdapter();
  const parsed = adapter._validateRuntimeConfig({
    enabled: true,
    vortexOrigin: "https://vortex.example",
    sdkUrl: "https://vortex.example/sdk/v1/vortex-game-sdk.js",
  });
  assert.equal(parsed.origin.origin, "https://vortex.example");
});

test("allows local HTTP and standalone mode", async () => {
  const adapter = await loadStandaloneAdapter();
  assert.equal(adapter._validateRuntimeConfig({ enabled: false }), null);
  assert.equal(
    adapter._validateRuntimeConfig({
      enabled: true,
      vortexOrigin: "http://lila.localhost:18081",
      sdkUrl: "http://lila.localhost:18081/sdk/vortex-game-sdk.js",
    }).origin.origin,
    "http://lila.localhost:18081",
  );
});

test("rejects foreign, credentialed, mutable, and insecure SDK locations", async () => {
  const adapter = await loadStandaloneAdapter();
  for (const config of [
    { enabled: true, vortexOrigin: "https://vortex.example", sdkUrl: "https://cdn.example/sdk/v1/vortex-game-sdk.js" },
    { enabled: true, vortexOrigin: "https://user:password@vortex.example", sdkUrl: "https://vortex.example/sdk/v1/vortex-game-sdk.js" },
    { enabled: true, vortexOrigin: "https://vortex.example", sdkUrl: "https://vortex.example/sdk/v1/vortex-game-sdk.js?next=1" },
    { enabled: true, vortexOrigin: "http://vortex.example", sdkUrl: "http://vortex.example/sdk/v1/vortex-game-sdk.js" },
  ]) {
    assert.throws(() => adapter._validateRuntimeConfig(config), /unsafe SDK URL/);
  }
});

test("does not end play sessions on normal page transitions", () => {
  assert.doesNotMatch(source, /beforeunload|pagehide|unload/);
  assert.match(source, /client\.play\.end\("quit"\)/);
});

test("uses an executable persistent directory for native libraries and stderr for nginx", () => {
  assert.match(entrypoint, /native_workdir="\$\{runtime_dir\}\/netty-native"/);
  assert.match(entrypoint, /rm -rf "\$\{native_workdir\}"/);
  assert.match(entrypoint, /mkdir -m 0700 "\$\{native_workdir\}"/);
  assert.match(
    entrypoint,
    /-Dreactivemongo\.io\.netty\.native\.workdir="\$\{native_workdir\}"/,
  );
  assert.equal((entrypoint.match(/nginx -e \/dev\/stderr/g) || []).length, 2);
});
