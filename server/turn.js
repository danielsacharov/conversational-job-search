const { normalizeFilters } = require("./schema")
const { compoundWork, isNationwide, mentionsNationwide, placeAround, radiusMention, tidyPlace } = require("./geo")

const STOP = new Set(["ich", "du", "mir", "dir", "ein", "eine", "einen", "rezept", "fuer", "für", "mal", "bitte", "was", "wie", "und", "oder", "the", "a", "job", "jobs", "stelle", "stellen"])
const FILLER = new Set(["egal", "iwas", "irgendwas", "wasauchimmer", "wasauch", "alles", "beliebig", "irgendein", "irgendeine", "egalwas", "irgendetwas", "keineahnung", "weissnicht", "weißnicht", "miregal"])

function emptyData() {
  return {
    jobTitle: [],
    location: "",
    radius: null,
    remote: null,
    hybrid: null,
    skills: [],
    clauses: [],
    readyToSearch: false
  }
}

function coerceBool(value) {
  if (value === true || value === false) return value
  if (value === "true") return true
  if (value === "false") return false
  return null
}

function coerceRadius(value) {
  if (value == null || value === "") return null
  const numeric = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(numeric)) return null
  const rounded = Math.round(numeric)
  if (rounded < 1 || rounded > 200) return null
  return rounded
}

function tidyRole(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim()
  if (!text) return ""
  return text.split(" ").map((word, index) => {
    if (index > 0 && /^(und|oder|als|im|in|am|an|der|die|das|mit|für|fur|of|for)$/i.test(word)) return word.toLowerCase()
    if (/^[A-Z0-9]{2,4}$/.test(word)) return word
    return word.charAt(0).toUpperCase() + word.slice(1)
  }).join(" ")
}

function titlesOf(value) {
  if (value == null || value === false) return []
  if (Array.isArray(value)) return unique(value.flatMap((item) => titlesOf(item)))
  const text = String(value).trim()
  if (!text || /^null$/i.test(text) || text === "[]") return []
  return unique(text.split(/\s+(?:oder|or)\s+|\s*\/\s*|,\s*/i).map(tidyRole).filter(Boolean))
}

function skillsOf(value) {
  const parts = Array.isArray(value) ? value : [value]
  const found = []
  for (const part of parts) {
    if (part == null || part === false) continue
    const text = String(part).trim()
    if (!text || /^null$/i.test(text)) continue
    for (const piece of text.split(/\s*\+\s*|\s*,\s*|\s+\b(?:und|and|oder|or)\b\s+/i)) {
      const tidy = tidyRole(piece)
      if (tidy && tidy.length > 1) found.push(tidy)
    }
  }
  return unique(found)
}

function unique(list) {
  const seen = new Set()
  const items = []
  for (const item of list || []) {
    const key = String(item).toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    items.push(item)
  }
  return items
}

function locationOf(value) {
  const text = String(value || "").trim()
  if (!text || /^(null|string|array)$/i.test(text)) return ""
  if (isNationwide(text)) return tidyPlace(text)
  return tidyPlace(text.split(/\s+(?:oder|or)\s+/i)[0])
}

function clausesOf(value) {
  if (!Array.isArray(value)) return []
  return value.slice(0, 4).map((item) => ({
    location: locationOf(item?.location),
    radius: coerceRadius(item?.radius),
    remote: coerceBool(item?.remote),
    hybrid: coerceBool(item?.hybrid)
  })).filter((item) => item.location || item.remote != null || item.hybrid != null || item.radius != null)
}

function sanitizeData(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return emptyData()
  return {
    jobTitle: titlesOf(raw.jobTitle),
    location: locationOf(raw.location),
    radius: coerceRadius(raw.radius),
    remote: coerceBool(raw.remote),
    hybrid: coerceBool(raw.hybrid),
    skills: skillsOf(raw.skills),
    clauses: clausesOf(raw.clauses),
    readyToSearch: raw.readyToSearch === true || raw.readyToSearch === "true"
  }
}

function searchSignals(text) {
  return /\b(?:remote|hybrid|home\s*-?\s*office|homeoffice|stelle|stellen|job|jobs|beruf|gehalt|teilzeit|vollzeit|suche|suchst|suchen)\b/i.test(text)
    || /\d+\s*km\b/i.test(text)
    || mentionsNationwide(text)
}

function isHesitation(text) {
  if (searchSignals(text)) return false
  const lower = String(text || "").toLowerCase().replace(/[!?.]+/g, " ").replace(/\s+/g, " ").trim()
  if (/^e+i+\b/.test(lower)) return true
  if (/\b(?:lass|laß)\s+mich\b/.test(lower) && /\b(?:überlegen|uberlegen|nachdenken)\b/.test(lower)) return true
  if (/^(?:hm+|hmm+|äh+|aeh+|moment|warte|sekunde|gleich)\b/.test(lower)) return true
  return false
}

function isOffTopic(text) {
  if (searchSignals(text)) return false
  return /\b(?:rezept|rezeptidee|kochen|carbonara|backen|witz|philosophie|wetter|gedicht|lied)\b/i.test(text)
}

function isCrisis(text) {
  return /\b(?:nicht mehr leben|nicht weiterleben|suizid|selbstmord|umbringen|sterben wollen|mir das leben nehmen|mein leben beenden)\b/i.test(text)
}

function normalizeSafety(value) {
  return value === "check-in" || value === "awaiting-search" ? value : null
}

function isUnsafeStatement(text) {
  return /\b(?:ich bin|fühle mich|fühl mich)\s+(?:gerade\s+)?(?:nicht sicher|unsicher|in gefahr|gefährdet)\b|\bich habe angst, mir etwas anzutun\b/i.test(String(text || ""))
}

function isSafeStatement(text) {
  const value = String(text || "")
  if (/\b(?:nicht|gar nicht)\s+(?:in\s+)?(?:sicher|gut|okay|ok)\b|\b(?:unsicher|in gefahr|gefährdet)\b/i.test(value) && !/\bich bin (?:gerade )?nicht in gefahr\b/i.test(value)) return false
  return /\b(?:ich bin|fühle mich|fühl mich)\s+(?:gerade\s+)?(?:sicher|gut|okay|ok)\b|\bmir geht(?:'s| es)\s+(?:gerade\s+)?(?:gut|okay|ok)\b|\bich bin (?:gerade )?nicht in gefahr\b/i.test(value)
}

function hasSearchConsent(text) {
  return /\b(?:möchte|moechte|will|lass uns|kannst du)\b.{0,80}\b(?:suchen|jobsuche|weitermachen|fortsetzen|weitersuchen)\b|\b(?:jobsuche fortsetzen|mit der jobsuche weitermachen|weiter suchen|weitersuchen)\b/i.test(String(text || ""))
}

function declinesSearch(text) {
  return /^\s*(?:nein|lieber nicht|pause|pausieren|später|spaeter|doch nicht)\b/i.test(String(text || ""))
}

function crisisReply() {
  return "Das klingt nach einem ernsten Thema. Geht es dir selbst gerade wirklich gut, oder belastet dich das persönlich? Bist du im Moment in Sicherheit? Wenn du akut in Gefahr bist, ruf bitte 112 an; die TelefonSeelsorge erreichst du unter 0800 111 0 111 oder 116 123. Möchtest du mit der Jobsuche weitermachen oder lieber pausieren?"
}

function resolveSafetyTurn(text, safety) {
  const state = normalizeSafety(safety)
  if (isCrisis(text) || isUnsafeStatement(text)) {
    return { assistantMessage: crisisReply(), safety: "check-in", resumeSearch: false }
  }
  if (state === "check-in") {
    if (isSafeStatement(text) && hasSearchConsent(text)) {
      return { assistantMessage: "", safety: null, resumeSearch: true }
    }
    if (isSafeStatement(text)) {
      return {
        assistantMessage: "Danke, dass du mir sagst, dass du gerade sicher bist. Möchtest du mit der Jobsuche weitermachen oder lieber pausieren?",
        safety: "awaiting-search",
        resumeSearch: false
      }
    }
    return {
      assistantMessage: "Bevor wir zur Jobsuche wechseln: Bist du gerade in Sicherheit? Und möchtest du mit der Jobsuche weitermachen oder lieber pausieren?",
      safety: "check-in",
      resumeSearch: false
    }
  }
  if (state === "awaiting-search") {
    if (declinesSearch(text)) {
      return {
        assistantMessage: "Alles klar, dann pausieren wir die Jobsuche. Wenn du möchtest, können wir später weitermachen.",
        safety: null,
        resumeSearch: false
      }
    }
    if (hasSearchConsent(text) || /^\s*(?:ja|gerne|gern|klar|bitte)\b/i.test(String(text || ""))) {
      return { assistantMessage: "", safety: null, resumeSearch: true }
    }
    return {
      assistantMessage: "Möchtest du jetzt mit der Jobsuche weitermachen oder lieber pausieren?",
      safety: "awaiting-search",
      resumeSearch: false
    }
  }
  return null
}

function designAliases(roles) {
  const blob = (roles || []).join(" ").toLowerCase()
  if (!/product designer|design engineer|produktdesigner|product design/.test(blob)) return []
  const known = new Set((roles || []).map((role) => role.toLowerCase()))
  return ["UX Designer", "UI Designer", "Product Design", "Produktdesigner", "Design Engineer", "Product Designer"]
    .filter((role) => !known.has(role.toLowerCase()))
}

function plausibleRole(role) {
  const words = String(role || "").toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length || words.length > 6) return false
  if (words.every((word) => STOP.has(word))) return false
  if (words.some((word) => FILLER.has(word))) return false
  if (role.length < 4) return false
  return role.length >= 4 && role.length <= 60
}

function rolesFromText(text) {
  const cut = String(text || "").search(/\b(?:also|sowie|remote|hybrid|home\s*-?\s*office|homeoffice)\b/i)
  let head = (cut === -1 ? String(text || "") : String(text || "").slice(0, cut)).trim()
  head = head.replace(/^(?:ich\s+)?(?:suche|such|bräuchte|braeuchte|möchte|moechte|hätte gern|haette gern|bitte)\s+(?:einen\s+|eine\s+|ein\s+|nach\s+)?/i, "")
  head = head.replace(/^(?:jobs?\s+als\s+|stelle\s+als\s+|beruf\s+als\s+)/i, "")
  if (!head) return []
  return unique(head.split(/\s+\b(?:oder|or)\b\s+|\s*\/\s*|\s*,\s*/i).map(tidyRole).filter(plausibleRole))
}

function skillsFromText(text) {
  const match = String(text || "").match(/\b(?:also|sowie)\s+(.+?)(?=\b(?:remote|hybrid|home\s*-?\s*office|homeoffice)\b|$)/i)
  if (!match) return []
  return skillsOf(match[1])
}

function readUtterance(text) {
  return {
    roles: rolesFromText(text),
    skills: skillsFromText(text),
    compound: compoundWork(text),
    city: placeAround(text),
    radius: radiusMention(text)
  }
}

function wordsIn(text, phrase) {
  const said = new Set(String(text || "").toLowerCase().match(/[a-zäöü0-9+#]{2,}/g) || [])
  const parts = String(phrase || "").toLowerCase().match(/[a-zäöü0-9+#]{2,}/g) || []
  return parts.length > 0 && parts.every((part) => said.has(part))
}

function pickRoles(modelRoles, spokenRoles, text) {
  const fromText = spokenRoles.filter((role) => wordsIn(text, role))
  if (fromText.length >= 2) return fromText
  const model = modelRoles.filter((role) => wordsIn(text, role) || fromText.length === 0)
  if (model.length) return model
  return fromText
}

function pickSkills(modelSkills, spokenSkills) {
  if (spokenSkills.length >= 2) return spokenSkills
  if (modelSkills.length) return modelSkills
  return spokenSkills
}

function compoundFromClauses(clauses) {
  const remote = (clauses || []).find((clause) => clause.remote === true && isNationwide(clause.location) && clause.hybrid !== true)
  const local = (clauses || []).find((clause) => clause.hybrid === true && clause.location && !isNationwide(clause.location) && clause.radius)
  if (!remote || !local) return null
  return { city: local.location, radius: local.radius }
}

function compoundFromFlat(parsed, text) {
  if (parsed.remote !== true || parsed.hybrid !== true || parsed.radius == null) return null
  const city = parsed.location && !isNationwide(parsed.location) ? parsed.location : placeAround(text)
  if (!city || !mentionsNationwide(text)) return null
  return { city, radius: parsed.radius }
}

function placePlan(parsed, said, text) {
  const compound = said.compound || compoundFromClauses(parsed.clauses) || compoundFromFlat(parsed, text)
  if (compound) {
    return {
      specified: true,
      locations: [compound.city],
      locationAny: false,
      radiusKm: compound.radius,
      remote: "allowed",
      hybrid: true,
      alsoFullyRemote: true
    }
  }
  const spokenCity = said.city && !isNationwide(said.city) ? said.city : ""
  const location = parsed.location || spokenCity
  const radius = parsed.radius != null ? parsed.radius : said.radius
  const nationwide = isNationwide(location) || (mentionsNationwide(text) && !spokenCity && parsed.remote === true && parsed.hybrid !== true)
  const specified = Boolean(location || radius != null || parsed.remote != null || parsed.hybrid != null || spokenCity || (mentionsNationwide(text) && parsed.remote != null))
  if (!specified) return { specified: false }
  if (nationwide && !spokenCity) {
    return {
      specified: true,
      locations: [],
      locationAny: true,
      radiusKm: null,
      remote: parsed.remote === false ? "unspecified" : "required",
      hybrid: false,
      alsoFullyRemote: false
    }
  }
  const city = location && !isNationwide(location) ? location : spokenCity
  let remote = "unspecified"
  if (parsed.hybrid === true) remote = "allowed"
  else if (parsed.remote === true) remote = "required"
  else if (parsed.remote === false) remote = "onsite"
  return {
    specified: true,
    locations: city ? [tidyPlace(city)] : [],
    locationAny: false,
    radiusKm: radius,
    remote,
    hybrid: parsed.hybrid === true,
    alsoFullyRemote: false
  }
}

function intentLine(filters) {
  const roles = (filters.roles || []).join(" oder ")
  const skills = (filters.skills || []).length ? "Skills: " + filters.skills.join(", ") : ""
  let place = ""
  if (filters.alsoFullyRemote) {
    place = "remote in Deutschland oder hybrid innerhalb von " + filters.radiusKm + " km um " + (filters.locations || []).join(", ")
  } else if (filters.locationAny) {
    place = "bundesweit"
  } else if ((filters.locations || []).length) {
    place = filters.locations.join(", ")
    if (filters.radiusKm) place += ", " + filters.radiusKm + " km"
  }
  return [roles, skills, place].filter(Boolean).join(". ").slice(0, 400)
}

function withBranches(filters) {
  if (!(filters.alsoFullyRemote && filters.radiusKm && (filters.locations || []).length)) {
    return { ...filters, branches: filters.alsoFullyRemote ? filters.branches : [] }
  }
  const city = filters.locations.join(", ")
  const base = { ...filters, branches: [], alsoFullyRemote: false }
  return {
    ...filters,
    branches: [
      {
        label: "remote deutschland (bundesweit, vollständig remote)",
        filters: {
          ...base,
          locations: [],
          locationAny: true,
          radiusKm: null,
          remote: "required",
          hybrid: false
        }
      },
      {
        label: "hybrid " + filters.radiusKm + " km " + city + " (nicht vollständig remote)",
        filters: {
          ...base,
          locations: [...filters.locations],
          locationAny: false,
          radiusKm: filters.radiusKm,
          remote: "allowed",
          hybrid: true
        }
      }
    ]
  }
}

function enough(filters) {
  return Boolean(
    (filters.roles || []).length
    || (filters.locations || []).length
    || filters.locationAny
    || filters.remote === "required"
    || filters.remote === "allowed"
    || filters.hybrid
    || filters.alsoFullyRemote
  )
}

function explicitSearch(text, filters) {
  if (!searchSignals(text) && !compoundWork(text)) return false
  return enough(filters)
}

function decideReady(text, parsed, filters) {
  if (isHesitation(text) || isOffTopic(text) || isCrisis(text)) return false
  const lower = String(text || "").toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, " ").replace(/\s+/g, " ").trim()
  if (!lower) return false
  const tokens = lower.split(/\s+/).filter(Boolean)
  const garbage = tokens.length > 0 && tokens.every((t) => t.length <= 2 || /^(hu|ei|ha|hm|he|ja|ne|ok|ey|oh|ah|alter|hey|na|so)$/.test(t))
  if (garbage) return false
  if (!enough(filters)) return false
  if (!(filters.roles && filters.roles.length)) {
    return false
  }
  if (parsed.readyToSearch === true) return true
  return explicitSearch(text, filters)
}

function extracted(parsed, ready) {
  return {
    ready,
    readyToSearch: ready,
    jobTitle: parsed.jobTitle,
    location: parsed.location,
    radius: parsed.radius,
    remote: parsed.remote,
    hybrid: parsed.hybrid,
    skills: parsed.skills,
    clauses: parsed.clauses
  }
}

function visibleMessage(text) {
  const raw = String(text || "")
  const at = raw.indexOf("###DATA###")
  const cut = (at === -1 ? raw : raw.slice(0, at)).replace(/\{[\s\S]{0,4000}"readyToSearch"[\s\S]*$/i, "").trim()
  return cut || "Erzähl mir gern, wonach du suchst."
}

function resolveTurn(reply, userText, previousRaw) {
  const previous = normalizeFilters(previousRaw)
  const message = visibleMessage(reply?.assistantMessage)
  const parsed = sanitizeData(reply?.data)
  const text = String(userText || "")
  if (isHesitation(text) || isOffTopic(text) || isCrisis(text)) {
    return {
      assistantMessage: isCrisis(text) ? crisisReply(message) : message,
      ready: false,
      filters: previous,
      extracted: extracted(parsed, false)
    }
  }
  const lower = String(text || "").toLowerCase().replace(/[^\p{L}\p{N}\s+#]+/gu, " ").replace(/\s+/g, " ").trim()
  if (lower) {
    const tokens = lower.split(/\s+/).filter(Boolean)
    const garbage = tokens.length > 0 && tokens.every((t) => t.length <= 2 || /^(hu|ei|ha|hm|he|ja|ne|ok|ey|oh|ah|alter|hey|na|so|naja|jo|mhm|mmm)$/.test(t) || /^(remote|hybrid|homeoffice|home|office)$/.test(t))
    if (garbage) {
      const emptyFilters = normalizeFilters({ ...previous, roles: [], skills: [], locations: [], locationAny: false, radiusKm: null, remote: "unspecified", hybrid: false, alsoFullyRemote: false, branches: [], aliases: [], query: "", intent: "" })
      return {
        assistantMessage: message,
        ready: false,
        filters: emptyFilters,
        extracted: extracted({ ...parsed, readyToSearch: false, jobTitle: [], location: "", radius: null, remote: null, hybrid: null, skills: [], clauses: [] }, false)
      }
    }
  }
  const said = readUtterance(text)
  const roles = pickRoles(parsed.jobTitle, said.roles, text)
  const skills = pickSkills(parsed.skills, said.skills)
  const aliases = designAliases(roles)
  const plan = placePlan(parsed, said, text)
  const drafted = normalizeFilters({
    ...previous,
    roles: roles.length ? roles : previous.roles,
    skills: skills.length ? skills : previous.skills,
    aliases: aliases.length ? aliases : previous.aliases,
    locations: plan.specified ? plan.locations : previous.locations,
    locationAny: plan.specified ? plan.locationAny : previous.locationAny,
    radiusKm: plan.specified ? (plan.radiusKm != null ? plan.radiusKm : previous.radiusKm) : previous.radiusKm,
    remote: plan.specified && plan.remote !== "unspecified" ? plan.remote : (plan.specified ? plan.remote : previous.remote),
    hybrid: plan.specified ? plan.hybrid : previous.hybrid,
    alsoFullyRemote: plan.specified ? plan.alsoFullyRemote : previous.alsoFullyRemote,
    branches: [],
    query: (roles[0] || previous.roles[0] || previous.query || ""),
    intent: ""
  })
  const filters = normalizeFilters(withBranches({
    ...drafted,
    intent: intentLine(drafted)
  }))
  const ready = decideReady(text, parsed, filters)
  return {
    assistantMessage: message,
    ready,
    filters,
    extracted: extracted(parsed, ready)
  }
}

module.exports = { resolveTurn, resolveSafetyTurn, normalizeSafety, sanitizeData, readUtterance }
