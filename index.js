require("dotenv").config();
const fs = require("fs");
const path = require("path");
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  Events,
  MessageFlags,
  Partials,
} = require("discord.js");
const whitelist = require("./whitelist");
const tickets = require("./tickets");
const rename = require("./rename");
const requestrole = require("./requestrole");
const unrole = require("./unrole");
const prefix = require("./prefix");
const logger = require("./logger");
const tokendetector = require("./tokendetector");

try {
  fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });
  fs.mkdirSync(path.join(__dirname, "transcripts"), { recursive: true });
} catch (err) {
  console.error("Failed to create data folders:", err?.message || err);
}

const TOKEN = process.env.DISCORD_TOKEN;
const WELCOME_CHANNEL_ID = process.env.WELCOME_CHANNEL_ID;
const WELCOME_BANNER_URL = process.env.WELCOME_BANNER_URL || "";
const SERVER_NAME = "UNLABLED RP";
const EMBED_COLOR = 0xf1c40f;

if (!TOKEN) {
  console.error("Missing DISCORD_TOKEN in .env / environment");
  process.exit(1);
}

if (!WELCOME_CHANNEL_ID) {
  console.error("Missing WELCOME_CHANNEL_ID in .env / environment");
  process.exit(1);
}

// Keep the process alive on unexpected errors (Railway will still restart on exit)
process.on("unhandledRejection", (err) => {
  console.error("Unhandled promise rejection:", err);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [
    ...(logger.requiredPartials?.() || []),
    Partials.Channel,
    Partials.Message,
    Partials.GuildMember,
  ],
});

async function safe(label, fn) {
  try {
    await fn();
  } catch (err) {
    console.error(`[startup] ${label} failed:`, err?.message || err);
  }
}

client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);
  console.log(`Welcome messages → channel ${WELCOME_CHANNEL_ID}`);

  await safe("register slash commands", async () => {
    const commands = [
      ...whitelist.getCommands(),
      ...tickets.getCommands(),
      ...rename.getCommands(),
      ...requestrole.getCommands(),
      ...unrole.getCommands(),
    ];

    await client.application.commands.set([]);
    for (const [, guild] of client.guilds.cache) {
      await guild.commands.set(commands);
      console.log(`Slash commands synced → ${guild.name}`);
    }

    console.log(
      "Slash commands registered (/setup-whitelist, /setup-tickets, /rename, /requestrole, /unrole)"
    );
  });

  await safe("resume whitelist auto-denies", () => {
    whitelist.resumeAutoDenies(client);
  });
  await safe("sync whitelist panel", () => whitelist.syncPanelButtons(client));
  await safe("ensure open tickets", () => tickets.ensureOpenTickets(client));
  await safe("sync ticket panel", () => tickets.syncTicketPanel(client));
  await safe("resume tempbans", () => {
    prefix.resumeTempBans(client);
  });
  await safe("register message logger", () => {
    logger.registerMessageLogger(client);
  });
  await safe("ensure token detector panel", () =>
    tokendetector.ensurePanel(client)
  );

  const logStatus = logger.status();
  console.log(
    `Loggers → whitelist:${logStatus.whitelist} rename:${logStatus.rename} role:${logStatus.roleRequest} unrole:${logStatus.unrole} message:${logStatus.message}`
  );
  console.log(`Token detector → #${tokendetector.CHANNEL_ID}`);
  console.log(`Prefix commands ready (${prefix.PREFIX}help)`);
  console.log("Bot is ready.");
});

client.on(Events.Error, (err) => {
  console.error("Discord client error:", err);
});

client.on(Events.Warn, (info) => {
  console.warn("Discord client warn:", info);
});

client.on(Events.ShardError, (err) => {
  console.error("Shard error:", err);
});

client.on(Events.MessageCreate, async (message) => {
  try {
    if (await tokendetector.handleMessage(message)) return;
    await prefix.handleMessage(message);
  } catch (err) {
    console.error("MessageCreate error:", err);
  }
});

client.on(Events.GuildMemberAdd, async (member) => {
  try {
    const channel = await member.guild.channels.fetch(WELCOME_CHANNEL_ID);
    if (!channel || !channel.isTextBased()) {
      console.error("Welcome channel not found or is not a text channel.");
      return;
    }

    const avatarURL = member.user.displayAvatarURL({
      size: 512,
      extension: "png",
    });

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setAuthor({
        name: member.user.username,
        iconURL: avatarURL,
      })
      .setTitle(`Welcome to ${SERVER_NAME}`)
      .setDescription(
        `Welcome to **${SERVER_NAME}**!\nWe're glad to have you here. Read the rules and enjoy the city.`
      )
      .setThumbnail(avatarURL);

    if (WELCOME_BANNER_URL.trim()) {
      embed.setImage(WELCOME_BANNER_URL.trim());
    }

    await channel.send({
      content: `Welcome to **${SERVER_NAME}** ${member},`,
      embeds: [embed],
    });
  } catch (err) {
    console.error("Failed to send welcome message:", err);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    const handled =
      (await whitelist.handleInteraction(interaction)) ||
      (await tickets.handleInteraction(interaction)) ||
      (await rename.handleInteraction(interaction)) ||
      (await requestrole.handleInteraction(interaction)) ||
      (await unrole.handleInteraction(interaction)) ||
      tokendetector.handleInteraction(interaction);
    if (
      !handled &&
      interaction.isRepliable() &&
      !interaction.replied &&
      !interaction.deferred
    ) {
      // ignore unknown interactions
    }
  } catch (err) {
    console.error("Interaction error:", err);
    const payload = {
      content: "Something went wrong handling that interaction.",
      flags: MessageFlags.Ephemeral,
    };
    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(payload);
      } else if (interaction.isRepliable()) {
        await interaction.reply(payload);
      }
    } catch {
      // interaction may already be dead
    }
  }
});

async function start() {
  try {
    await client.login(TOKEN);
  } catch (err) {
    console.error("Failed to login:", err?.message || err);
    process.exit(1);
  }
}

start();
