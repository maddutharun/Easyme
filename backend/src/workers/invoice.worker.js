const processInvoice = async (job) => {
  if (!job?.data?.invoiceId) throw new Error('Invoice id is required');
  return { invoiceId: job.data.invoiceId, status: 'RECEIVED' };
};

let workerInstance = null;
if (process.env.REDIS_URL) {
  try {
    const { Worker } = require('bullmq');
    workerInstance = new Worker('invoice-processing', processInvoice, { connection: { url: process.env.REDIS_URL } });
  } catch (error) {
    console.warn('[worker] bullmq is not available; worker disabled.');
  }
}

module.exports = { processInvoice, worker: workerInstance };
