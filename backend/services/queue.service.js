const { EventEmitter } = require('node:events');

class InvoiceQueue extends EventEmitter {
  constructor() {
    super();
    this.jobs = [];
    this.isProcessing = false;
  }

  enqueue(job) {
    const entry = {
      id: job.id || `job-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type: job.type || 'invoice-processing',
      payload: job.payload || {},
      createdAt: new Date().toISOString(),
      status: 'queued'
    };
    this.jobs.push(entry);
    this.emit('queued', entry);
    this.processNext();
    return entry;
  }

  processNext() {
    if (this.isProcessing || this.jobs.length === 0) return;
    this.isProcessing = true;
    const nextJob = this.jobs.shift();

    nextJob.status = 'processing';
    this.emit('processing', nextJob);

    setTimeout(() => {
      nextJob.status = 'completed';
      nextJob.completedAt = new Date().toISOString();
      this.emit('completed', nextJob);
      this.isProcessing = false;
      this.processNext();
    }, 150);
  }

  list() {
    return this.jobs.slice();
  }
}

module.exports = {
  InvoiceQueue,
  invoiceQueue: new InvoiceQueue()
};
