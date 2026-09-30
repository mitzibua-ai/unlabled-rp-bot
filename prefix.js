const fs = require("fs");
const path = require("path");
const {
  EmbedBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require("discord.js");

const SERVER_NAME = "UNLABLED RP";
const EMBED_COLOR = 0xf1c40f;
const PREFIX = process.env.PREFIX || "$";
const DATA_DIR = path.join(__dirname, "data");
const LOCKDOWN_PATH = path.join(DATA_DIR, "lockdown.json");
const WARNS_PATH = path.join(DATA_DIR, "warns.json");
const TEMPBANS_PATH = path.join(DATA_DIR, "tempbans.json");
const MODLOGS_PATH = path.join(DATA_DIR, "modlogs.json");
const APPS_PATH = path.join(DATA_DIR, "applications.json");

function getLogo(guild) {
  return (
    process.env.SERVER_LOGO_URL ||
    guild?.iconURL({ size: 256, extension: "png" }) ||
    undefined
  );
}

function loadJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function saveJson(filePath, data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function getPrefixRoleIds() {
  const fromEnv = (process.env.PREFIX_ROLE_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (fromEnv.length) return fromEnv;

  const { getModeratorRoleIds } = require("./roles");
  return getModeratorRoleIds();
}

function canUsePrefix(member) {
  if (!member) return false;
  const { isStaff } = require("./roles");
  return isStaff(member) || getPrefixRoleIds().some((id) => member.roles.cache.has(id));
}

function isTicketChannel(channel) {
  return (
    channel?.type === ChannelType.GuildText &&
    typeof channel.topic === "string" &&
    channel.topic.includes("ticket-owner:")
  );
}

async function resolveMember(guild, query) {
  if (!query) return null;
  let q = query.trim();
  const mention = q.match(/^<@!?(\d+)>$/);
  if (mention) q = mention[1];

  if (/^\d{17,20}$/.test(q)) {
    try {
      return await guild.members.fetch(q);
    } catch {
      return null;
    }
  }

  const lowered = q.toLowerCase();
  await guild.members.fetch().catch(() => {});
  return (
    guild.members.cache.find(
      (m) =>
        m.user.username.toLowerCase() === lowered ||
        m.displayName.toLowerCase() === lowered ||
        m.user.tag?.toLowerCase() === lowered
    ) || null
  );
}

function parseArgs(content) {
  const body = content.slice(PREFIX.length).trim();
  if (!body) return { command: "", args: [] };
  const parts = body.split(/\s+/);
  return {
    command: parts.shift().toLowerCase(),
    args: parts,
    raw: body,
  };
}

function parseDuration(input, { maxMs = 28 * 86_400_000 } = {}) {
  if (!input) return null;
  const match = String(input).trim().match(/^(\d+)\s*(s|m|h|d)?$/i);
  if (!match) return null;
  const n = Number(match[1]);
  const unit = (match[2] || "m").toLowerCase();
  const mult = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
  const ms = n * mult;
  if (ms < 1000 || ms > maxMs) return null;
  return ms;
}

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function reasonFrom(args, startIndex = 0) {
  return args.slice(startIndex).join(" ").trim() || "No reason provided";
}

function getModLogChannelId() {
  return (
    process.env.MOD_LOG_CHANNEL_ID ||
    process.env.TICKET_LOG_CHANNEL_ID ||
    ""
  );
}

async function sendModLog(guild, { action, target, moderator, reason, extra }) {
  const entry = {
    action,
    targetId: target?.id || target || null,
    targetTag: target?.tag || target?.user?.tag || String(target || "—"),
    moderatorId: moderator.id,
    reason: reason || "No reason provided",
    extra: extra || null,
    at: Date.now(),
    guildId: guild.id,
  };

  const logs = loadJson(MODLOGS_PATH, []);
  logs.push(entry);
  if (logs.length > 200) logs.splice(0, logs.length - 200);
  saveJson(MODLOGS_PATH, logs);

  const channelId = getModLogChannelId();
  if (!channelId) return;

  try {
    const channel = await guild.channels.fetch(channelId);
    if (!channel?.isTextBased()) return;

    const colors = {
      ban: 0xe74c3c,
      softban: 0xe67e22,
      tempban: 0xc0392b,
      unban: 0x2ecc71,
      kick: 0xe67e22,
      mute: 0xf1c40f,
      unmute: 0x2ecc71,
      warn: 0xf39c12,
      nick: 0x3498db,
      lockdown: 0x95a5a6,
      unlock: 0x2ecc71,
    };

    const embed = new EmbedBuilder()
      .setColor(colors[action] || EMBED_COLOR)
      .setAuthor({ name: SERVER_NAME, iconURL: getLogo(guild) })
      .setTitle(`Mod Log — ${action.toUpperCase()}`)
      .addFields(
        {
          name: "Target",
          value: entry.targetId
            ? `<@${entry.targetId}> (\`${entry.targetId}\`)`
            : entry.targetTag,
          inline: true,
        },
        {
          name: "Moderator",
          value: `<@${moderator.id}>`,
          inline: true,
        },
        { name: "Reason", value: entry.reason, inline: false }
      )
      .setTimestamp(entry.at);

    if (extra) embed.addFields({ name: "Details", value: extra });

    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error("Failed to send mod log:", err.message);
  }
}

const tempbanTimers = new Map();

async function scheduleTempUnban(client, guildId, userId, endsAt) {
  const key = `${guildId}:${userId}`;
  if (tempbanTimers.has(key)) {
    clearTimeout(tempbanTimers.get(key));
    tempbanTimers.delete(key);
  }

  const delay = Math.max(endsAt - Date.now(), 0);
  const run = async () => {
    tempbanTimers.delete(key);
    const bans = loadJson(TEMPBANS_PATH, {});
    const entry = bans[userId];
    if (!entry || entry.guildId !== guildId) return;
    delete bans[userId];
    saveJson(TEMPBANS_PATH, bans);

    try {
      const guild = await client.guilds.fetch(guildId);
      await guild.members.unban(userId, "Tempban expired");
      await sendModLog(guild, {
        action: "unban",
        target: { id: userId, tag: entry.tag || userId },
        moderator: { id: client.user.id },
        reason: "Tempban expired automatically",
        extra: entry.reason ? `Original: ${entry.reason}` : null,
      });
    } catch (err) {
      console.error(`Tempban unban failed for ${userId}:`, err.message);
    }
  };

  if (delay === 0) {
    await run();
    return;
  }
  // Cap setTimeout to ~24 days chunks if needed — Discord bans can be long;
  // for simplicity re-check on resume; still schedule if within safe int range
  if (delay > 2_147_000_000) {
    const t = setTimeout(() => scheduleTempUnban(client, guildId, userId, endsAt), 2_000_000_000);
    tempbanTimers.set(key, t);
    return;
  }
  const t = setTimeout(run, delay);
  tempbanTimers.set(key, t);
}

function resumeTempBans(client) {
  const bans = loadJson(TEMPBANS_PATH, {});
  for (const [userId, entry] of Object.entries(bans)) {
    scheduleTempUnban(client, entry.guildId, userId, entry.endsAt);
  }
}

async function cmdHelp(message) {
  const logo = getLogo(message.guild);
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setAuthor({ name: SERVER_NAME, iconURL: logo })
    .setTitle(`${PREFIX}help — Staff Commands`)
    .setDescription(
      `Prefix: \`${PREFIX}\`\nOnly **moderators** and **admins** can use these.`
    )
    .addFields(
      {
        name: "Moderation",
        value: [
          `\`${PREFIX}ban @user [reason]\` — Ban a player`,
          `\`${PREFIX}softban @user [reason]\` — Ban+unban (wipe messages)`,
          `\`${PREFIX}tempban @user <time> [reason]\` — Timed ban`,
          `\`${PREFIX}unban <userId>\` — Unban a player`,
          `\`${PREFIX}kick @user [reason]\` — Kick a player`,
          `\`${PREFIX}mute @user [time] [reason]\` — Mute (timeout)`,
          `\`${PREFIX}unmute @user\` — Remove mute`,
          `\`${PREFIX}warn @user [reason]\` — Warn a player`,
          `\`${PREFIX}warnings @user\` — View warns`,
          `\`${PREFIX}nick @user <name>\` — Set nickname`,
        ].join("\n"),
      },
      {
        name: "Server control",
        value: [
          `\`${PREFIX}lockdown\` / \`${PREFIX}unlock\` — Citizen chat lock`,
          `\`${PREFIX}clear [amount]\` — Delete messages (1–100)`,
          `\`${PREFIX}slowmode <seconds>\` — Channel slowmode`,
          `\`${PREFIX}say <text>\` — Bot says a message`,
          `\`${PREFIX}announce [channel] <text>\` — Embed announcement`,
        ].join("\n"),
      },
      {
        name: "Tickets & info",
        value: [
          `\`${PREFIX}add @user\` — Add a player to this ticket`,
          `\`${PREFIX}remove @user\` — Remove from this ticket`,
          `\`${PREFIX}info @user\` — Player info`,
          `\`${PREFIX}serverinfo\` — Server info`,
          `\`${PREFIX}modlogs\` — Recent moderation actions`,
          `\`${PREFIX}help\` — This menu`,
        ].join("\n"),
      },
      {
        name: "Time examples",
        value: `\`10m\` \`2h\` \`7d\` — e.g. \`${PREFIX}mute @user 30m spam\` · \`${PREFIX}tempban @user 3d cheating\``,
      }
    )
    .setFooter({
      text: `${SERVER_NAME} • Prefix system`,
      iconURL: logo,
    });

  await message.reply({ embeds: [embed] });
}

async function cmdAdd(message, args) {
  if (!isTicketChannel(message.channel)) {
    await message.reply(`\`${PREFIX}add\` can only be used inside a ticket channel.`);
    return;
  }

  const member = await resolveMember(message.guild, args[0]);
  if (!member) {
    await message.reply(`Usage: \`${PREFIX}add @user\``);
    return;
  }

  try {
    await message.channel.permissionOverwrites.edit(member.id, {
      ViewChannel: true,
      SendMessages: true,
      AttachFiles: true,
      ReadMessageHistory: true,
    });
  } catch (err) {
    await message.reply(`Failed to add ${member}: ${err.message}`);
    return;
  }

  await message.channel.send(
    `${member} was added to this ticket by ${message.author}.`
  );
}

async function cmdRemove(message, args) {
  if (!isTicketChannel(message.channel)) {
    await message.reply(`\`${PREFIX}remove\` can only be used inside a ticket channel.`);
    return;
  }

  const member = await resolveMember(message.guild, args[0]);
  if (!member) {
    await message.reply(`Usage: \`${PREFIX}remove @user\``);
    return;
  }

  const { ownerId } = (() => {
    const parts = (message.channel.topic || "").split("|");
    const ownerPart = parts.find((p) => p.startsWith("ticket-owner:")) || "";
    return { ownerId: ownerPart.replace("ticket-owner:", "").trim() };
  })();

  if (ownerId && member.id === ownerId) {
    await message.reply("You cannot remove the ticket owner. Close the ticket instead.");
    return;
  }

  try {
    await message.channel.permissionOverwrites.delete(member.id);
  } catch (err) {
    await message.reply(`Failed to remove ${member}: ${err.message}`);
    return;
  }

  await message.channel.send(
    `${member} was removed from this ticket by ${message.author}.`
  );
}

async function cmdLockdown(message) {
  const citizenId = process.env.CITIZEN_ROLE_ID;
  if (!citizenId) {
    await message.reply("CITIZEN_ROLE_ID is not set in `.env`.");
    return;
  }

  const status = message.reply("Locking down channels for citizens…");
  let locked = 0;
  let failed = 0;

  const channels = message.guild.channels.cache.filter(
    (ch) =>
      ch.isTextBased?.() &&
      ch.type !== ChannelType.GuildCategory &&
      ch.viewable
  );

  for (const [, channel] of channels) {
    try {
      await channel.permissionOverwrites.edit(citizenId, {
        SendMessages: false,
        AddReactions: false,
        CreatePublicThreads: false,
        CreatePrivateThreads: false,
        SendMessagesInThreads: false,
        Connect: false,
        Speak: false,
      });
      locked++;
    } catch {
      failed++;
    }
  }

  saveJson(LOCKDOWN_PATH, {
    active: true,
    by: message.author.id,
    at: Date.now(),
    guildId: message.guild.id,
  });

  await sendModLog(message.guild, {
    action: "lockdown",
    target: null,
    moderator: message.author,
    reason: "Server lockdown enabled",
    extra: `Channels locked: ${locked}`,
  });

  const msg = await status;
  await msg.edit(
    `🔒 **Lockdown enabled.** Citizens locked in **${locked}** channel(s)${failed ? ` (${failed} failed)` : ""}.\nUse \`${PREFIX}unlock\` to lift it.`
  );
}

async function cmdUnlock(message) {
  const citizenId = process.env.CITIZEN_ROLE_ID;
  if (!citizenId) {
    await message.reply("CITIZEN_ROLE_ID is not set in `.env`.");
    return;
  }

  const status = message.reply("Unlocking channels for citizens…");
  let unlocked = 0;
  let failed = 0;

  const channels = message.guild.channels.cache.filter(
    (ch) =>
      ch.isTextBased?.() &&
      ch.type !== ChannelType.GuildCategory &&
      ch.viewable
  );

  for (const [, channel] of channels) {
    try {
      const overwrite = channel.permissionOverwrites.cache.get(citizenId);
      if (!overwrite) continue;
      await channel.permissionOverwrites.edit(citizenId, {
        SendMessages: null,
        AddReactions: null,
        CreatePublicThreads: null,
        CreatePrivateThreads: null,
        SendMessagesInThreads: null,
        Connect: null,
        Speak: null,
      });
      unlocked++;
    } catch {
      failed++;
    }
  }

  saveJson(LOCKDOWN_PATH, {
    active: false,
    by: message.author.id,
    at: Date.now(),
    guildId: message.guild.id,
  });

  await sendModLog(message.guild, {
    action: "unlock",
    target: null,
    moderator: message.author,
    reason: "Server lockdown lifted",
    extra: `Channels unlocked: ${unlocked}`,
  });

  const msg = await status;
  await msg.edit(
    `🔓 **Lockdown lifted** on **${unlocked}** channel(s)${failed ? ` (${failed} failed)` : ""}.`
  );
}

async function cmdBan(message, args) {
  const member = await resolveMember(message.guild, args[0]);
  if (!member) {
    await message.reply(`Usage: \`${PREFIX}ban @user [reason]\``);
    return;
  }
  if (!member.bannable) {
    await message.reply("I cannot ban that member (role hierarchy / permissions).");
    return;
  }
  const reason = reasonFrom(args, 1);
  await member.ban({ reason: `${message.author.tag}: ${reason}`, deleteMessageSeconds: 0 });
  await sendModLog(message.guild, {
    action: "ban",
    target: member.user,
    moderator: message.author,
    reason,
  });
  await message.reply(`Banned **${member.user.tag}** — ${reason}`);
}

async function cmdSoftban(message, args) {
  const member = await resolveMember(message.guild, args[0]);
  if (!member) {
    await message.reply(`Usage: \`${PREFIX}softban @user [reason]\``);
    return;
  }
  if (!member.bannable) {
    await message.reply("I cannot softban that member (role hierarchy / permissions).");
    return;
  }
  const reason = reasonFrom(args, 1);
  const user = member.user;
  await member.ban({
    reason: `${message.author.tag} softban: ${reason}`,
    deleteMessageSeconds: 86400,
  });
  await message.guild.members.unban(user.id, `Softban by ${message.author.tag}`);
  await sendModLog(message.guild, {
    action: "softban",
    target: user,
    moderator: message.author,
    reason,
    extra: "Banned then unbanned — recent messages wiped",
  });
  await message.reply(`Softbanned **${user.tag}** (messages wiped) — ${reason}`);
}

async function cmdTempban(message, args) {
  const member = await resolveMember(message.guild, args[0]);
  if (!member) {
    await message.reply(
      `Usage: \`${PREFIX}tempban @user <time> [reason]\`\nExample: \`${PREFIX}tempban @user 3d cheating\``
    );
    return;
  }
  if (!member.bannable) {
    await message.reply("I cannot tempban that member (role hierarchy / permissions).");
    return;
  }

  const durationMs = parseDuration(args[1], { maxMs: 365 * 86_400_000 });
  if (!durationMs) {
    await message.reply(
      `Invalid time. Example: \`${PREFIX}tempban @user 7d reason\``
    );
    return;
  }

  const reason = reasonFrom(args, 2);
  const user = member.user;
  const endsAt = Date.now() + durationMs;

  await member.ban({
    reason: `${message.author.tag} tempban ${formatDuration(durationMs)}: ${reason}`,
    deleteMessageSeconds: 0,
  });

  const bans = loadJson(TEMPBANS_PATH, {});
  bans[user.id] = {
    guildId: message.guild.id,
    tag: user.tag,
    reason,
    by: message.author.id,
    endsAt,
    at: Date.now(),
  };
  saveJson(TEMPBANS_PATH, bans);
  scheduleTempUnban(message.client, message.guild.id, user.id, endsAt);

  await sendModLog(message.guild, {
    action: "tempban",
    target: user,
    moderator: message.author,
    reason,
    extra: `Duration: ${formatDuration(durationMs)} · Unban <t:${Math.floor(endsAt / 1000)}:R>`,
  });

  await message.reply(
    `Tempbanned **${user.tag}** for **${formatDuration(durationMs)}** — ${reason}`
  );
}

async function cmdUnban(message, args) {
  const id = (args[0] || "").replace(/[<@!>]/g, "");
  if (!/^\d{17,20}$/.test(id)) {
    await message.reply(`Usage: \`${PREFIX}unban <userId>\``);
    return;
  }
  try {
    await message.guild.members.unban(id, `${message.author.tag}`);
    const bans = loadJson(TEMPBANS_PATH, {});
    if (bans[id]) {
      delete bans[id];
      saveJson(TEMPBANS_PATH, bans);
      const key = `${message.guild.id}:${id}`;
      if (tempbanTimers.has(key)) {
        clearTimeout(tempbanTimers.get(key));
        tempbanTimers.delete(key);
      }
    }
    await sendModLog(message.guild, {
      action: "unban",
      target: { id, tag: id },
      moderator: message.author,
      reason: "Manual unban",
    });
    await message.reply(`Unbanned <@${id}> (\`${id}\`).`);
  } catch {
    await message.reply("Could not unban that user — are they banned?");
  }
}

async function cmdKick(message, args) {
  const member = await resolveMember(message.guild, args[0]);
  if (!member) {
    await message.reply(`Usage: \`${PREFIX}kick @user [reason]\``);
    return;
  }
  if (!member.kickable) {
    await message.reply("I cannot kick that member (role hierarchy / permissions).");
    return;
  }
  const reason = reasonFrom(args, 1);
  await member.kick(`${message.author.tag}: ${reason}`);
  await sendModLog(message.guild, {
    action: "kick",
    target: member.user,
    moderator: message.author,
    reason,
  });
  await message.reply(`Kicked **${member.user.tag}** — ${reason}`);
}

async function cmdMute(message, args) {
  const member = await resolveMember(message.guild, args[0]);
  if (!member) {
    await message.reply(
      `Usage: \`${PREFIX}mute @user [time] [reason]\`\nExample: \`${PREFIX}mute @user 30m spam\``
    );
    return;
  }
  if (!member.moderatable) {
    await message.reply("I cannot mute that member (role hierarchy / permissions).");
    return;
  }

  let durationMs = parseDuration(args[1]);
  let reasonStart = 2;
  if (durationMs === null) {
    durationMs = 60 * 60 * 1000;
    reasonStart = 1;
  }
  const reason = reasonFrom(args, reasonStart);

  await member.timeout(durationMs, `${message.author.tag}: ${reason}`);
  await sendModLog(message.guild, {
    action: "mute",
    target: member.user,
    moderator: message.author,
    reason,
    extra: `Duration: ${formatDuration(durationMs)}`,
  });
  await message.reply(
    `Muted **${member.user.tag}** for **${formatDuration(durationMs)}** — ${reason}`
  );
}

async function cmdUnmute(message, args) {
  const member = await resolveMember(message.guild, args[0]);
  if (!member) {
    await message.reply(`Usage: \`${PREFIX}unmute @user\``);
    return;
  }
  if (!member.moderatable) {
    await message.reply("I cannot unmute that member.");
    return;
  }
  await member.timeout(null);
  await sendModLog(message.guild, {
    action: "unmute",
    target: member.user,
    moderator: message.author,
    reason: "Manual unmute",
  });
  await message.reply(`Unmuted **${member.user.tag}**.`);
}

async function cmdNick(message, args) {
  const member = await resolveMember(message.guild, args[0]);
  if (!member || args.length < 2) {
    await message.reply(`Usage: \`${PREFIX}nick @user <new nickname>\``);
    return;
  }
  if (!member.manageable) {
    await message.reply("I cannot change that member's nickname (role hierarchy).");
    return;
  }
  const nick = args.slice(1).join(" ").slice(0, 32);
  const old = member.displayName;
  await member.setNickname(nick, `${message.author.tag}`);
  await sendModLog(message.guild, {
    action: "nick",
    target: member.user,
    moderator: message.author,
    reason: `Nickname changed`,
    extra: `**${old}** → **${nick}**`,
  });
  await message.reply(`Nickname updated: **${old}** → **${nick}**`);
}

async function cmdSay(message, args, raw) {
  const text = raw.slice("say".length).trim();
  if (!text) {
    await message.reply(`Usage: \`${PREFIX}say <message>\``);
    return;
  }
  await message.delete().catch(() => {});
  await message.channel.send({ content: text, allowedMentions: { parse: [] } });
}

async function cmdAnnounce(message, args, raw) {
  let channel = message.channel;
  let text = raw.slice("announce".length).trim();

  if (args[0] && /^<#\d+>$|^\d{17,20}$/.test(args[0])) {
    const id = args[0].replace(/[<#>]/g, "");
    const fetched = await message.guild.channels.fetch(id).catch(() => null);
    if (!fetched?.isTextBased()) {
      await message.reply("Could not find that text channel.");
      return;
    }
    channel = fetched;
    text = args.slice(1).join(" ").trim();
  }

  if (!text) {
    await message.reply(
      `Usage: \`${PREFIX}announce <message>\` or \`${PREFIX}announce #channel <message>\``
    );
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setAuthor({ name: SERVER_NAME, iconURL: getLogo(message.guild) })
    .setTitle("Announcement")
    .setDescription(text)
    .setFooter({
      text: `Posted by ${message.author.tag}`,
      iconURL: message.author.displayAvatarURL({ size: 64 }),
    })
    .setTimestamp();

  await channel.send({ embeds: [embed] });
  if (channel.id !== message.channel.id) {
    await message.reply(`Announcement sent to ${channel}.`);
  } else {
    await message.delete().catch(() => {});
  }
}

async function cmdModlogs(message) {
  const logs = loadJson(MODLOGS_PATH, [])
    .filter((l) => l.guildId === message.guild.id)
    .slice(-15)
    .reverse();

  if (!logs.length) {
    await message.reply("No moderation logs yet.");
    return;
  }

  const lines = logs.map((l) => {
    const target = l.targetId ? `<@${l.targetId}>` : l.targetTag;
    return `**${l.action}** · ${target} · <@${l.moderatorId}> · <t:${Math.floor(l.at / 1000)}:R>\n└ ${l.reason}${l.extra ? ` · ${l.extra}` : ""}`;
  });

  await message.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setAuthor({ name: SERVER_NAME, iconURL: getLogo(message.guild) })
        .setTitle("Recent Mod Logs")
        .setDescription(lines.join("\n\n").slice(0, 4000))
        .setFooter({
          text: `Also posted live to the mod-log channel when set (MOD_LOG_CHANNEL_ID)`,
        }),
    ],
  });
}

async function cmdInfo(message, args) {
  const member =
    (await resolveMember(message.guild, args[0])) || message.member;
  if (!member) {
    await message.reply("Could not find that member.");
    return;
  }

  const user = member.user;
  const roles = member.roles.cache
    .filter((r) => r.id !== message.guild.id)
    .sort((a, b) => b.position - a.position)
    .map((r) => r.toString())
    .slice(0, 20);

  const warns = loadJson(WARNS_PATH, {});
  const userWarns = warns[user.id] || [];

  const apps = Object.values(loadJson(APPS_PATH, {}))
    .filter((a) => a.userId === user.id)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const latestApp =
    apps.find((a) => a.status === "approved") ||
    apps.find((a) => (a.vouchers || []).length > 0) ||
    apps[0] ||
    null;

  let vouchValue = "No vouch on record";
  let whitelistValue = "No application found";

  if (latestApp) {
    const vouchers = latestApp.vouchers || [];
    if (vouchers.length) {
      vouchValue = vouchers
        .map(
          (v) =>
            `<@${v.id}>${v.tag ? ` (${v.tag})` : ""}${
              v.at ? ` · <t:${Math.floor(v.at / 1000)}:R>` : ""
            }`
        )
        .join("\n");
    } else if (latestApp.needsInterview) {
      vouchValue = "No vouch (interview / No Vouch path)";
    }

    const icName = [latestApp.firstName, latestApp.lastName]
      .filter(Boolean)
      .join(" ");
    whitelistValue = [
      `**${icName || "Unknown"}** — ${latestApp.status}`,
      latestApp.reviewedBy ? `Reviewed by <@${latestApp.reviewedBy}>` : null,
    ]
      .filter(Boolean)
      .join("\n");
  }

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setAuthor({
      name: user.tag || user.username,
      iconURL: user.displayAvatarURL({ size: 256 }),
    })
    .setThumbnail(user.displayAvatarURL({ size: 512 }))
    .setTitle("Player Info")
    .addFields(
      { name: "User", value: `${user} (\`${user.id}\`)`, inline: false },
      { name: "Nickname", value: member.displayName, inline: true },
      {
        name: "Account created",
        value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`,
        inline: true,
      },
      {
        name: "Joined server",
        value: member.joinedTimestamp
          ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`
          : "Unknown",
        inline: true,
      },
      {
        name: "Roles",
        value: roles.length ? roles.join(" ") : "None",
      },
      {
        name: "Timeout",
        value: member.communicationDisabledUntilTimestamp
          ? `Until <t:${Math.floor(member.communicationDisabledUntilTimestamp / 1000)}:F>`
          : "Not muted",
        inline: true,
      },
      {
        name: "Warns",
        value: String(userWarns.length),
        inline: true,
      },
      {
        name: "Whitelist",
        value: whitelistValue.slice(0, 1024),
      },
      {
        name: "Vouched by",
        value: vouchValue.slice(0, 1024),
      }
    )
    .setFooter({ text: `${SERVER_NAME} • ${PREFIX}info` });

  await message.reply({ embeds: [embed] });
}

async function cmdWarn(message, args) {
  const member = await resolveMember(message.guild, args[0]);
  if (!member) {
    await message.reply(`Usage: \`${PREFIX}warn @user [reason]\``);
    return;
  }
  const reason = reasonFrom(args, 1);
  const warns = loadJson(WARNS_PATH, {});
  if (!warns[member.id]) warns[member.id] = [];
  warns[member.id].push({
    reason,
    by: message.author.id,
    at: Date.now(),
  });
  saveJson(WARNS_PATH, warns);
  await sendModLog(message.guild, {
    action: "warn",
    target: member.user,
    moderator: message.author,
    reason,
    extra: `Total warns: ${warns[member.id].length}`,
  });
  await message.reply(
    `Warned **${member.user.tag}** (${warns[member.id].length} total) — ${reason}`
  );
}

async function cmdWarnings(message, args) {
  const member = await resolveMember(message.guild, args[0]);
  if (!member) {
    await message.reply(`Usage: \`${PREFIX}warnings @user\``);
    return;
  }
  const warns = loadJson(WARNS_PATH, {});
  const list = warns[member.id] || [];
  if (!list.length) {
    await message.reply(`**${member.user.tag}** has no warnings.`);
    return;
  }
  const lines = list
    .slice(-10)
    .map(
      (w, i) =>
        `**${i + 1}.** ${w.reason} — <@${w.by}> · <t:${Math.floor(w.at / 1000)}:R>`
    )
    .join("\n");
  await message.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle(`Warnings — ${member.user.tag}`)
        .setDescription(lines)
        .setFooter({ text: `${list.length} total` }),
    ],
  });
}

async function cmdClear(message, args) {
  const amount = Math.min(Math.max(parseInt(args[0], 10) || 10, 1), 100);
  const deleted = await message.channel.bulkDelete(amount + 1, true).catch(() => null);
  if (!deleted) {
    await message.reply("Could not delete messages (older than 14 days cannot be bulk-deleted).");
    return;
  }
  const note = await message.channel.send(`Cleared **${Math.max(deleted.size - 1, 0)}** messages.`);
  setTimeout(() => note.delete().catch(() => {}), 4000);
}

async function cmdSlowmode(message, args) {
  const seconds = parseInt(args[0], 10);
  if (Number.isNaN(seconds) || seconds < 0 || seconds > 21600) {
    await message.reply(`Usage: \`${PREFIX}slowmode <seconds>\` (0–21600)`);
    return;
  }
  await message.channel.setRateLimitPerUser(seconds);
  await message.reply(
    seconds === 0
      ? "Slowmode disabled."
      : `Slowmode set to **${seconds}** second(s).`
  );
}

async function cmdServerInfo(message) {
  const g = message.guild;
  await g.members.fetch().catch(() => {});
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setAuthor({ name: g.name, iconURL: getLogo(g) })
    .setTitle("Server Info")
    .setThumbnail(g.iconURL({ size: 256 }))
    .addFields(
      { name: "Owner", value: `<@${g.ownerId}>`, inline: true },
      { name: "Members", value: String(g.memberCount), inline: true },
      { name: "Channels", value: String(g.channels.cache.size), inline: true },
      { name: "Roles", value: String(g.roles.cache.size), inline: true },
      {
        name: "Created",
        value: `<t:${Math.floor(g.createdTimestamp / 1000)}:R>`,
        inline: true,
      },
      {
        name: "Lockdown",
        value: loadJson(LOCKDOWN_PATH, {}).active ? "🔒 Active" : "🔓 Off",
        inline: true,
      }
    );
  await message.reply({ embeds: [embed] });
}

async function handleMessage(message) {
  if (!message.guild || message.author.bot) return false;
  if (!message.content.startsWith(PREFIX)) return false;

  if (!canUsePrefix(message.member)) {
    // Silent ignore so normal players aren't spammed; optional soft reply for known commands
    return true;
  }

  const { command, args, raw } = parseArgs(message.content);
  if (!command) return true;

  try {
    switch (command) {
      case "help":
        await cmdHelp(message);
        break;
      case "add":
        await cmdAdd(message, args);
        break;
      case "remove":
        await cmdRemove(message, args);
        break;
      case "lockdown":
        await cmdLockdown(message);
        break;
      case "unlock":
        await cmdUnlock(message);
        break;
      case "ban":
        await cmdBan(message, args);
        break;
      case "softban":
        await cmdSoftban(message, args);
        break;
      case "tempban":
        await cmdTempban(message, args);
        break;
      case "unban":
        await cmdUnban(message, args);
        break;
      case "kick":
        await cmdKick(message, args);
        break;
      case "mute":
        await cmdMute(message, args);
        break;
      case "unmute":
        await cmdUnmute(message, args);
        break;
      case "nick":
      case "nickname":
        await cmdNick(message, args);
        break;
      case "say":
        await cmdSay(message, args, raw);
        break;
      case "announce":
        await cmdAnnounce(message, args, raw);
        break;
      case "modlogs":
      case "modlog":
        await cmdModlogs(message);
        break;
      case "info":
        await cmdInfo(message, args);
        break;
      case "warn":
        await cmdWarn(message, args);
        break;
      case "warnings":
      case "warns":
        await cmdWarnings(message, args);
        break;
      case "clear":
      case "purge":
        await cmdClear(message, args);
        break;
      case "slowmode":
        await cmdSlowmode(message, args);
        break;
      case "serverinfo":
        await cmdServerInfo(message);
        break;
      default:
        await message.reply(
          `Unknown command. Use \`${PREFIX}help\` to see available commands.`
        );
        break;
    }
  } catch (err) {
    console.error(`Prefix command $${command} error:`, err);
    await message.reply(`Command failed: ${err.message}`).catch(() => {});
  }

  return true;
}

module.exports = {
  handleMessage,
  resumeTempBans,
  PREFIX,
};
