const fs = require("fs");
const path = require("path");
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  PermissionFlagsBits,
  MessageFlags,
  OverwriteType,
  AttachmentBuilder,
} = require("discord.js");
const { isStaff, getModeratorRoleIds, staffPingContent, getTicketPingRoleIds } = require("./roles");

const SERVER_NAME = "UNLABLED RP";
const EMBED_COLOR = 0xf1c40f;
const TRANSCRIPTS_DIR = path.join(__dirname, "transcripts");

const IDS = {
  SELECT: "ticket_select",
  CLOSE: "ticket_close",
  CONFIRM_CLOSE: "ticket_confirm_close",
  CANCEL_CLOSE: "ticket_cancel_close",
  ADD_PLAYER: "ticket_add_player",
  MODAL_ADD: "ticket_modal_add",
  MODAL_CREATE: "ticket_create",
  PLAYER: "ticket_player",
};

/** Discord modal field labels max 45 chars. */
const TICKET_FORMS = {
  player: {
    title: "Player Support Form",
    fields: [
      {
        id: "ingame",
        label: "INGAME NAME",
        style: TextInputStyle.Short,
        required: true,
        max: 64,
      },
      {
        id: "happen",
        label: "TELL WHAT HAPPEN?",
        style: TextInputStyle.Paragraph,
        required: true,
        max: 1000,
      },
      {
        id: "report",
        label: "USER OF YOU REPORT?",
        style: TextInputStyle.Short,
        required: false,
        max: 100,
      },
      {
        id: "datetime",
        label: "TIME AND DATE?",
        style: TextInputStyle.Short,
        required: true,
        max: 100,
      },
      {
        id: "clip",
        label: "CLIP OR POV",
        style: TextInputStyle.Short,
        required: false,
        max: 200,
      },
    ],
  },
  partnership: {
    title: "Partnership Form",
    fields: [
      {
        id: "ingame",
        label: "INGAME NAME",
        style: TextInputStyle.Short,
        required: true,
        max: 64,
      },
      {
        id: "shop_link",
        label: "SERVER LINK OF YOUR SHOP",
        style: TextInputStyle.Short,
        required: true,
        max: 200,
      },
      {
        id: "benefit",
        label: "CITIZEN/STAFF BENEFIT TO YOUR SHOP?",
        style: TextInputStyle.Paragraph,
        required: true,
        max: 1000,
      },
    ],
  },
  streamer: {
    title: "Streamer Form",
    fields: [
      {
        id: "ingame",
        label: "INGAME NAME",
        style: TextInputStyle.Short,
        required: true,
        max: 64,
      },
      {
        id: "platform",
        label: "WHAT PLATFORM YOUR USING",
        style: TextInputStyle.Short,
        required: true,
        max: 100,
      },
      {
        id: "platform_link",
        label: "PLATFORM LINK",
        style: TextInputStyle.Short,
        required: true,
        max: 200,
      },
      {
        id: "contribute",
        label: "WHAT CAN YOU CONTRIBUTE TO THE CITY",
        style: TextInputStyle.Paragraph,
        required: true,
        max: 1000,
      },
    ],
  },
  ban: {
    title: "Ban Appeal Form",
    fields: [
      {
        id: "ingame",
        label: "INGAME NAME",
        style: TextInputStyle.Short,
        required: true,
        max: 64,
      },
      {
        id: "datetime",
        label: "TIME AND DATE",
        style: TextInputStyle.Short,
        required: true,
        max: 100,
      },
      {
        id: "ban_id",
        label: "BAN ID",
        style: TextInputStyle.Short,
        required: true,
        max: 64,
      },
      {
        id: "clip",
        label: "CLIP OR POV",
        style: TextInputStyle.Short,
        required: false,
        max: 200,
      },
    ],
  },
  generic: {
    title: "Ticket Form",
    fields: [
      {
        id: "ingame",
        label: "INGAME NAME",
        style: TextInputStyle.Short,
        required: true,
        max: 64,
      },
      {
        id: "happen",
        label: "TELL WHAT HAPPEN?",
        style: TextInputStyle.Paragraph,
        required: true,
        max: 1000,
      },
    ],
  },
};

function getTicketFormKind(categoryName) {
  const n = String(categoryName || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
  if (/\bBAN\b/.test(n) || /\bAPPEAL\b/.test(n)) return "ban";
  if (/\bPARTNER/.test(n)) return "partnership";
  if (/\bSTREAM/.test(n)) return "streamer";
  if (/\bPLAYER\b/.test(n) || /\bSUPPORT\b/.test(n)) return "player";
  return "generic";
}

function buildTicketFormModal(categoryId, categoryName) {
  const kind = getTicketFormKind(categoryName);
  const form = TICKET_FORMS[kind] || TICKET_FORMS.generic;
  const modal = new ModalBuilder()
    .setCustomId(`${IDS.MODAL_CREATE}:${categoryId}`)
    .setTitle(form.title.slice(0, 45));

  for (const field of form.fields.slice(0, 5)) {
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(field.id)
          .setLabel(field.label.slice(0, 45))
          .setStyle(field.style)
          .setRequired(field.required)
          .setMaxLength(field.max)
      )
    );
  }
  return modal;
}

function collectTicketFormAnswers(interaction, categoryName) {
  const kind = getTicketFormKind(categoryName);
  const form = TICKET_FORMS[kind] || TICKET_FORMS.generic;
  const answers = [];
  for (const field of form.fields) {
    let value = "";
    try {
      value = interaction.fields.getTextInputValue(field.id).trim();
    } catch {
      value = "";
    }
    if (value) {
      answers.push({ name: field.label, value: value.slice(0, 1024) });
    } else if (field.required) {
      answers.push({ name: field.label, value: "—" });
    } else {
      answers.push({ name: field.label, value: "N/A" });
    }
  }
  return answers;
}

function getLogo(guild) {
  return (
    process.env.SERVER_LOGO_URL ||
    guild?.iconURL({ size: 256, extension: "png" }) ||
    undefined
  );
}

function getCategoryIds() {
  return (process.env.TICKET_CATEGORY_ID || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function getDefaultTranscriptChannelId() {
  const raw =
    process.env.TICKET_TRANSCRIPT_CHANNEL_ID ||
    process.env.TICKET_LOG_CHANNEL_ID ||
    "";
  return (
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)[0] || ""
  );
}

/** categoryId → transcript channelId (from TICKET_TRANSCRIPT_MAP) */
function getTranscriptMap() {
  const map = new Map();
  const raw = process.env.TICKET_TRANSCRIPT_MAP || "";
  for (const pair of raw.split(",")) {
    const [categoryId, channelId] = pair.split(":").map((s) => s.trim());
    if (categoryId && channelId) map.set(categoryId, channelId);
  }
  return map;
}

/** Route transcript by the ticket's current parent category (works after manual drag). */
function resolveTranscriptChannelId(parentId) {
  const map = getTranscriptMap();
  if (parentId && map.has(parentId)) return map.get(parentId);
  return getDefaultTranscriptChannelId();
}

function isTicketChannel(channel) {
  return (
    channel?.type === ChannelType.GuildText &&
    typeof channel.topic === "string" &&
    channel.topic.includes("ticket-owner:")
  );
}

function ticketActionRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(IDS.ADD_PLAYER)
      .setLabel("Add Player")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(IDS.CLOSE)
      .setLabel("Close Ticket")
      .setStyle(ButtonStyle.Danger)
  );
}

async function resolveMember(guild, query) {
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

  try {
    await guild.members.fetch();
  } catch {
    // cache may be incomplete
  }

  const lower = q.toLowerCase();
  return (
    guild.members.cache.find(
      (m) =>
        m.user.username.toLowerCase() === lower ||
        m.user.globalName?.toLowerCase() === lower ||
        m.displayName.toLowerCase() === lower
    ) || null
  );
}

function buildAddPlayerModal() {
  return new ModalBuilder()
    .setCustomId(IDS.MODAL_ADD)
    .setTitle("Add Player to Ticket")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(IDS.PLAYER)
          .setLabel("Discord ID / Username / Display Name")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("e.g. 123456789012345678 or smookeyrawrr")
          .setRequired(true)
          .setMaxLength(64)
      )
    );
}

async function addPlayerToTicket(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!isStaff(interaction.member)) {
    await interaction.editReply({
      content: "Only moderators or admins can use **Add Player**.",
    });
    return;
  }

  const channel = interaction.channel;
  if (!isTicketChannel(channel)) {
    await interaction.editReply({
      content: "This can only be used inside a ticket channel.",
    });
    return;
  }

  const playerQuery = interaction.fields.getTextInputValue(IDS.PLAYER).trim();
  const member = await resolveMember(interaction.guild, playerQuery);
  if (!member) {
    await interaction.editReply({
      content: `Could not find a member matching \`${playerQuery}\`. Try their Discord ID.`,
    });
    return;
  }

  try {
    await channel.permissionOverwrites.edit(member.id, {
      ViewChannel: true,
      SendMessages: true,
      AttachFiles: true,
      ReadMessageHistory: true,
    });
  } catch (err) {
    await interaction.editReply({
      content: `Failed to add ${member} to this ticket: ${err.message}`,
    });
    return;
  }

  await channel.send({
    content: `${member} was added to this ticket by ${interaction.user}.`,
  });

  await interaction.editReply({
    content: `Added ${member} to this ticket.`,
  });
}

function parseTicketTopic(topic) {
  const parts = (topic || "").split("|");
  const ownerPart = parts.find((p) => p.startsWith("ticket-owner:")) || "";
  const typePart = parts.find((p) => p.startsWith("type:")) || "";
  return {
    ownerId: ownerPart.replace("ticket-owner:", "").trim(),
    ticketType: typePart.replace("type:", "").trim() || "Ticket",
  };
}

function slugify(name) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "ticket"
  );
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function resolveCategories(guild) {
  const ids = getCategoryIds();
  const categories = [];
  for (const id of ids) {
    try {
      const ch = await guild.channels.fetch(id);
      if (ch && ch.type === ChannelType.GuildCategory) {
        categories.push({ id: ch.id, name: ch.name });
      }
    } catch {
      // skip invalid
    }
  }
  return categories;
}

function buildPanelEmbed(guild, categories) {
  const logo = getLogo(guild);

  return new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle("Create a ticket")
    .setDescription("Make sure to choose the right category before creating a ticket.")
    .setFooter({
      text: `${SERVER_NAME} | Ticket System`,
      iconURL: logo,
    });
}

function buildPanelComponents(categories) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(IDS.SELECT)
    .setPlaceholder("Select a ticket type...")
    .addOptions(
      categories.slice(0, 25).map((c) => ({
        label: c.name.slice(0, 100),
        value: c.id,
        description: `Open a ${c.name} ticket`.slice(0, 100),
      }))
    );

  return [new ActionRowBuilder().addComponents(menu)];
}

async function postPanel(channel) {
  const categories = await resolveCategories(channel.guild);
  if (categories.length === 0) {
    throw new Error("No valid ticket categories configured.");
  }

  const payload = {
    embeds: [buildPanelEmbed(channel.guild, categories)],
    components: buildPanelComponents(categories),
  };

  try {
    const messages = await channel.messages.fetch({ limit: 30 });
    const existing = messages.find(
      (m) =>
        m.author.id === channel.client.user.id &&
        m.components.length > 0 &&
        (m.embeds[0]?.title === "Create a ticket" ||
          m.embeds[0]?.title === "Support Tickets" ||
          m.components.some((r) =>
            r.components.some((c) => c.customId === IDS.SELECT)
          ))
    );
    if (existing) {
      await existing.edit(payload);
      return existing;
    }
  } catch (err) {
    console.error("Failed to edit existing ticket panel:", err.message);
  }

  return channel.send(payload);
}

async function syncTicketPanel(client) {
  const panelChannelId = process.env.TICKET_PANEL_CHANNEL_ID;
  if (!panelChannelId) return;

  try {
    const channel = await client.channels.fetch(panelChannelId);
    if (!channel?.isTextBased()) return;
    await postPanel(channel);
    console.log(`Ticket panel synced → #${channel.name}`);
  } catch (err) {
    console.error("Failed to sync ticket panel:", err.message);
  }
}

function findOpenTicket(guild, userId) {
  // Find in ANY category (including manually dragged / unregistered)
  return guild.channels.cache.find(
    (ch) =>
      isTicketChannel(ch) && ch.topic.includes(`ticket-owner:${userId}`)
  );
}

async function beginTicketSelect(interaction) {
  const categoryId = interaction.values[0];

  let category;
  try {
    category = await interaction.guild.channels.fetch(categoryId);
  } catch {
    category = null;
  }

  if (!category || category.type !== ChannelType.GuildCategory) {
    await interaction.reply({
      content: "That ticket category is no longer valid.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const existing = findOpenTicket(interaction.guild, interaction.user.id);
  if (existing) {
    await interaction.reply({
      content: `You already have an open ticket: ${existing}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.showModal(buildTicketFormModal(categoryId, category.name));
}

async function createTicketFromModal(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const categoryId = interaction.customId.split(":").slice(1).join(":");
  const modRoleIds = getModeratorRoleIds();

  let category;
  try {
    category = await interaction.guild.channels.fetch(categoryId);
  } catch {
    category = null;
  }

  if (!category || category.type !== ChannelType.GuildCategory) {
    await interaction.editReply({
      content: "That ticket category is no longer valid.",
    });
    return;
  }

  const existing = findOpenTicket(interaction.guild, interaction.user.id);
  if (existing) {
    await interaction.editReply({
      content: `You already have an open ticket: ${existing}`,
    });
    return;
  }

  const formAnswers = collectTicketFormAnswers(interaction, category.name);
  const logo = getLogo(interaction.guild);
  const safeUser =
    interaction.user.username
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 16) || "user";
  const typeSlug = slugify(category.name);

  const overwrites = [
    {
      id: interaction.guild.id,
      deny: [PermissionFlagsBits.ViewChannel],
      type: OverwriteType.Role,
    },
    {
      id: interaction.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ReadMessageHistory,
      ],
      type: OverwriteType.Member,
    },
    {
      id: interaction.client.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ReadMessageHistory,
      ],
      type: OverwriteType.Member,
    },
  ];

  if (modRoleIds.length) {
    for (const roleId of modRoleIds) {
      overwrites.push({
        id: roleId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageMessages,
        ],
        type: OverwriteType.Role,
      });
    }
  }

  const channel = await interaction.guild.channels.create({
    name: `${typeSlug}-${safeUser}`.slice(0, 100),
    type: ChannelType.GuildText,
    parent: categoryId,
    topic: `ticket-owner:${interaction.user.id}|type:${category.name}`,
    permissionOverwrites: overwrites,
  });

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setAuthor({ name: SERVER_NAME, iconURL: logo })
    .setTitle(`${category.name} Ticket`)
    .setDescription(
      [
        `Hello ${interaction.user},`,
        "",
        `**Type:** ${category.name}`,
        "",
        "Thank you for Contacting support. Please wait for Staffs to response.",
        "",
        "Staff can use **Add Player** to invite someone into this ticket by Discord ID or username.",
        "Click **Close Ticket** when your issue is resolved.",
      ].join("\n")
    )
    .addFields(
      { name: "Opened by", value: `${interaction.user}`, inline: true },
      {
        name: "Created",
        value: `<t:${Math.floor(Date.now() / 1000)}:R>`,
        inline: true,
      },
      ...formAnswers.map((f) => ({
        name: f.name,
        value: f.value,
        inline: false,
      }))
    )
    .setFooter({
      text: `${SERVER_NAME} • Ticket System`,
      iconURL: logo,
    })
    .setTimestamp();

  if (logo) embed.setThumbnail(logo);

  const pingRoleIds = getTicketPingRoleIds();
  const staffPing = staffPingContent();
  await channel.send({
    content: `${interaction.user} ${staffPing}`.trim(),
    embeds: [embed],
    components: [ticketActionRow()],
    allowedMentions: {
      users: [interaction.user.id],
      roles: pingRoleIds,
    },
  });

  await interaction.editReply({
    content: `Your **${category.name}** ticket has been created: ${channel}`,
  });
}

async function fetchAllMessages(channel) {
  const collected = [];
  let lastId;

  while (true) {
    const options = { limit: 100 };
    if (lastId) options.before = lastId;
    const batch = await channel.messages.fetch(options);
    if (batch.size === 0) break;
    collected.push(...batch.values());
    lastId = batch.last().id;
    if (batch.size < 100) break;
  }

  return collected.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

function buildTranscriptHtml(channel, messages, meta) {
  const rows = messages
    .map((msg) => {
      const time = new Date(msg.createdTimestamp).toISOString();
      const author = escapeHtml(
        msg.member?.displayName || msg.author.tag || msg.author.username
      );
      const bot = msg.author.bot ? " <span class=\"bot\">BOT</span>" : "";
      let content = escapeHtml(msg.content || "");
      if (!content && msg.embeds.length) {
        content = `<em>[embed] ${escapeHtml(msg.embeds[0].title || "embed")}</em>`;
      }
      if (msg.attachments.size) {
        const links = [...msg.attachments.values()]
          .map(
            (a) =>
              `<a href="${escapeHtml(a.url)}" target="_blank">${escapeHtml(a.name)}</a>`
          )
          .join(", ");
        content += (content ? "<br>" : "") + `<span class="files">Files: ${links}</span>`;
      }
      if (!content) content = "<em>[no content]</em>";

      return `<div class="msg"><div class="meta"><strong>${author}</strong>${bot} <span class="time">${time}</span></div><div class="body">${content}</div></div>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Transcript — ${escapeHtml(channel.name)}</title>
<style>
  body { font-family: Segoe UI, Arial, sans-serif; background:#1e1f22; color:#dbdee1; margin:0; padding:24px; }
  h1 { color:#f1c40f; margin:0 0 8px; }
  .info { color:#b5bac1; margin-bottom:24px; line-height:1.5; }
  .msg { background:#2b2d31; border-left:3px solid #f1c40f; border-radius:6px; padding:12px 14px; margin:10px 0; }
  .meta { font-size:13px; margin-bottom:6px; }
  .time { color:#949ba4; margin-left:8px; }
  .bot { background:#5865f2; color:#fff; font-size:10px; padding:1px 5px; border-radius:3px; margin-left:6px; }
  .body { white-space:pre-wrap; word-break:break-word; }
  .files a { color:#00a8fc; }
</style>
</head>
<body>
  <h1>${escapeHtml(SERVER_NAME)} Ticket Transcript</h1>
  <div class="info">
    <div><strong>Channel:</strong> #${escapeHtml(channel.name)}</div>
    <div><strong>Type:</strong> ${escapeHtml(meta.ticketType)}</div>
    <div><strong>Category:</strong> ${escapeHtml(meta.categoryName)}${meta.unregistered ? " (moved / unregistered)" : ""}</div>
    <div><strong>Owner:</strong> ${escapeHtml(meta.ownerTag)} (${escapeHtml(meta.ownerId)})</div>
    <div><strong>Closed by:</strong> ${escapeHtml(meta.closedBy)}</div>
    <div><strong>Closed at:</strong> ${escapeHtml(meta.closedAt)}</div>
    <div><strong>Messages:</strong> ${messages.length}</div>
  </div>
  ${rows || "<p>No messages.</p>"}
</body>
</html>`;
}

async function getCategoryInfo(channel) {
  const registered = new Set(getCategoryIds());
  const parentId = channel.parentId;
  let categoryName = "None";
  let unregistered = false;

  if (parentId) {
    unregistered = !registered.has(parentId);
    try {
      const parent = await channel.guild.channels.fetch(parentId);
      categoryName = parent?.name || parentId;
    } catch {
      categoryName = parentId;
      unregistered = true;
    }
  }

  return { categoryName, unregistered, parentId };
}

async function saveAndSendTranscript(interaction, channel) {
  const { ownerId, ticketType } = parseTicketTopic(channel.topic);
  const { categoryName, unregistered, parentId } = await getCategoryInfo(channel);
  const logo = getLogo(interaction.guild);

  let ownerTag = ownerId;
  try {
    const owner = await interaction.client.users.fetch(ownerId);
    ownerTag = owner.tag || owner.username;
  } catch {
    // keep id
  }

  const messages = await fetchAllMessages(channel);
  const meta = {
    ticketType,
    categoryName,
    unregistered,
    ownerId,
    ownerTag,
    closedBy: interaction.user.tag || interaction.user.username,
    closedAt: new Date().toISOString(),
  };

  const html = buildTranscriptHtml(channel, messages, meta);
  const fileName = `transcript-${channel.name}-${Date.now()}.html`;

  if (!fs.existsSync(TRANSCRIPTS_DIR)) {
    fs.mkdirSync(TRANSCRIPTS_DIR, { recursive: true });
  }
  const localPath = path.join(TRANSCRIPTS_DIR, fileName);
  fs.writeFileSync(localPath, html, "utf8");

  const attachment = new AttachmentBuilder(Buffer.from(html, "utf8"), {
    name: fileName,
  });

  const transcriptChannelId = resolveTranscriptChannelId(parentId);
  const mapped = parentId && getTranscriptMap().has(parentId);

  const logEmbed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setAuthor({ name: SERVER_NAME, iconURL: logo })
    .setTitle("Ticket Transcript")
    .setDescription(
      unregistered
        ? mapped
          ? "Ticket was closed from a **moved** category. Transcript routed to that category's log channel."
          : "Ticket was closed from an **unmapped** category. Transcript sent to the default log channel."
        : "Ticket closed — transcript attached."
    )
    .addFields(
      { name: "Type", value: ticketType, inline: true },
      {
        name: "Category",
        value: unregistered ? `${categoryName} *(moved)*` : categoryName,
        inline: true,
      },
      { name: "Channel", value: channel.name, inline: true },
      { name: "Owner", value: `<@${ownerId}>`, inline: true },
      { name: "Closed by", value: `${interaction.user}`, inline: true },
      { name: "Messages", value: String(messages.length), inline: true }
    )
    .setFooter({ text: `${SERVER_NAME} • Ticket System` })
    .setTimestamp();

  if (!transcriptChannelId) {
    console.warn(
      "No transcript channel mapped / configured — transcript saved locally only:",
      localPath
    );
    return { localPath, sent: false };
  }

  const logChannel = await interaction.client.channels.fetch(transcriptChannelId);
  if (!logChannel?.isTextBased()) {
    console.error("Transcript channel is not a text channel:", transcriptChannelId);
    return { localPath, sent: false };
  }

  await logChannel.send({
    embeds: [logEmbed],
    files: [attachment],
  });

  return { localPath, sent: true, transcriptChannelId };
}

async function handleClose(interaction) {
  const channel = interaction.channel;
  // Works in registered AND manually dragged (unregistered) categories
  if (!isTicketChannel(channel)) {
    await interaction.reply({
      content: "This is not a ticket channel.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const { ownerId } = parseTicketTopic(channel.topic);
  const isOwner = interaction.user.id === ownerId;

  if (!isOwner && !isStaff(interaction.member)) {
    await interaction.reply({
      content: "Only the ticket owner, moderators, or admins can close this ticket.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(IDS.CONFIRM_CLOSE)
      .setLabel("Confirm Close")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(IDS.CANCEL_CLOSE)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary)
  );

  await interaction.reply({
    content: "Are you sure you want to close this ticket? A transcript will be saved.",
    components: [row],
  });
}

async function confirmClose(interaction) {
  await interaction.deferUpdate();

  const channel = interaction.channel;
  if (!isTicketChannel(channel)) return;

  const logo = getLogo(interaction.guild);

  try {
    await saveAndSendTranscript(interaction, channel);
  } catch (err) {
    console.error("Failed to save transcript:", err);
    await channel.send({
      content: `⚠️ Failed to save transcript: ${err.message}`,
    });
  }

  const closedEmbed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle("Ticket Closed")
    .setDescription(
      `Closed by ${interaction.user}. Transcript saved. This channel will be deleted in **5 seconds**.`
    )
    .setFooter({
      text: `${SERVER_NAME} • Ticket System`,
      iconURL: logo,
    })
    .setTimestamp();

  await channel.send({ embeds: [closedEmbed] });

  setTimeout(async () => {
    try {
      await channel.delete(`Ticket closed by ${interaction.user.tag}`);
    } catch (err) {
      console.error("Failed to delete ticket channel:", err.message);
    }
  }, 5000);
}

async function handleInteraction(interaction) {
  if (interaction.isStringSelectMenu() && interaction.customId === IDS.SELECT) {
    await beginTicketSelect(interaction);
    return true;
  }

  if (interaction.isButton()) {
    if (interaction.customId === IDS.ADD_PLAYER) {
      if (!isStaff(interaction.member)) {
        await interaction.reply({
          content: "Only moderators or admins can use **Add Player**.",
          flags: MessageFlags.Ephemeral,
        });
        return true;
      }
      if (!isTicketChannel(interaction.channel)) {
        await interaction.reply({
          content: "This can only be used inside a ticket channel.",
          flags: MessageFlags.Ephemeral,
        });
        return true;
      }
      await interaction.showModal(buildAddPlayerModal());
      return true;
    }
    if (interaction.customId === IDS.CLOSE) {
      await handleClose(interaction);
      return true;
    }
    if (interaction.customId === IDS.CONFIRM_CLOSE) {
      await confirmClose(interaction);
      return true;
    }
    if (interaction.customId === IDS.CANCEL_CLOSE) {
      await interaction.update({
        content: "Ticket close cancelled.",
        components: [],
      });
      return true;
    }
  }

  if (interaction.isModalSubmit()) {
    if (interaction.customId === IDS.MODAL_ADD) {
      await addPlayerToTicket(interaction);
      return true;
    }
    if (interaction.customId.startsWith(`${IDS.MODAL_CREATE}:`)) {
      await createTicketFromModal(interaction);
      return true;
    }
  }

  if (
    interaction.isChatInputCommand() &&
    interaction.commandName === "setup-tickets"
  ) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!isStaff(interaction.member)) {
      await interaction.editReply({
        content: "Only moderators or admins can post the ticket panel.",
      });
      return true;
    }

    const panelChannelId = process.env.TICKET_PANEL_CHANNEL_ID;
    const channel = panelChannelId
      ? await interaction.client.channels.fetch(panelChannelId)
      : interaction.channel;

    try {
      await postPanel(channel);
      await interaction.editReply({
        content: `Ticket panel posted in <#${channel.id}>.`,
      });
    } catch (err) {
      await interaction.editReply({
        content: `Failed to post ticket panel: ${err.message}`,
      });
    }
    return true;
  }

  return false;
}

function getCommands() {
  return [
    {
      name: "setup-tickets",
      description: "Post the UNLABLED RP ticket panel",
      defaultMemberPermissions: PermissionFlagsBits.ManageGuild.toString(),
    },
  ];
}

async function ensureOpenTickets(client) {
  const row = ticketActionRow();

  let updated = 0;
  for (const [, guild] of client.guilds.cache) {
    // Include tickets in registered AND unregistered (manually dragged) categories
    const tickets = guild.channels.cache.filter((ch) => isTicketChannel(ch));

    for (const [, channel] of tickets) {
      try {
        const messages = await channel.messages.fetch({ limit: 10 });
        const ticketMsg = messages.find(
          (m) =>
            m.author.id === client.user.id &&
            m.components.length > 0 &&
            m.embeds[0]?.footer?.text?.includes("Ticket System")
        );
        if (!ticketMsg) continue;

        const hasCorrectAdd = ticketMsg.components.some((r) =>
          r.components.some((c) => c.customId === IDS.ADD_PLAYER)
        );
        if (hasCorrectAdd) continue;

        await ticketMsg.edit({ components: [row] });
        updated++;
      } catch (err) {
        console.error(`Failed to update ticket ${channel.name}:`, err.message);
      }
    }
  }

  if (updated > 0) {
    console.log(`Updated Add Player button on ${updated} open ticket(s)`);
  }
}

module.exports = {
  handleInteraction,
  getCommands,
  postPanel,
  ensureOpenTickets,
  syncTicketPanel,
};
