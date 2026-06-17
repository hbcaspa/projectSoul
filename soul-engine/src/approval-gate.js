/**
 * ApprovalGate — Human-in-the-Loop for risky actions.
 *
 * Inspired by OpenClaw Design Pattern Ch.15:
 * High-stakes actions require human approval before execution.
 * Timeout-based with configurable default action.
 *
 * Risky tools: send_message, gmail_send_email, execute_command,
 * file deletion, financial operations.
 */

const DEFAULT_TIMEOUT = 60000; // 60s to approve

export class ApprovalGate {
  constructor({ bus, telegram, timeout } = {}) {
    this.bus = bus || null;
    this.telegram = telegram || null;
    this.timeout = timeout || DEFAULT_TIMEOUT;
    this.pendingApprovals = new Map();
    this.stats = { requested: 0, approved: 0, denied: 0, timedOut: 0 };

    // Tools that ALWAYS require approval
    this.riskyTools = new Set([
      'gmail_send_email',
      'send_message',           // WhatsApp
      'sparkasse_transfer',
      'sparkasse_confirm_tan',
    ]);

    // Tools that require approval only with certain args
    this.conditionalTools = new Map([
      ['execute_command', (args) => {
        const cmd = (args.command || args.cmd || '').toLowerCase();
        return /rm\s|rmdir|del\s|format|drop\s|delete|shutdown|reboot/.test(cmd);
      }],
    ]);

    // Auto-approved tools (never ask)
    this.safeTools = new Set([
      'search_nodes', 'open_nodes', 'read_graph',
      'create_entities', 'add_observations', 'create_relations',
      'gmail_list_emails', 'gmail_read_email', 'gmail_search_emails',
      'sparkasse_accounts', 'sparkasse_transactions',
      'list_messages', 'list_chats', 'get_chat',
      'search_contacts', 'get_contact_chats', 'get_direct_chat_by_contact',
      'get_last_interaction', 'get_message_context',
    ]);

    // Async pending-approval queue (Sprint 0 completion). The inline requestApproval()
    // path below DEADLOCKS under grammy's sequential long-polling — the "ja" reply can't
    // be processed while handleMessage is blocked awaiting it. This non-blocking queue
    // avoids that: onToolCall enqueues + returns immediately, and a persistent listener
    // runs the call when the owner replies "ja <id>". Fail-closed: execution requires an
    // exact, unexpired id match from the owner — a bug fails to execute, never spuriously.
    this.pendingQueue = new Map(); // id -> { toolName, args, execute, createdAt }
    this.pendingTTL = parseInt(process.env.APPROVAL_PENDING_TTL || '600000'); // 10 min
    this.maxPending = 10;
    if (this.bus) {
      this.bus.on('message.received', (event) => this._handleApprovalReply(event));
    }
  }

  /**
   * Check if a tool requires human approval.
   */
  requiresApproval(toolName) {
    if (this.safeTools.has(toolName)) return false;
    if (this.riskyTools.has(toolName)) return true;
    if (this.conditionalTools.has(toolName)) return true; // Will check args later
    return false;
  }

  /**
   * Request human approval for a tool call.
   * Sends a Telegram message and waits for response.
   *
   * @param {string} toolName
   * @param {object} args
   * @returns {Promise<boolean>} - true if approved
   */
  async requestApproval(toolName, args = {}) {
    this.stats.requested++;

    // Check conditional tools
    if (this.conditionalTools.has(toolName)) {
      const checker = this.conditionalTools.get(toolName);
      if (!checker(args)) return true; // Args are safe, auto-approve
    }

    const approvalId = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Format the approval request
    const argsPreview = Object.entries(args)
      .map(([k, v]) => `  ${k}: ${String(v).substring(0, 100)}`)
      .join('\n');

    const message = `🔒 *Genehmigung erforderlich*\n\n` +
      `Tool: \`${toolName}\`\n` +
      `${argsPreview ? `Args:\n\`\`\`\n${argsPreview}\n\`\`\`\n` : ''}` +
      `\nAntwort mit *ja* oder *nein* (Timeout: ${this.timeout / 1000}s → ablehnen)`;

    if (this.bus) {
      this.bus.safeEmit('gate.approval_requested', {
        source: 'approval-gate',
        approvalId,
        tool: toolName,
        args: argsPreview,
      });
    }

    // If no Telegram, DENY (fail-closed). Previously auto-approved, which was a
    // fail-open hole: a headless node with no notification channel would silently
    // run risky tools (mail/transfer) unattended. Safer to refuse than to act blind.
    if (!this.telegram) {
      console.warn(`  [gate] No notification channel — DENYING ${toolName} (fail-closed)`);
      this.stats.denied++;
      return false;
    }

    // Send notification (sendToOwner — TelegramChannel has no generic send())
    try {
      await this.telegram.sendToOwner(message);
    } catch (err) {
      console.error(`  [gate] Failed to send approval request: ${err.message}`);
      // Can't notify → block for safety
      this.stats.denied++;
      return false;
    }

    // Wait for response
    return new Promise((resolve) => {
      const entry = {
        toolName,
        args,
        resolve,
        timer: setTimeout(() => {
          this.pendingApprovals.delete(approvalId);
          this.stats.timedOut++;
          console.log(`  [gate] Approval timed out for ${toolName}`);
          resolve(false);
        }, this.timeout),
      };

      this.pendingApprovals.set(approvalId, entry);

      // Listen for response on the bus
      const handler = (event) => {
        if (!this.pendingApprovals.has(approvalId)) return;
        const text = (event.text || '').toLowerCase().trim();

        if (text === 'ja' || text === 'yes' || text === 'ok' || text === 'approve') {
          clearTimeout(entry.timer);
          this.pendingApprovals.delete(approvalId);
          this.stats.approved++;
          this.bus.removeListener('message.received', handler);
          resolve(true);
        } else if (text === 'nein' || text === 'no' || text === 'deny' || text === 'block') {
          clearTimeout(entry.timer);
          this.pendingApprovals.delete(approvalId);
          this.stats.denied++;
          this.bus.removeListener('message.received', handler);
          resolve(false);
        }
      };

      if (this.bus) {
        this.bus.on('message.received', handler);
        // Cleanup after timeout
        setTimeout(() => this.bus.removeListener('message.received', handler), this.timeout + 1000);
      }
    });
  }

  /**
   * Non-blocking approval request (avoids the grammy sequential-polling deadlock).
   * Enqueues the call + notifies the owner; the call executes only when the owner
   * replies "ja <id>". Returns { pending:true, id } or, for conditional tools whose
   * args are safe, { pending:false, autoApproved:true } so the caller runs it inline.
   *
   * @param {string} toolName
   * @param {object} args
   * @param {Function} execute - async () => result, run on approval
   */
  enqueueApproval(toolName, args = {}, execute) {
    // Conditional tools with safe args need no human (e.g. execute_command "ls").
    if (this.conditionalTools.has(toolName)) {
      const checker = this.conditionalTools.get(toolName);
      if (!checker(args)) return { pending: false, autoApproved: true };
    }
    this._pruneExpired();
    // Dedup: if an identical call is already pending, reuse its id — avoids spamming
    // the owner (and silently evicting a legit pending) when the autonomous loop
    // re-issues the same tool+args repeatedly.
    const dedupKey = `${toolName}::${JSON.stringify(args)}`;
    for (const [eid, e] of this.pendingQueue) {
      if (e.dedupKey === dedupKey) return { pending: true, id: eid };
    }
    // Bound the queue — drop the oldest entry if full.
    if (this.pendingQueue.size >= this.maxPending) {
      const oldest = this.pendingQueue.keys().next().value;
      if (oldest) this.pendingQueue.delete(oldest);
    }
    const id = Math.random().toString(36).slice(2, 6); // 4-char base36
    this.pendingQueue.set(id, { toolName, args, execute, dedupKey, createdAt: Date.now() });
    this.stats.requested++;

    const argsPreview = Object.entries(args)
      .map(([k, v]) => `  ${k}: ${String(v).substring(0, 100)}`)
      .join('\n');
    const message = `🔒 Genehmigung erforderlich\n\nTool: ${toolName}\n${argsPreview ? `${argsPreview}\n` : ''}\n` +
      `Bestätigen:  ja ${id}\nAblehnen:    nein ${id}\n(läuft ab in ${Math.round(this.pendingTTL / 60000)} Min)`;
    this.telegram?.sendToOwner?.(message).catch(() => {});
    this.bus?.safeEmit?.('gate.approval_requested', { source: 'approval-gate', approvalId: id, tool: toolName });
    return { pending: true, id };
  }

  /** Owner-reply handler for the pending queue. Parses "ja <id>" / "nein <id>". */
  async _handleApprovalReply(event) {
    // CRITICAL fail-closed guard: message.received is engine-wide. It also fires for
    // the UNAUTHENTICATED WhatsApp webhook (engine.js:1854) and cross-device relay —
    // a stranger could otherwise reply "ja <id>" and approve a sparkasse_transfer.
    // Only the owner's authenticated interactive channel (Telegram, owner-filtered in
    // telegram.js) may grant approvals. Everything else (whatsapp/claude-code/relay/
    // unknown) is rejected by default.
    if (event?.channel !== 'telegram') return;
    const text = (event?.text || '').trim().toLowerCase();
    const m = text.match(/^(ja|yes|ok|approve|nein|no|deny)\s+([a-z0-9]{4})$/);
    if (!m) return;
    this._pruneExpired();
    const entry = this.pendingQueue.get(m[2]);
    if (!entry) return; // unknown / expired id → ignore (fail-closed)
    this.pendingQueue.delete(m[2]);
    const approve = /^(ja|yes|ok|approve)$/.test(m[1]);
    if (!approve) {
      this.stats.denied++;
      this.telegram?.sendToOwner?.(`🚫 Abgelehnt: ${entry.toolName}`).catch(() => {});
      this.bus?.safeEmit?.('gate.denied', { source: 'approval-gate', tool: entry.toolName, id: m[2] });
      return;
    }
    this.stats.approved++;
    try {
      const result = await entry.execute();
      this.telegram?.sendToOwner?.(`✅ Ausgeführt: ${entry.toolName}\n${String(result ?? '').substring(0, 500)}`).catch(() => {});
      this.bus?.safeEmit?.('gate.approved', { source: 'approval-gate', tool: entry.toolName, id: m[2] });
    } catch (err) {
      this.telegram?.sendToOwner?.(`❌ Fehler bei ${entry.toolName}: ${err.message}`).catch(() => {});
    }
  }

  _pruneExpired() {
    const now = Date.now();
    for (const [id, e] of this.pendingQueue) {
      if (now - e.createdAt > this.pendingTTL) this.pendingQueue.delete(id);
    }
  }

  /**
   * Add a tool to the risky list.
   */
  addRiskyTool(toolName) {
    this.riskyTools.add(toolName);
  }

  /**
   * Mark a tool as safe (never ask).
   */
  addSafeTool(toolName) {
    this.safeTools.add(toolName);
    this.riskyTools.delete(toolName);
  }

  getStats() {
    return { ...this.stats, pendingCount: this.pendingApprovals.size };
  }
}
