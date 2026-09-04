const processInvoice = async (job) => {
  if (!job?.data?.invoiceId) throw new Error('Invoice id is required');
  return { invoiceId: job.data.invoiceId, status: 'RECEIVED' };
};

const workerInstance = process.env.REDIS_URL
  ? new (require('bullmq').Worker)('invoice-processing', processInvoice, { connection: { url: process.env.REDIS_URL } })
  : null;

module.exports = { processInvoice, worker: workerInstance };