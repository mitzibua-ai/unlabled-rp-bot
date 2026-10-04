const { EmbedBuilder, Partials } = require("discord.js");

const SERVER_NAME = "UNLABLED RP";
const EMBED_COLOR = 0xf1c40f;

const CHANNELS = {
  whitelist: () => process.env.WHITELIST_LOG_CHANNEL_ID || "",
  rename: () => process.env.RENAME_LOG_CHANNEL_ID || "",
  roleRequest: () => process.env.ROLE_REQUEST_LOG_CHANNEL_ID || "",
  unrole: () => process.env.UNROLE_LOG_CHANNEL_ID || "",
  message: () => process.env.MESSAGE_LOG_CHANNEL_ID || "",
};

/** In-memory cache so deletes still show content when Discord doesn't send it */
const messageCache = new Map();
const CACHE_LIMIT = 5000;

function getLogo(guild) {
  return (
    process.env.SERVER_LOGO_URL ||
    guild?.iconURL({ size: 256, extension: "png" }) ||
    undefined
  );
}

function truncate(text, max = 1000) {
  const s = String(text ?? "");
  if (!s) return "*empty*";
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function cacheMessage(message) {
  if (!message?.id || message.author?.bot) return;
  messageCache.set(message.id, {
    id: message.id,
    channelId: message.channelId,
    guildId: message.guildId,
    authorId: message.author?.id,
    authorTag: message.author?.tag || message.author?.username,
    content: message.content || "",
    attachments: [...(message.attachments?.values?.() || message.attachments || [])]
      .map((a) => a.url || a.proxyURL)
      .filter(Boolean),
    createdAt: message.createdTimestamp || Date.now(),
  });
  if (messageCache.size > CACHE_LIMIT) {
    const first = messageCache.keys().next().value;
    messageCache.delete(first);
  }
}

function isLogChannel(channelId) {
  return Object.values(CHANNELS).some((get) => get() && get() === channelId);
}

async function post(client, channelId, embed) {
  if (!client || !channelId) return;
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased()) return;
    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error(`Logger failed (${channelId}):`, err.message);
  }
}

function baseEmbed(guild, title, color = EMBED_COLOR) {
  const logo = getLogo(guild);
  return new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: SERVER_NAME, iconURL: logo })
    .setTitle(title)
    .setTimestamp()
    .setFooter({ text: `${SERVER_NAME} • Logger`, iconURL: logo });
}

async function logWhitelist(client, guild, { action, app, actorId, extra }) {
  const color =
    action === "Approved" || action === "Staff Added" || action === "Moderator Added"
      ? 0x2ecc71
      : action === "Denied" ||
          action === "Auto-Denied" ||
          action === "Revoked"
        ? 0xe74c3c
        : action === "Vouched"
          ? 0x3498db
          : EMBED_COLOR;

  const vouchers =
    app.vouchers?.length > 0
      ? app.vouchers
          .map(
            (v) =>
              `<@${v.id}>${v.tag ? ` (${v.tag})` : ""}${
                v.at ? ` · <t:${Math.floor(v.at / 1000)}:R>` : ""
              }`
          )
          .join("\n")
      : app.needsInterview
        ? "None (interview / No Vouch)"
        : "None yet";

  const embed = baseEmbed(guild, `Whitelist — ${action}`, color).addFields(
    {
      name: "Applicant",
      value: `<@${app.userId}> (\`${app.userId}\`)${
        app.username ? `\n${app.username}` : ""
      }`,
      inline: true,
    },
    {
      name: "IC Name",
      value: `${app.firstName || ""} ${app.lastName || ""}`.trim() || "—",
      inline: true,
    },
    {
      name: "Type",
      value: app.needsInterview ? "No Vouch / Interview" : "Normal",
      inline: true,
    },
    {
      name: "Status",
      value: app.status || action,
      inline: true,
    },
    {
      name: actorId ? "Moderator / Admin" : "Actor",
      value: actorId ? `<@${actorId}>` : "—",
      inline: true,
    },
    {
      name: "Vouched by",
      value: truncate(vouchers, 1024),
      inline: false,
    }
  );

  if (app.accountCreated) {
    embed.addFields({
      name: "Account created",
      value: String(app.accountCreated),
      inline: false,
    });
  }
  if (app.reviewedBy && app.reviewedBy !== actorId) {
    embed.addFields({
      name: "Reviewed by",
      value: `<@${app.reviewedBy}>`,
      inline: true,
    });
  }
  if (extra) {
    embed.addFields({ name: "Details", value: truncate(extra) });
  }

  await post(client, CHANNELS.whitelist(), embed);
}

async function logRename(client, guild, { action, req, actorId }) {
  const embed = baseEmbed(
    guild,
    `Rename — ${action}`,
    action === "Approved" ? 0x2ecc71 : action === "Denied" ? 0xe74c3c : EMBED_COLOR
  ).addFields(
    {
      name: "User",
      value: `<@${req.userId}> (\`${req.userId}\`)`,
      inline: true,
    },
    { name: "Old Name", value: req.oldName || "—", inline: true },
    { name: "New Name", value: req.newName || "—", inline: true }
  );
  if (actorId) {
    embed.addFields({ name: "By", value: `<@${actorId}>`, inline: true });
  }
  await post(client, CHANNELS.rename(), embed);
}

async function logRoleRequest(client, guild, { action, req, actorId }) {
  const higher = [
    ...(req.higherUpIds || []).map((id) => `<@${id}>`),
    ...(req.higherUpRoleIds || []).map((id) => `<@&${id}>`),
  ].join(", ");

  const embed = baseEmbed(
    guild,
    `Role Request — ${action}`,
    action === "Approved" ? 0x2ecc71 : action === "Denied" ? 0xe74c3c : EMBED_COLOR
  ).addFields(
    {
      name: "User",
      value: `<@${req.userId}> (\`${req.userId}\`)`,
      inline: true,
    },
    { name: "IC Name", value: req.name || "—", inline: true },
    {
      name: "Role",
      value: req.roleId ? `<@&${req.roleId}>` : req.roleName || "—",
      inline: true,
    },
    { name: "Higher-up", value: higher || "—", inline: false }
  );
  if (actorId) {
    embed.addFields({ name: "By", value: `<@${actorId}>`, inline: true });
  }
  await post(client, CHANNELS.roleRequest(), embed);
}

async function logUnrole(client, guild, { action, req, actorId }) {
  const higher = [
    ...(req.higherUpIds || []).map((id) => `<@${id}>`),
    ...(req.higherUpRoleIds || []).map((id) => `<@&${id}>`),
  ].join(", ");

  const embed = baseEmbed(
    guild,
    `Unrole — ${action}`,
    action === "Approved" ? 0x2ecc71 : action === "Denied" ? 0xe74c3c : EMBED_COLOR
  ).addFields(
    {
      name: "User",
      value: `<@${req.userId}> (\`${req.userId}\`)`,
      inline: true,
    },
    { name: "IC Name", value: req.name || "—", inline: true },
    {
      name: "Role Removed",
      value: req.roleId ? `<@&${req.roleId}>` : req.roleName || "—",
      inline: true,
    },
    { name: "Higher-up", value: higher || "—", inline: false }
  );
  if (actorId) {
    embed.addFields({ name: "By", value: `<@${actorId}>`, inline: true });
  }
  await post(client, CHANNELS.unrole(), embed);
}

async function logMessageEdit(client, oldMessage, newMessage) {
  if (!newMessage.guild || newMessage.author?.bot) return;
  if (isLogChannel(newMessage.channelId)) return;
  if (oldMessage.content === newMessage.content) return;

  const before =
    oldMessage.content ??
    messageCache.get(newMessage.id)?.content ??
    "*unknown (not cached)*";
  const after = newMessage.content || "*empty*";

  cacheMessage(newMessage);

  const embed = baseEmbed(newMessage.guild, "Message Edited", 0xf39c12)
    .addFields(
      {
        name: "Author",
        value: `${newMessage.author} (\`${newMessage.author.id}\`)`,
        inline: true,
      },
      {
        name: "Channel",
        value: `${newMessage.channel} · [Jump](${newMessage.url})`,
        inline: true,
      },
      { name: "Before", value: truncate(before) },
      { name: "After", value: truncate(after) }
    );

  await post(client, CHANNELS.message(), embed);
}

async function logMessageDelete(client, message) {
  const cached = messageCache.get(message.id);
  if (message.author?.bot) return;

  const authorId = message.author?.id || cached?.authorId;
  const authorTag = message.author?.tag || cached?.authorTag;
  const content = message.content || cached?.content || "";
  const channelId = message.channelId || cached?.channelId;
  const guild = message.guild;
  const attachments = [
    ...[
      ...(message.attachments?.values?.()
        ? message.attachments.values()
        : message.attachments || []),
    ]
      .map((a) => a.url)
      .filter(Boolean),
    ...(cached?.attachments || []),
  ].filter((v, i, arr) => arr.indexOf(v) === i);

  if (isLogChannel(channelId)) return;
  if (!authorId && !content && !attachments.length) return;

  messageCache.delete(message.id);

  const embed = baseEmbed(guild, "Message Deleted", 0xe74c3c).addFields(
    {
      name: "Author",
      value: authorId
        ? `<@${authorId}>${authorTag ? ` (${authorTag})` : ""} (\`${authorId}\`)`
        : "Unknown",
      inline: true,
    },
    {
      name: "Channel",
      value: channelId ? `<#${channelId}>` : "Unknown",
      inline: true,
    },
    {
      name: "Content",
      value: truncate(content || "*no text content*"),
    }
  );

  if (attachments.length) {
    embed.addFields({
      name: "Attachments",
      value: truncate(attachments.join("\n"), 1000),
    });
  }

  await post(client, CHANNELS.message(), embed);
}

function registerMessageLogger(client) {
  client.on("messageCreate", (message) => {
    if (!message.guild || message.author?.bot) return;
    if (isLogChannel(message.channelId)) return;
    cacheMessage(message);
  });

  client.on("messageUpdate", async (oldMessage, newMessage) => {
    try {
      if (newMessage.partial) {
        try {
          await newMessage.fetch();
        } catch {
          return;
        }
      }
      await logMessageEdit(client, oldMessage, newMessage);
    } catch (err) {
      console.error("Message edit log error:", err.message);
    }
  });

  client.on("messageDelete", async (message) => {
    try {
      await logMessageDelete(client, message);
    } catch (err) {
      console.error("Message delete log error:", err.message);
    }
  });

  client.on("messageDeleteBulk", async (messages) => {
    try {
      for (const [, message] of messages) {
        await logMessageDelete(client, message);
      }
    } catch (err) {
      console.error("Message bulk delete log error:", err.message);
    }
  });
}

function requiredPartials() {
  return [Partials.Message, Partials.Channel, Partials.GuildMember];
}

function status() {
  return {
    whitelist: !!CHANNELS.whitelist(),
    rename: !!CHANNELS.rename(),
    roleRequest: !!CHANNELS.roleRequest(),
    unrole: !!CHANNELS.unrole(),
    message: !!CHANNELS.message(),
  };
}

module.exports = {
  logWhitelist,
  logRename,
  logRoleRequest,
  logUnrole,
  registerMessageLogger,
  requiredPartials,
  status,
  cacheMessage,
};
