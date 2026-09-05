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
    this.jobs.unshift(entry);
    if (this.jobs.length > 80) this.jobs.length = 80;
    this.emit('queued', entry);
    this.processNext();
    return entry;
  }

  processNext() {
    if (this.isProcessing) return;
    const nextJob = this.jobs.find((job) => job.status === 'queued');
    if (!nextJob) return;
    this.isProcessing = true;
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

  backlog() {
    return this.jobs.filter((job) => job.status === 'queued' || job.status === 'processing').length;
  }
}

module.exports = {
  InvoiceQueue,
  invoiceQueue: new InvoiceQueue()
};
