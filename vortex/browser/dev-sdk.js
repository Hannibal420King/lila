const player = Object.freeze({
  id: "00000000-0000-4000-8000-000000000010",
  handle: "vortex-player",
  displayName: "Vortex Player",
  avatarUrl: null,
});

export async function createVortexGameClient(options = {}) {
  let expired = false;
  const events = (window.__vortexDevEvents ||= []);
  const expire = () => {
    expired = true;
    options.onSessionExpired?.();
  };
  window.addEventListener("vortex:dev-session-expired", expire, { once: true });
  const heartbeat = window.setInterval(() => {
    window.__vortexDevHeartbeats = (window.__vortexDevHeartbeats || 0) + 1;
  }, 1000);

  return {
    auth: {
      async context() {
        if (expired) {
          const error = new Error("Local Vortex fixture session expired");
          error.code = "SESSION_REVOKED";
          throw error;
        }
        return { user: player, app: { clientId: "vortex-lila-local" }, playSessionId: "local-play" };
      },
    },
    play: {
      async end(reason) {
        window.clearInterval(heartbeat);
        sessionStorage.setItem("vortex.dev.play-ended", reason);
      },
    },
    events: {
      track(key, attributes, metadata) {
        const id = crypto.randomUUID();
        events.push({ id, key, attributes, metadata });
        return id;
      },
      async flush() {
        return { accepted: events.length, pending: 0 };
      },
    },
    navigation: {
      returnToVortex(path) {
        sessionStorage.setItem("vortex.dev.return-path", path);
        window.location.assign("/?vortexReturned=1");
      },
    },
  };
}
