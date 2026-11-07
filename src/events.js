export class EventBus {
  constructor() {
    this.clients = new Set();
    this.history = [];
    this.maxHistory = 100;
  }

  addClient(res) {
    this.clients.add(res);
    return () => this.clients.delete(res);
  }

  broadcast(type, payload = {}) {
    const event = { type, payload, at: new Date().toISOString() };
    this.history.push(event);
    if (this.history.length > this.maxHistory) this.history.shift();
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of this.clients) {
      try { client.write(data); } catch { this.clients.delete(client); }
    }
    return event;
  }

  recent(limit = 20) {
    return this.history.slice(-limit);
  }
}

export const bus = new EventBus();
