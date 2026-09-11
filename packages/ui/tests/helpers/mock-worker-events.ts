type WorkerListener = (event: Event) => void;

// Mirrors the per-type dispatch of a real Worker: the hooks register
// "message", "error", and "messageerror" on the same instance, so a mock that
// keeps a single listener would deliver responses to the wrong handler.
export class MockWorkerEvents {
  private readonly listeners = new Map<string, Set<WorkerListener>>();

  addEventListener(type: string, listener: WorkerListener) {
    const existing = this.listeners.get(type);
    if (existing) {
      existing.add(listener);
      return;
    }
    this.listeners.set(type, new Set([listener]));
  }

  removeEventListener(type: string, listener: WorkerListener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string, event: Event) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }

  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- The platform event helper forwards structured-clone payloads for several worker protocols.
  respond(data: unknown) {
    this.dispatch("message", new MessageEvent("message", { data }));
  }

  fail() {
    this.dispatch("error", new Event("error"));
  }

  failDeserialization() {
    this.dispatch("messageerror", new Event("messageerror"));
  }

  clearListeners() {
    this.listeners.clear();
  }
}
