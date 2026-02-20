/**
 * WhatsApp Bridge client — calls the whatsapp-bridge HTTP API
 * to send and search WhatsApp messages.
 */

export class WhatsAppBridge {
  constructor(baseUrl = 'http://whatsapp-bridge:8080') {
    this.baseUrl = baseUrl;
  }

  async send(recipient, message) {
    // Strip + and spaces from phone number
    const clean = recipient.replace(/[+\s\-()]/g, '');

    const res = await fetch(`${this.baseUrl}/api/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: clean, message }),
    });

    if (!res.ok) {
      throw new Error(`WhatsApp send failed: HTTP ${res.status}`);
    }

    const data = await res.json();
    if (!data.success) {
      throw new Error(data.message || 'WhatsApp send failed');
    }

    return data;
  }

  async searchContacts(query) {
    try {
      const res = await fetch(
        `${this.baseUrl}/api/contacts/search?q=${encodeURIComponent(query)}`
      );
      if (!res.ok) return [];
      return await res.json();
    } catch {
      return [];
    }
  }

  async isAvailable() {
    try {
      const res = await fetch(`${this.baseUrl}/api/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: '', message: '' }),
      });
      // Even a 400 means the bridge is up
      return res.status !== 0;
    } catch {
      return false;
    }
  }
}
