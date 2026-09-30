const { PermissionFlagsBits } = require("discord.js");

function parseIdList(...parts) {
  const raw = parts.filter(Boolean).join(",");
  return [
    ...new Set(
      raw
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
    ),
  ];
}

/**
 * All roles with approve / ticket / $ powers:
 * ADMIN_ROLE_ID, MODERATOR_ROLE_ID, STAFF_ROLE_ID (legacy),
 * HEAD_ADMIN_ROLE_ID, and POWER_ROLE_IDS (comma-separated extras).
 */
function getPowerRoleIds() {
  return parseIdList(
    process.env.ADMIN_ROLE_ID,
    process.env.MODERATOR_ROLE_ID,
    process.env.STAFF_ROLE_ID,
    process.env.HEAD_ADMIN_ROLE_ID,
    process.env.POWER_ROLE_IDS
  );
}

/** @deprecated alias — same as getPowerRoleIds (ticket access + permissions) */
function getModeratorRoleIds() {
  return getPowerRoleIds();
}

function getAdminRoleId() {
  return (process.env.ADMIN_ROLE_ID || "").trim();
}

function getModeratorRoleId() {
  return (
    (process.env.MODERATOR_ROLE_ID || "").trim() ||
    (process.env.STAFF_ROLE_ID || "").trim()
  );
}

/** Role IDs pinged when a ticket opens (supports comma-separated list) */
function getTicketPingRoleIds() {
  const fromEnv = parseIdList(process.env.TICKET_PING_ROLE_ID);
  if (fromEnv.length) return fromEnv;
  const fallback = getModeratorRoleId();
  return fallback ? [fallback] : [];
}

/** @deprecated — use getTicketPingRoleIds(); returns first ping role only */
function getTicketPingRoleId() {
  return getTicketPingRoleIds()[0] || "";
}

function isAdmin(member) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  const adminRole = getAdminRoleId();
  const headAdmin = (process.env.HEAD_ADMIN_ROLE_ID || "").trim();
  if (adminRole && member.roles.cache.has(adminRole)) return true;
  if (headAdmin && member.roles.cache.has(headAdmin)) return true;
  return false;
}

/** Anyone with a power role (or Discord Administrator) */
function isStaff(member) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return getPowerRoleIds().some((id) => member.roles.cache.has(id));
}

const isModerator = isStaff;

/** Mentions for new tickets — each role as its own <@&id> */
function staffPingContent() {
  return getTicketPingRoleIds()
    .map((id) => `<@&${id}>`)
    .join(" ");
}

/**
 * Leadership roles that can approve role/unrole requests:
 * - Any role ending with " PATRON" (e.g. BALLAS PATRON)
 * - EMS DIRECTOR
 * - POLICE DIRECTOR
 * Plus optional env IDs: ROLE_REQUEST_APPROVER_ROLE_IDS, EMS_DIRECTOR_ROLE_ID, POLICE_DIRECTOR_ROLE_ID, GANG_PATRON_ROLE_IDS
 */
function isFactionLeaderRoleName(name) {
  const n = String(name || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
  if (!n) return false;
  if (n === "EMS DIRECTOR" || n === "POLICE DIRECTOR") return true;
  if (n.endsWith(" PATRON")) return true;
  return false;
}

function getFactionLeaderRoleIds(guild) {
  const fromEnv = parseIdList(
    process.env.ROLE_REQUEST_APPROVER_ROLE_IDS,
    process.env.UNROLE_APPROVER_ROLE_IDS,
    process.env.EMS_DIRECTOR_ROLE_ID,
    process.env.POLICE_DIRECTOR_ROLE_ID,
    process.env.GANG_PATRON_ROLE_IDS
  );

  const fromNames = [];
  if (guild?.roles?.cache) {
    for (const role of guild.roles.cache.values()) {
      if (isFactionLeaderRoleName(role.name)) fromNames.push(role.id);
    }
  }

  return [...new Set([...fromEnv, ...fromNames])];
}

function isFactionLeader(member) {
  if (!member) return false;
  const ids = getFactionLeaderRoleIds(member.guild);
  return ids.some((id) => member.roles.cache.has(id));
}

module.exports = {
  isStaff,
  isAdmin,
  isModerator,
  getPowerRoleIds,
  getModeratorRoleIds,
  getAdminRoleId,
  getModeratorRoleId,
  getTicketPingRoleId,
  getTicketPingRoleIds,
  staffPingContent,
  isFactionLeaderRoleName,
  getFactionLeaderRoleIds,
  isFactionLeader,
};
