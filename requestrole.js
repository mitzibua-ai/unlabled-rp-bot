const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  MessageFlags,
  ApplicationCommandOptionType,
  Role,
} = require("discord.js");
const logger = require("./logger");
const { isStaff, isFactionLeader } = require("./roles");

const SERVER_NAME = "UNLABLED RP";
const EMBED_COLOR = 0xf1c40f;
const ROLE_REQUEST_CHANNEL_ID = process.env.ROLE_REQUEST_CHANNEL_ID || "";

const DATA_PATH = path.join(__dirname, "data", "role-requests.json");

const IDS = {
  APPROVE: "rr_approve",
  DENY: "rr_deny",
};

function loadRequests() {
  try {
    return JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveRequests(data) {
  const dir = path.dirname(DATA_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
}

function getLogo(guild) {
  return (
    process.env.SERVER_LOGO_URL ||
    guild?.iconURL({ size: 256, extension: "png" }) ||
    undefined
  );
}

function getApproverRoleIds() {
  return (process.env.ROLE_REQUEST_APPROVER_ROLE_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

function canReview(member, req) {
  if (isStaff(member)) return true;
  if (isFactionLeader(member)) return true;
  if (req.higherUpIds?.includes(member.id)) return true;
  if (req.higherUpRoleIds?.some((id) => member.roles.cache.has(id))) return true;
  const approverRoles = getApproverRoleIds();
  if (approverRoles.some((id) => member.roles.cache.has(id))) return true;
  return false;
}

function formatHigherUps(req) {
  const parts = [
    ...(req.higherUpIds || []).map((id) => `<@${id}>`),
    ...(req.higherUpRoleIds || []).map((id) => `<@&${id}>`),
  ];
  return parts.join(", ") || "—";
}

function buildMentionContent(req) {
  const parts = [
    ...(req.higherUpIds || []).map((id) => `<@${id}>`),
    ...(req.higherUpRoleIds || []).map((id) => `<@&${id}>`),
  ];
  return parts.join(" ");
}

function buildRequestEmbed(guild, req) {
  const logo = getLogo(guild);
  const statusColors = {
    pending: EMBED_COLOR,
    approved: 0x2ecc71,
    denied: 0xe74c3c,
  };

  const embed = new EmbedBuilder()
    .setColor(statusColors[req.status] || EMBED_COLOR)
    .setAuthor({ name: SERVER_NAME, iconURL: logo })
    .setTitle("Role Request")
    .setDescription(`Submitted by <@${req.userId}>`)
    .addFields(
      { name: "IC Name", value: req.name, inline: true },
      { name: "Requested Role", value: `<@&${req.roleId}>`, inline: true },
      {
        name: "Higher-up notified",
        value: formatHigherUps(req),
        inline: false,
      },
      {
        name: "Status",
        value:
          req.status === "pending"
            ? "⏳ Pending review"
            : req.status === "approved"
              ? `✅ Approved by <@${req.reviewedBy}>`
              : `❌ Denied by <@${req.reviewedBy}>`,
        inline: false,
      }
    )
    .setFooter({
      text: `${SERVER_NAME} • Role Request`,
      iconURL: logo,
    })
    .setTimestamp(req.createdAt);

  if (logo) embed.setThumbnail(logo);
  return embed;
}

function buildActionButtons(requestId, disabled = false) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${IDS.APPROVE}:${requestId}`)
        .setLabel("Approve")
        .setStyle(ButtonStyle.Success)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(`${IDS.DENY}:${requestId}`)
        .setLabel("Deny")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(disabled)
    ),
  ];
}

async function refreshRequestMessage(client, req) {
  if (!req.channelId || !req.messageId) return;
  try {
    const channel = await client.channels.fetch(req.channelId);
    const message = await channel.messages.fetch(req.messageId);
    const mentions = buildMentionContent(req);
    await message.edit({
      content:
        req.status === "pending"
          ? `${mentions} — new role request needs your review.`
          : mentions || null,
      embeds: [buildRequestEmbed(channel.guild, req)],
      components: buildActionButtons(req.id, req.status !== "pending"),
    });
  } catch (err) {
    console.error("Failed to refresh role request message:", err.message);
  }
}

function collectMentionables(...values) {
  const higherUpIds = [];
  const higherUpRoleIds = [];

  for (const value of values) {
    if (!value) continue;
    if (value instanceof Role || value.members) {
      higherUpRoleIds.push(value.id);
    } else {
      higherUpIds.push(value.id);
    }
  }

  return {
    higherUpIds: [...new Set(higherUpIds)],
    higherUpRoleIds: [...new Set(higherUpRoleIds)],
  };
}

async function handleRequestRoleCommand(interaction) {
  if (
    ROLE_REQUEST_CHANNEL_ID &&
    interaction.channelId !== ROLE_REQUEST_CHANNEL_ID
  ) {
    await interaction.reply({
      content: `This command can only be used in <#${ROLE_REQUEST_CHANNEL_ID}>.`,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const name = interaction.options.getString("name", true).trim();
  const role = interaction.options.getRole("role", true);
  const higherUp = interaction.options.getMentionable("higher_up", true);
  const higherUp2 = interaction.options.getMentionable("higher_up_2");

  if (!name) {
    await interaction.reply({
      content: "Please provide your name.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (role.managed) {
    await interaction.reply({
      content: "That role is managed by an integration and cannot be assigned.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const { higherUpIds, higherUpRoleIds } = collectMentionables(
    higherUp,
    higherUp2
  );

  if (higherUpIds.includes(interaction.user.id)) {
    await interaction.reply({
      content: "You cannot list yourself as the higher-up.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (higherUpIds.length === 0 && higherUpRoleIds.length === 0) {
    await interaction.reply({
      content: "Please mention a higher-up user or leadership role.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  for (const userId of higherUpIds) {
    try {
      const user = await interaction.client.users.fetch(userId);
      if (user.bot) {
        await interaction.reply({
          content: "Please mention a real higher-up, not a bot.",
          flags: MessageFlags.Ephemeral,
        });
        return true;
      }
    } catch {
      // ignore fetch errors
    }
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const requests = loadRequests();
  const id = crypto.randomBytes(6).toString("hex");
  const req = {
    id,
    userId: interaction.user.id,
    userTag: interaction.user.username,
    name,
    roleId: role.id,
    roleName: role.name,
    higherUpIds,
    higherUpRoleIds,
    status: "pending",
    createdAt: Date.now(),
    channelId: null,
    messageId: null,
    reviewedBy: null,
  };

  const mentions = buildMentionContent(req);
  const message = await interaction.channel.send({
    content: `${mentions} — new role request needs your review.`,
    embeds: [buildRequestEmbed(interaction.guild, req)],
    components: buildActionButtons(id),
    allowedMentions: {
      users: higherUpIds,
      roles: higherUpRoleIds,
    },
  });

  req.channelId = message.channel.id;
  req.messageId = message.id;
  requests[id] = req;
  saveRequests(requests);

  await logger.logRoleRequest(interaction.client, interaction.guild, {
    action: "Submitted",
    req,
    actorId: interaction.user.id,
  });

  await interaction.editReply({
    content:
      "Your role request was submitted. The higher-up(s) were mentioned for Approve / Deny.",
  });
  return true;
}

async function handleButton(interaction) {
  const [action, requestId] = interaction.customId.split(":");
  if (![IDS.APPROVE, IDS.DENY].includes(action)) return false;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const requests = loadRequests();
  const req = requests[requestId];
  if (!req) {
    await interaction.editReply({ content: "Role request not found." });
    return true;
  }

  if (!canReview(interaction.member, req)) {
    await interaction.editReply({
      content:
        "Only the mentioned lead, **GANGNAME PATRON** / **EMS DIRECTOR** / **POLICE DIRECTOR**, or moderators/admins can approve or deny this.",
    });
    return true;
  }

  if (req.status !== "pending") {
    await interaction.editReply({
      content: "This role request is already closed.",
    });
    return true;
  }

  req.status = action === IDS.APPROVE ? "approved" : "denied";
  req.reviewedBy = interaction.user.id;
  saveRequests(requests);

  let roleNote = "";
  if (req.status === "approved") {
    try {
      const member = await interaction.guild.members.fetch(req.userId);
      await member.roles.add(req.roleId);
    } catch (err) {
      console.error("Failed to add role on request approve:", err.message);
      roleNote =
        " (Could not assign the Discord role — check bot permissions / role hierarchy.)";
    }
  }

  await refreshRequestMessage(interaction.client, req);

  await logger.logRoleRequest(interaction.client, interaction.guild, {
    action: req.status === "approved" ? "Approved" : "Denied",
    req,
    actorId: interaction.user.id,
  });

  await interaction.editReply({
    content:
      req.status === "approved"
        ? `Approved **${req.name}** for **${req.roleName}**.${roleNote}`
        : `Denied **${req.name}** for **${req.roleName}**.`,
  });
  return true;
}

async function handleInteraction(interaction) {
  if (
    interaction.isChatInputCommand() &&
    interaction.commandName === "requestrole"
  ) {
    return handleRequestRoleCommand(interaction);
  }

  if (interaction.isButton()) {
    if (
      interaction.customId.startsWith(`${IDS.APPROVE}:`) ||
      interaction.customId.startsWith(`${IDS.DENY}:`)
    ) {
      return handleButton(interaction);
    }
  }

  return false;
}

function getCommands() {
  return [
    {
      name: "requestrole",
      description:
        "Request a role — mention GANGNAME PATRON, EMS DIRECTOR, or POLICE DIRECTOR",
      default_member_permissions: null,
      dm_permission: false,
      options: [
        {
          name: "name",
          description: "Your in-character name",
          type: ApplicationCommandOptionType.String,
          required: true,
          max_length: 64,
        },
        {
          name: "role",
          description: "The Discord role you are requesting",
          type: ApplicationCommandOptionType.Role,
          required: true,
        },
        {
          name: "higher_up",
          description:
            "Lead to notify — e.g. BALLAS PATRON, EMS DIRECTOR, POLICE DIRECTOR",
          type: ApplicationCommandOptionType.Mentionable,
          required: true,
        },
        {
          name: "higher_up_2",
          description: "Optional second lead (person or leadership role)",
          type: ApplicationCommandOptionType.Mentionable,
          required: false,
        },
      ],
    },
  ];
}

module.exports = {
  handleInteraction,
  getCommands,
};
