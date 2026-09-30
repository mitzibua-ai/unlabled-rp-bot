const fs = require("fs");
const path = require("path");
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
} = require("discord.js");
const { isStaff } = require("./roles");

const SERVER_NAME = "UNLABLED RP";
const EMBED_COLOR = 0xe74c3c;
const CHANNEL_ID =
  process.env.TOKEN_DETECTOR_CHANNEL_ID || "1554208720873848913";
const WARNING_TEXT = "WAG MONA SUBUKAN MAG CHAT DITO MA K KICK KA";
const PANEL_MARKER = "token-detector-panel";

const DATA_PATH = path.join(__dirname, "data", "token-detector.json");

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  } catch {
    return { kicks: 0, messageId: null, channelId: CHANNEL_ID };
  }
}

function saveData(data) {
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

function buildPanel(guild, kicks) {
  const logo = getLogo(guild);
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setAuthor({ name: SERVER_NAME, iconURL: logo })
    .setTitle("⚠️ Restricted Channel")
    .setDescription(`**${WARNING_TEXT}**`)
    .setFooter({
      text: `${SERVER_NAME} • Token Detector`,
      iconURL: logo,
    });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(PANEL_MARKER)
      .setLabel(`Kicked: ${kicks}`)
      .setStyle(ButtonStyle.Danger)
      .setDisabled(true)
  );

  return { embeds: [embed], components: [row] };
}

async function refreshPanel(client, data) {
  if (!data.messageId) return;
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    if (!channel?.isTextBased()) return;
    const message = await channel.messages.fetch(data.messageId);
    await message.edit(buildPanel(channel.guild, data.kicks));
  } catch (err) {
    console.error("Failed to refresh token detector panel:", err.message);
  }
}

async function ensurePanel(client) {
  if (!CHANNEL_ID) return;

  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    if (!channel?.isTextBased()) return;

    const data = loadData();
    const payload = buildPanel(channel.guild, data.kicks || 0);

    if (data.messageId) {
      try {
        const existing = await channel.messages.fetch(data.messageId);
        await existing.edit(payload);
        console.log(`Token detector panel updated → #${channel.name}`);
        return;
      } catch {
        // message missing — repost
      }
    }

    const messages = await channel.messages.fetch({ limit: 20 });
    const existing = messages.find(
      (m) =>
        m.author.id === client.user.id &&
        m.components.some((r) =>
          r.components.some((c) => c.customId === PANEL_MARKER)
        )
    );
    if (existing) {
      await existing.edit(payload);
      data.messageId = existing.id;
      data.channelId = CHANNEL_ID;
      saveData(data);
      console.log(`Token detector panel linked → #${channel.name}`);
      return;
    }

    const sent = await channel.send(payload);
    data.messageId = sent.id;
    data.channelId = CHANNEL_ID;
    if (typeof data.kicks !== "number") data.kicks = 0;
    saveData(data);
    console.log(`Token detector panel posted → #${channel.name}`);
  } catch (err) {
    console.error("Failed to ensure token detector panel:", err.message);
  }
}

async function handleMessage(message) {
  if (!message.guild || message.author.bot) return false;
  if (message.channelId !== CHANNEL_ID) return false;

  // Staff can manage the channel without getting kicked
  if (isStaff(message.member)) return true;

  const data = loadData();

  try {
    await message.delete().catch(() => {});
  } catch {
    // ignore
  }

  let kicked = false;
  try {
    if (message.member?.kickable) {
      await message.member.kick("Token detector channel — unauthorized chat");
      kicked = true;
    }
  } catch (err) {
    console.error("Token detector kick failed:", err.message);
  }

  if (kicked) {
    data.kicks = (data.kicks || 0) + 1;
    saveData(data);
    await refreshPanel(message.client, data);
  }

  return true;
}

function handleInteraction(interaction) {
  if (
    interaction.isButton() &&
    interaction.customId === PANEL_MARKER
  ) {
    // Disabled button — should not fire, but ignore if it does
    return true;
  }
  return false;
}

module.exports = {
  handleMessage,
  handleInteraction,
  ensurePanel,
  CHANNEL_ID,
};
