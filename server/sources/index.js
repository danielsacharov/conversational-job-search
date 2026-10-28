async function listings() {
  return { items: [] }
}

async function load(jobs) {
  return Array.isArray(jobs) ? jobs.slice() : []
}

module.exports = { listings, load }
