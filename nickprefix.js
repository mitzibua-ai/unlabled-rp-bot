/**
 * Nickname prefixes from faction roles, e.g. "EMS Smookey" / "PD Smookey" / "STVL Smookey".
 * Optional env: ROLE_NICK_PREFIX_MAP=roleId:EMS,roleId:PD
 */

function parsePrefixMap() {
  const map = {};
  const raw = process.env.ROLE_NICK_PREFIX_MAP || "";
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(":");
    if (idx <= 0) continue;
    const id = trimmed.slice(0, idx).trim();
    const prefix = trimmed.slice(idx + 1).trim();
    if (id && prefix) map[id] = prefix;
  }
  return map;
}

/**
 * Derive a nick prefix from a Discord role (EMS / PD / gang name, etc.).
 */
function getPrefixForRole(roleId, roleName) {
  const fromMap = parsePrefixMap()[String(roleId || "")];
  if (fromMap) return fromMap.slice(0, 16);

  const n = String(roleName || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
  if (!n) return null;

  if (
    /\bEMS\b/.test(n) ||
    n.includes("PARAMEDIC") ||
    n.includes("MEDIC") ||
    n.includes("FIRE RESCUE")
  ) {
    return "EMS";
  }

  if (
    /\bPD\b/.test(n) ||
    n.includes("POLICE") ||
    n.includes("LSPD") ||
    n.includes("SAPD") ||
    n.includes("SHERIFF") ||
    n.includes("LAW ENFORCEMENT")
  ) {
    return "PD";
  }

  // Gangs / other factions: drop rank words, use the faction label
  let label = n
    .replace(
      /\b(DIRECTOR|PATRON|MEMBER|RECRUIT|TRAINEE|OFFICER|CHIEF|LEADER|BOSS|ENFORCER|SOLDIER|PROSPECT)\b/g,
      ""
    )
    .replace(/\s+/g, " ")
    .trim();
  if (!label) label = n;

  const first = label.split(/[\s\-_/|]+/).filter(Boolean)[0] || label;
  return first.slice(0, 16);
}

/** Remove a leading "PREFIX " or legacy "PREFIX | " tag from a display name. */
function stripPrefix(displayName, prefix) {
  const current = String(displayName || "").trim();
  if (!current) return "";

  if (prefix) {
    // New format: "STVL Smookey"  / legacy: "STVL | Smookey"
    const re = new RegExp(
      `^${escapeRegExp(prefix)}(?:\\s*\\|\\s*|\\s+)`,
      "i"
    );
    if (re.test(current)) {
      return current.replace(re, "").trim();
    }
  }

  // Legacy pipe-only fallback: "SOMETHING | Name"
  return current.replace(/^[A-Za-z0-9]{1,16}\s*\|\s*/, "").trim();
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildPrefixedNick(prefix, baseName) {
  const base = String(baseName || "").trim() || "Unknown";
  return `${prefix} ${base}`.slice(0, 32);
}

/**
 * After a role is granted: set nick to "PREFIX ICName".
 * Returns { ok, nick, note }.
 */
async function applyRolePrefix(member, { roleId, roleName, icName }) {
  const prefix = getPrefixForRole(roleId, roleName);
  if (!prefix) {
    return { ok: false, nick: null, note: "", changed: false };
  }

  const base =
    stripPrefix(icName, prefix) ||
    stripPrefix(member.nickname || member.displayName, prefix) ||
    member.user.username;

  const nick = buildPrefixedNick(prefix, base);

  try {
    await member.setNickname(nick, `Role granted: ${roleName}`);
    return { ok: true, nick, note: "", changed: true };
  } catch (err) {
    console.error("Failed to set role nick prefix:", err.message);
    return {
      ok: false,
      nick: null,
      note: " (Role added, but nickname could not be updated — check bot hierarchy.)",
      changed: false,
    };
  }
}

/**
 * After a role is removed: strip "PREFIX " from the nick.
 * Returns { ok, nick, note, changed }.
 */
async function removeRolePrefix(member, { roleId, roleName, icName }) {
  const prefix = getPrefixForRole(roleId, roleName);
  const current = member.nickname || member.displayName || "";
  let next = stripPrefix(current, prefix);

  if (!next && icName) {
    next = stripPrefix(icName, prefix) || String(icName).trim();
  }
  if (!next) next = member.user.username;
  next = next.slice(0, 32);

  // Nothing to change
  if (next === current) {
    return { ok: true, nick: next, note: "", changed: false };
  }

  try {
    await member.setNickname(next, `Role removed: ${roleName}`);
    return { ok: true, nick: next, note: "", changed: true };
  } catch (err) {
    console.error("Failed to clear role nick prefix:", err.message);
    return {
      ok: false,
      nick: null,
      note: " (Role removed, but nickname could not be updated — check bot hierarchy.)",
      changed: false,
    };
  }
}

module.exports = {
  getPrefixForRole,
  stripPrefix,
  buildPrefixedNick,
  applyRolePrefix,
  removeRolePrefix,
};
