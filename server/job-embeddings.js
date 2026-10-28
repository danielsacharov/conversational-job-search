class JobEmbeddingStore {
  async search() {
    return []
  }

  async setBatch() {
    return
  }
}

const jobEmbeddingStore = new JobEmbeddingStore()

module.exports = { jobEmbeddingStore }
