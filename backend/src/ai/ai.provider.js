  class AIProvider {
  async extractInvoice() {
    throw new Error('AIProvider.extractInvoice must be implemented by an adapter');
  }

  async createEmbedding() {
    throw new Error('AIProvider.createEmbedding must be implemented by an adapter');
  }
}

module.exports = { AIProvider };
