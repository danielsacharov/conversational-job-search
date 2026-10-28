const { log } = require("./log")

const EMBEDDING_DIM = 384
const BATCH_SIZE = 16

function hashEmbed(text, dim = EMBEDDING_DIM) {
  const vector = new Array(dim).fill(0)
  const tokens = String(text).toLowerCase().match(/[a-zäöü0-9+#]{2,}/g) || []
  for (const token of tokens) {
    const grams = [token]
    for (let index = 0; index < token.length - 2; index += 1) grams.push(token.slice(index, index + 3))
    for (const gram of grams) {
      let hash = 2166136261
      for (let index = 0; index < gram.length; index += 1) {
        hash ^= gram.charCodeAt(index)
        hash = Math.imul(hash, 16777619)
      }
      const slot = Math.abs(hash) % dim
      vector[slot] += hash & 1 ? 1 : -1
    }
  }
  let norm = 0
  for (const value of vector) norm += value * value
  norm = Math.sqrt(norm) || 1
  return vector.map((value) => value / norm)
}

function cosine(left, right) {
  let score = 0
  const length = Math.min(left.length, right.length)
  for (let index = 0; index < length; index += 1) score += left[index] * right[index]
  return score
}

class EmbeddingProvider {
  constructor() {
    this.provider = process.env.EMBEDDING_PROVIDER || "hash"
    this.model = process.env.EMBEDDING_MODEL || "hash-embed"
    this.baseUrl = process.env.EMBEDDING_BASE_URL || ""
    this.apiKey = process.env.EMBEDDING_API_KEY || process.env.NVIDIA_API_KEY || ""
    this.enabled = process.env.EMBEDDING_ENABLED !== "false"
    this.cache = new Map()
  }

  async embed(text) {
    if (!this.enabled || !text || !String(text).trim()) return hashEmbed(text)
    const key = String(text).trim().toLowerCase()
    if (this.cache.has(key)) return this.cache.get(key)
    let vector
    try {
      if (this.provider === "nvidia") {
        vector = await this.embedNvidia(text)
      } else if (this.provider === "ollama") {
        vector = await this.embedOllama(text)
      } else {
        vector = hashEmbed(text)
      }
    } catch (error) {
      log("Embedding-Fehler, Fallback auf Hash: " + error.message)
      vector = hashEmbed(text)
    }
    this.cache.set(key, vector)
    return vector
  }

  async embedBatch(texts) {
    if (!this.enabled || !texts.length) return texts.map(() => hashEmbed(""))
    const results = []
    for (let index = 0; index < texts.length; index += BATCH_SIZE) {
      const batch = texts.slice(index, index + BATCH_SIZE)
      const batchResults = await Promise.all(batch.map((text) => this.embed(text)))
      results.push(...batchResults)
    }
    return results
  }

  async embedNvidia(text) {
    if (!this.apiKey) throw new Error("Kein Embedding API Key")
    const url = this.baseUrl || "https://integrate.api.nvidia.com/v1"
    const response = await fetch(url + "/embeddings", {
      method: "POST",
      signal: AbortSignal.timeout(20000),
      headers: {
        Authorization: "Bearer " + this.apiKey,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        model: this.model || "nvidia/llama-nemotron-embed-1b-v2",
        input: String(text),
        encoding_format: "float",
        dimensions: EMBEDDING_DIM
      })
    })
    if (!response.ok) throw new Error("NVIDIA Embedding " + response.status)
    const data = await response.json()
    const vector = data.data?.[0]?.embedding
    if (!vector || !Array.isArray(vector)) throw new Error("Kein Embedding-Vektor in Antwort")
    return this.normalize(vector)
  }

  async embedOllama(text) {
    const url = this.baseUrl || "http://127.0.0.1:11434"
    const response = await fetch(url + "/api/embeddings", {
      method: "POST",
      signal: AbortSignal.timeout(20000),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model || "nomic-embed-text",
        prompt: String(text)
      })
    })
    if (!response.ok) throw new Error("Ollama Embedding " + response.status)
    const data = await response.json()
    const vector = data.embedding
    if (!vector || !Array.isArray(vector)) throw new Error("Kein Ollama Embedding")
    return this.normalize(vector)
  }

  normalize(vector) {
    let norm = 0
    for (const value of vector) norm += value * value
    norm = Math.sqrt(norm) || 1
    return vector.map((value) => value / norm)
  }
}

const embeddingProvider = new EmbeddingProvider()

module.exports = { EmbeddingProvider, embeddingProvider, hashEmbed, cosine, EMBEDDING_DIM }
