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

    // If no Telegram, auto-approve with warning
    if (!this.telegram) {
      console.warn(`  [gate] No notification channel — auto-approving ${toolName}`);
      this.stats.approved++;
      return true;
    }

    // Send notification
    try {
      await this.telegram.send(message, { parse_mode: 'Markdown' });
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
