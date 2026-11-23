/* Durable check-in intents only. Credentials and the household roster are never stored here. */
(function (root) {
  function database() {
    let connection;
    async function open() {
      if (!connection)
        connection = new Promise((resolve, reject) => {
          const request = indexedDB.open("frfs-pickup-outbox-v1", 1);
          request.onupgradeneeded = () =>
            request.result.createObjectStore("pending", { keyPath: "token" });
          request.onsuccess = () => resolve(request.result);
          request.onerror = () =>
            reject(Error("This iPad could not open its saved check-ins."));
          request.onblocked = () =>
            reject(
              Error(
                "Close other pickup tabs and reload to open saved check-ins.",
              ),
            );
        });
      return connection;
    }
    async function transaction(mode, operation) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("pending", mode),
          request = operation(tx.objectStore("pending"));
        tx.oncomplete = () => resolve(request.result);
        tx.onerror = tx.onabort = () =>
          reject(
            Error(
              "Could not save check-ins on this iPad. Keep this screen open and tell the coordinator.",
            ),
          );
      });
    }
    return {
      list: () => transaction("readonly", (s) => s.getAll()),
      put: (entry) => transaction("readwrite", (s) => s.put(entry)),
      remove: (token) => transaction("readwrite", (s) => s.delete(token)),
    };
  }
  function create({
    send,
    changed = () => {},
    delivered = () => {},
    storage = database(),
    now = () => Date.now(),
    online = () => root.navigator.onLine !== false,
  }) {
    let owner = null,
      entries = [],
      running = null,
      storageError = "";
    const results = new Map();
    const notify = () =>
      changed({ entries: [...entries], storageError, owner });
    async function reload() {
      entries = (await storage.list()).sort(
        (a, b) => a.createdAt - b.createdAt,
      );
      notify();
    }
    async function safe(operation) {
      try {
        const value = await operation();
        storageError = "";
        return value;
      } catch (error) {
        storageError = error.message;
        notify();
        throw error;
      }
    }
    async function put(entry) {
      await safe(() => storage.put(entry));
      await safe(reload);
    }
    async function flush() {
      if (running) return running;
      running = (async () => {
        await safe(reload);
        if (!owner || !online()) return;
        for (const entry of [...entries]) {
          if (!online()) break;
          if (entry.owner !== owner || entry.state === "review") continue;
          const wouldPrint =
            entry.method === "addWalkIn"
              ? entry.request.print !== false
              : entry.request.action === "checkin";
          if (
            wouldPrint &&
            now() - (entry.confirmedAt || entry.createdAt) > 10 * 60 * 1000
          ) {
            await put({
              ...entry,
              state: "review",
              error:
                "Delayed more than 10 minutes. Confirm this household is still waiting before sending.",
            });
            continue;
          }
          try {
            const result = await send(entry.method, entry.request);
            // Keep the intent until a valid application acknowledgement was received.
            if (!result || result.queued || !result.checkedInAt)
              throw Error(
                "Server acknowledgement was incomplete; retrying the saved request.",
              );
            results.set(entry.token, result);
            await safe(() => storage.remove(entry.token));
            await safe(reload);
            delivered(entry, result);
          } catch (error) {
            if (storageError) throw error;
            const review =
              error.status >= 400 &&
              error.status < 500 &&
              ![408, 429].includes(error.status);
            await put({
              ...entry,
              state: review ? "review" : "waiting",
              error: error.message,
            });
            // Network/server outage or authentication failure: do not flood subsequent requests.
            if (!review || error.status === 401 || error.status === 403) break;
          }
        }
      })().finally(() => {
        running = null;
      });
      return running;
    }
    return {
      async bind(actor) {
        owner = actor;
        await safe(reload);
      },
      async submit(method, request, context) {
        if (!owner)
          throw Error("Reconnect this iPad before starting check-ins.");
        await safe(reload);
        const existing = entries.find(
          (e) =>
            e.owner === owner &&
            e.eventId === context.eventId &&
            ((method === "requestAction" &&
              e.method === method &&
              e.request.id === request.id) ||
              e.token === request.token),
        );
        const entry = existing || {
          token: request.token,
          owner,
          method,
          request,
          eventId: context.eventId,
          eventLabel: context.eventLabel,
          name: context.name,
          createdAt: now(),
          state: "waiting",
          error: "",
        };
        if (!existing && entries.length >= 200)
          throw Error(
            "200 check-ins are waiting on this iPad. Reconnect before adding more.",
          );
        if (!existing) await put(entry); // Commit to IndexedDB before touching the network.
        await flush();
        const result = results.get(entry.token);
        results.delete(entry.token);
        return (
          result || {
            queued: true,
            id: entry.request.id || null,
            message:
              "Saved on this iPad—waiting to sync. No label is confirmed. Keep the app open.",
          }
        );
      },
      async retry(token, review = {}) {
        await safe(reload);
        const entry = entries.find((e) => e.token === token);
        if (!entry || entry.owner !== owner)
          throw Error(
            "This request belongs to a different iPad authorization. Ask the coordinator to reconcile it.",
          );
        const request = { ...entry.request };
        if (entry.method === "requestAction" && review.revision !== undefined) {
          if (!Number.isSafeInteger(review.revision) || review.revision < 1)
            throw Error(
              "Refresh and review the current registration before retrying.",
            );
          request.revision = review.revision;
        }
        await put({
          ...entry,
          request,
          state: "waiting",
          error: "",
          confirmedAt: now(),
        });
        await flush();
      },
      pending(id) {
        return entries.find(
          (e) => e.method === "requestAction" && e.request.id === id,
        );
      },
      flush,
    };
  }
  root.FrfsOutbox = { create };
})(globalThis);
