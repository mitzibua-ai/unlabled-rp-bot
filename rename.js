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
} = require("discord.js");
const logger = require("./logger");
const { isStaff } = require("./roles");

const SERVER_NAME = "UNLABLED RP";
const EMBED_COLOR = 0xf1c40f;
const RENAME_CHANNEL_ID =
  process.env.RENAME_CHANNEL_ID || "1553608159279579196";

const DATA_PATH = path.join(__dirname, "data", "renames.json");

const IDS = {
  APPROVE: "rn_approve",
  DENY: "rn_deny",
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
    .setTitle("Name Change Request")
    .setDescription(`Submitted by <@${req.userId}>`)
    .addFields(
      { name: "Old Name", value: req.oldName, inline: true },
      { name: "New Name", value: req.newName, inline: true },
      {
        name: "Status",
        value:
          req.status === "pending"
            ? "⏳ Pending moderator review"
            : req.status === "approved"
              ? `✅ Approved by <@${req.reviewedBy}>`
              : `❌ Denied by <@${req.reviewedBy}>`,
        inline: false,
      }
    )
    .setFooter({
      text: `${SERVER_NAME} • Rename System`,
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

async function applyNickname(guild, req) {
  try {
    const member = await guild.members.fetch(req.userId);
    await member.setNickname(req.newName.slice(0, 32));
    return true;
  } catch (err) {
    console.error("Failed to set nickname after rename approve:", err.message);
    return false;
  }
}

async function refreshRequestMessage(client, req) {
  if (!req.channelId || !req.messageId) return;
  try {
    const channel = await client.channels.fetch(req.channelId);
    const message = await channel.messages.fetch(req.messageId);
    await message.edit({
      embeds: [buildRequestEmbed(channel.guild, req)],
      components: buildActionButtons(req.id, req.status !== "pending"),
    });
  } catch (err) {
    console.error("Failed to refresh rename message:", err.message);
  }
}

async function handleRenameCommand(interaction) {
  if (interaction.channelId !== RENAME_CHANNEL_ID) {
    await interaction.reply({
      content: `This command can only be used in <#${RENAME_CHANNEL_ID}>.`,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const oldName = interaction.options.getString("old_name", true).trim();
  const newName = interaction.options.getString("new_name", true).trim();

  if (!oldName || !newName) {
    await interaction.reply({
      content: "Both old name and new name are required.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (oldName.toLowerCase() === newName.toLowerCase()) {
    await interaction.reply({
      content: "Old name and new name cannot be the same.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const requests = loadRequests();
  const id = crypto.randomBytes(6).toString("hex");
  const req = {
    id,
    userId: interaction.user.id,
    userTag: interaction.user.username,
    oldName,
    newName,
    status: "pending",
    createdAt: Date.now(),
    channelId: null,
    messageId: null,
    reviewedBy: null,
  };

  const message = await interaction.channel.send({
    embeds: [buildRequestEmbed(interaction.guild, req)],
    components: buildActionButtons(id),
  });

  req.channelId = message.channel.id;
  req.messageId = message.id;
  requests[id] = req;
  saveRequests(requests);

  await logger.logRename(interaction.client, interaction.guild, {
    action: "Submitted",
    req,
    actorId: interaction.user.id,
  });

  await interaction.editReply({
    content:
      "Your name change request was submitted. Moderators will Approve or Deny it.",
  });
  return true;
}

async function handleButton(interaction) {
  const [action, requestId] = interaction.customId.split(":");
  if (![IDS.APPROVE, IDS.DENY].includes(action)) return false;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!isStaff(interaction.member)) {
    await interaction.editReply({
      content: "Only moderators or admins can approve or deny name changes.",
    });
    return true;
  }

  const requests = loadRequests();
  const req = requests[requestId];
  if (!req) {
    await interaction.editReply({ content: "Rename request not found." });
    return true;
  }
  if (req.status !== "pending") {
    await interaction.editReply({
      content: "This rename request is already closed.",
    });
    return true;
  }

  req.status = action === IDS.APPROVE ? "approved" : "denied";
  req.reviewedBy = interaction.user.id;
  saveRequests(requests);

  let nickNote = "";
  if (req.status === "approved") {
    const nickOk = await applyNickname(interaction.guild, req);
    if (!nickOk) {
      nickNote =
        " (Could not update Discord nickname — check bot role hierarchy.)";
    }
  }

  await refreshRequestMessage(interaction.client, req);

  await logger.logRename(interaction.client, interaction.guild, {
    action: req.status === "approved" ? "Approved" : "Denied",
    req,
    actorId: interaction.user.id,
  });

  await interaction.editReply({
    content:
      req.status === "approved"
        ? `Approved name change **${req.oldName}** → **${req.newName}**.${nickNote}`
        : `Denied name change **${req.oldName}** → **${req.newName}**.`,
  });
  return true;
}

async function handleInteraction(interaction) {
  if (interaction.isChatInputCommand() && interaction.commandName === "rename") {
    return handleRenameCommand(interaction);
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
      name: "rename",
      description: "Request a character name change (old name → new name)",
      options: [
        {
          name: "old_name",
          description: "Your current / old name",
          type: ApplicationCommandOptionType.String,
          required: true,
          max_length: 32,
        },
        {
          name: "new_name",
          description: "The new name you want",
          type: ApplicationCommandOptionType.String,
          required: true,
          max_length: 32,
        },
      ],
    },
  ];
}

module.exports = {
  handleInteraction,
  getCommands,
};
