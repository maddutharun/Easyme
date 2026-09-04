const redisUrl = process.env.REDIS_URL;
  const invoiceQueue = redisUrl
    ? new (require('bullmq').Queue)('invoice-processing', { connection: { url: redisUrl } })
    : null;

const enqueueInvoice = async (invoiceId, fileHash) => {
  if (!invoiceQueue) return { queued: false, mode: 'local', invoiceId };
  const job = await invoiceQueue.add('process-invoice', { invoiceId, fileHash }, {
    jobId: invoiceId,
    attempts: 5,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 1000,
    removeOnFail: 5000
  });
  return { queued: true, mode: 'bullmq', jobId: job.id };
};

module.exports = { invoiceQueue, enqueueInvoice };