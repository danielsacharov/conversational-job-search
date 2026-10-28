function compoundWork() {
  return false
}

function isNationwide() {
  return false
}

function mentionsNationwide() {
  return false
}

function placeAround() {
  return null
}

function radiusMention() {
  return null
}

function tidyPlace(text) {
  return String(text || "").trim()
}

function locate() {
  return null
}

function towns(locations) {
  return Array.isArray(locations) ? locations.slice() : []
}

function inside() {
  return true
}

function closestKm() {
  return null
}

module.exports = { compoundWork, isNationwide, mentionsNationwide, placeAround, radiusMention, tidyPlace, locate, towns, inside, closestKm }
