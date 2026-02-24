import cron from 'node-cron';

export class HeartbeatScheduler {
  constructor(cronExpr, handler) {
    this.cronExpr = cronExpr;
    this.handler = handler;
    this.task = null;
  }

  start() {
    if (!cron.validate(this.cronExpr)) {
      console.error(`  [heartbeat] Invalid cron: ${this.cronExpr}`);
      return;
    }

    this.task = cron.schedule(this.cronExpr, async () => {
      try {
        await this.handler();
      } catch (err) {
        console.error(`  [heartbeat] Error: ${err.message}`);
      }
    });
  }

  stop() {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
  }
}
