(() => {
  "use strict";

  const CONFIG_ENDPOINT = "/api/vortex/config";
  const SESSION_ENDPOINT = "/api/vortex/session";
  const observedEvents = new Set(["lila.move.accepted", "lila.game.completed"]);
  const variants = new Set([
    "standard",
    "chess960",
    "kingOfTheHill",
    "threeCheck",
    "antichess",
    "atomic",
    "horde",
    "racingKings",
    "crazyhouse",
  ]);
  const mappedReloadKey = "lila.vortex.mapped-user";
  const observedMoves = new Set();
  const completedGames = new Set();

  let client = null;
  let clientPromise = null;
  let vortexOrigin = null;
  let sessionExpired = false;
  let panel = null;
  let identityText = null;
  let statusText = null;
  let actionButton = null;

  function isLocalHostname(hostname) {
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]" ||
      hostname.endsWith(".localhost")
    );
  }

  function validateRuntimeConfig(config) {
    if (!config || typeof config !== "object" || typeof config.enabled !== "boolean") {
      throw new Error("Vortex runtime config is invalid");
    }
    if (!config.enabled) return null;
    if (typeof config.vortexOrigin !== "string" || typeof config.sdkUrl !== "string") {
      throw new Error("Vortex runtime config is incomplete");
    }

    const origin = new URL(config.vortexOrigin);
    const sdkURL = new URL(config.sdkUrl);
    const secureOrigin =
      origin.protocol === "https:" ||
      (origin.protocol === "http:" && isLocalHostname(origin.hostname));
    const allowedSDKPath = /^\/sdk\/(?:v1\/)?vortex-game-sdk\.js$/;
    if (
      !secureOrigin ||
      origin.username ||
      origin.password ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash ||
      origin.origin !== sdkURL.origin ||
      sdkURL.username ||
      sdkURL.password ||
      !allowedSDKPath.test(sdkURL.pathname) ||
      sdkURL.search ||
      sdkURL.hash
    ) {
      throw new Error("Vortex supplied an unsafe SDK URL");
    }
    return { origin, sdkURL };
  }

  function ensurePanel() {
    if (panel) return;
    panel = document.createElement("aside");
    panel.id = "vortex-panel";
    panel.setAttribute("aria-live", "polite");

    const copy = document.createElement("div");
    copy.className = "vortex-panel-copy";
    const brand = document.createElement("span");
    brand.className = "vortex-panel-brand";
    brand.textContent = "VORTEX";
    identityText = document.createElement("strong");
    identityText.textContent = "Connecting player";
    statusText = document.createElement("small");
    statusText.textContent = "Starting chess session";
    actionButton = document.createElement("button");
    actionButton.type = "button";
    actionButton.className = "vortex-action-button";
    actionButton.textContent = "Return to Vortex";
    actionButton.addEventListener("click", () => {
      if (sessionExpired && vortexOrigin) {
        window.location.assign(`${vortexOrigin}/login`);
      } else if (!client) {
        void retry();
      } else {
        void adapter.returnToVortex();
      }
    });
    copy.append(brand, identityText, statusText);
    panel.append(copy, actionButton);
    document.body.append(panel);
  }

  function showReconnect(expired = false) {
    sessionExpired = expired;
    ensurePanel();
    identityText.textContent = expired ? "Session expired" : "Vortex unavailable";
    statusText.textContent = expired
      ? "Sign in again to reconnect"
      : "Check the connection and retry";
    actionButton.textContent = expired ? "Reconnect Vortex" : "Retry connection";
    actionButton.disabled = false;
  }

  function reportIntegrationError(error) {
    const code = error && typeof error.code === "string" ? error.code : "UNKNOWN";
    window.console?.warn?.("Vortex integration error:", code);
    if (code === "GAME_SESSION_REQUIRED" || code === "SESSION_REVOKED") {
      showReconnect(true);
    }
  }

  async function loadRuntimeConfig() {
    const response = await fetch(CONFIG_ENDPOINT, {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error("Vortex runtime config is unavailable");
    return validateRuntimeConfig(await response.json());
  }

  async function mapLilaAccount() {
    const response = await fetch(SESSION_ENDPOINT, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error("Vortex account mapping failed");
    const mapped = await response.json();
    if (!mapped.authenticated || typeof mapped.username !== "string") {
      throw new Error("Vortex account mapping response is invalid");
    }

    const currentUser = document.body.dataset.user;
    const mappedUser = mapped.username.toLowerCase();
    if (currentUser === mappedUser) {
      sessionStorage.removeItem(mappedReloadKey);
      return mapped;
    }
    if (sessionStorage.getItem(mappedReloadKey) === mappedUser) {
      throw new Error("Mapped Lila session did not become active");
    }
    sessionStorage.setItem(mappedReloadKey, mappedUser);
    window.location.reload();
    return mapped;
  }

  async function connect() {
    const runtime = await loadRuntimeConfig();
    if (!runtime) return { enabled: false, identity: null };
    vortexOrigin = runtime.origin.origin;
    ensurePanel();

    if (!client) {
      const sdk = await import(runtime.sdkURL.href);
      if (!sdk || typeof sdk.createVortexGameClient !== "function") {
        throw new Error("Vortex SDK module is invalid");
      }
      client = await sdk.createVortexGameClient({
        vortexOrigin,
        onSessionExpired: () => showReconnect(true),
        onError: reportIntegrationError,
      });
    }

    const context = await client.auth.context();
    const mapped = await mapLilaAccount();
    sessionExpired = false;
    identityText.textContent = context.user.displayName || context.user.handle || "Vortex player";
    statusText.textContent = `Playing as ${mapped.username}`;
    actionButton.textContent = "Return to Vortex";
    actionButton.disabled = false;
    return { enabled: true, identity: context.user };
  }

  function initialize() {
    if (!clientPromise) {
      clientPromise = connect().catch((error) => {
        reportIntegrationError(error);
        showReconnect(sessionExpired);
        return { enabled: false, identity: null };
      });
    }
    return clientPromise;
  }

  async function retry() {
    if (actionButton) {
      actionButton.disabled = true;
      actionButton.textContent = "Connecting...";
    }
    clientPromise = null;
    adapter.ready = initialize();
    return adapter.ready;
  }

  function normalizeVariant(value) {
    return typeof value === "string" && variants.has(value) ? value : null;
  }

  const adapter = {
    ready: null,
    async trackObserved(key, attributes = {}, flush = false) {
      if (!observedEvents.has(key)) throw new Error(`Undeclared Vortex event: ${key}`);
      const state = await adapter.ready;
      if (!state.enabled || !client) return null;
      const eventID = client.events.track(key, attributes, { version: 1, value: 1 });
      if (flush) await client.events.flush();
      return eventID;
    },
    retry,
    async returnToVortex() {
      if (actionButton) {
        actionButton.disabled = true;
        actionButton.textContent = "Returning...";
      }
      await adapter.ready;
      if (!client) return;
      try {
        await client.events.flush();
      } catch {
        // Explicit session termination still matters if queued telemetry cannot flush.
      }
      try {
        await client.play.end("quit");
      } catch {
        // The validated Vortex route remains the safe recovery destination.
      }
      client.navigation.returnToVortex("/");
    },
    _validateRuntimeConfig: validateRuntimeConfig,
  };

  window.addEventListener("lila:vortex-move-accepted", (event) => {
    const detail = event.detail || {};
    const variant = normalizeVariant(detail.variant);
    const signature = `${detail.gameId || ""}:${detail.ply || ""}`;
    if (!variant || !detail.gameId || !Number.isInteger(detail.ply) || observedMoves.has(signature)) return;
    observedMoves.add(signature);
    void adapter.trackObserved("lila.move.accepted", { variant }).catch(() => {});
  });

  window.addEventListener("lila:vortex-game-completed", (event) => {
    const detail = event.detail || {};
    const variant = normalizeVariant(detail.variant);
    if (
      !variant ||
      !detail.gameId ||
      !["win", "loss", "draw"].includes(detail.result) ||
      completedGames.has(detail.gameId)
    ) return;
    completedGames.add(detail.gameId);
    void adapter
      .trackObserved(
        "lila.game.completed",
        { variant, result: detail.result, termination: String(detail.termination || "unknown").slice(0, 32) },
        true,
      )
      .catch(() => {});
  });

  window.lilaVortex = adapter;
  adapter.ready = initialize();
})();
