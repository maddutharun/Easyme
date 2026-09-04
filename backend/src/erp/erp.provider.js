class ERPProvider {
  async getVendor() { throw new Error('ERPProvider.getVendor must be implemented by an adapter'); }
  async getPurchaseOrder() { throw new Error('ERPProvider.getPurchaseOrder must be implemented by an adapter'); }
  async validateInvoice() { throw new Error('ERPProvider.validateInvoice must be implemented by an adapter'); }
  async postInvoice() { throw new Error('ERPProvider.postInvoice must be implemented by an adapter'); }
  async getPostedDocument() { throw new Error('ERPProvider.getPostedDocument must be implemented by an adapter'); }
}

module.exports = { ERPProvider };
