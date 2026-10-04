const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
  MessageFlags,
  ApplicationCommandOptionType,
} = require("discord.js");
const logger = require("./logger");
const { isStaff } = require("./roles");
const SERVER_NAME = "UNLABLED RP";
const EMBED_COLOR = 0xf1c40f;
const VOUCH_REQUIRED = 1;
const AUTO_DENY_MS = 2 * 60 * 60 * 1000; // 2 hours

const DATA_PATH = path.join(__dirname, "data", "applications.json");

const IDS = {
  REQUEST: "wl_request",
  NO_VOUCH: "wl_no_vouch",
  ADD_PLAYER: "wl_add_player",
  REVOKE_VOUCH: "wl_revoke_vouch",
  MODAL_NORMAL: "wl_modal_normal",
  MODAL_INTERVIEW: "wl_modal_interview",
  MODAL_ADD: "wl_modal_add",
  MODAL_REVOKE: "wl_modal_revoke",
  FIRST: "wl_first",
  LAST: "wl_last",
  PLAYER: "wl_player",
  VOUCH: "wl_vouch",
  APPROVE: "wl_approve",
  DENY: "wl_deny",
};

function loadApps() {
  try {
    return JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveApps(apps) {
  try {
    fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
    fs.writeFileSync(DATA_PATH, JSON.stringify(apps, null, 2));
  } catch (err) {
    console.error("Failed to save whitelist apps:", err?.message || err);
  }
}

function getLogo(guild) {
  return (
    process.env.SERVER_LOGO_URL ||
    guild?.iconURL({ size: 256, extension: "png" }) ||
    undefined
  );
}

function formatAccountCreated(user) {
  const created = Math.floor(user.createdTimestamp / 1000);
  return `<t:${created}:F> (<t:${created}:R>)`;
}

function buildPanelEmbed(guild) {
  const logo = getLogo(guild);
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setAuthor({ name: SERVER_NAME, iconURL: logo })
    .setTitle("Whitelist Guide")
    .setDescription(
      [
        `Welcome to **${SERVER_NAME}**. Read this before you apply.`,
        "",
        "**Rules for applying**",
        "• Use a realistic first and last name that fits roleplay.",
        "• A community vouch helps your case — it does not guarantee approval.",
        "• New Discord accounts (under **1 month**) must use the interview path.",
        "• Your Discord account should be at least **3 months** old to apply.",
        "• Fake, joke, or incomplete names can be denied.",
        "",
        "**Pick a path**",
        "✅ **Whitelist Request** — Apply normally (needs a community vouch).",
        "🎧 **Apply Without Voucher** — Request a moderator interview instead.",
        "",
        "When you're ready, use one of the buttons below.",
      ].join("\n")
    )
    .setFooter({
      text: `${SERVER_NAME} • Whitelist System`,
      iconURL: logo,
    });

  if (logo) embed.setThumbnail(logo);
  return embed;
}

function buildPanelButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(IDS.REQUEST)
        .setLabel("Whitelist Request")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(IDS.NO_VOUCH)
        .setLabel("Apply Without Voucher")
        .setStyle(ButtonStyle.Secondary)
    ),
  ];
}

function buildNameModal(customId) {
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle("Whitelist Application")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(IDS.FIRST)
          .setLabel("First Name")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("e.g. Diego")
          .setRequired(true)
          .setMaxLength(32)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(IDS.LAST)
          .setLabel("Last Name")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("e.g. Cortez")
          .setRequired(true)
          .setMaxLength(32)
      )
    );
}

function buildAddPlayerModal() {
  return new ModalBuilder()
    .setCustomId(IDS.MODAL_ADD)
    .setTitle("Staff — Add Player")
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

function buildRevokeVouchModal() {
  return new ModalBuilder()
    .setCustomId(IDS.MODAL_REVOKE)
    .setTitle("Revoke Vouch")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(IDS.PLAYER)
          .setLabel("Applicant Discord ID / Username")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("Who you vouched for")
          .setRequired(true)
          .setMaxLength(64)
      )
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

function buildAppEmbed(app, guild) {
  const logo = getLogo(guild);
  const statusLine =
    app.status === "pending"
      ? app.needsInterview
        ? "Needs Admin Interview"
        : "Pending review"
      : app.status === "approved"
        ? `Approved by <@${app.reviewedBy}>`
        : app.status === "denied"
          ? `Denied by <@${app.reviewedBy}>`
          : app.status === "revoked"
            ? `Revoked by <@${app.reviewedBy}>`
            : app.status;

  const vouchers =
    app.vouchers.length > 0
      ? app.vouchers
          .map((v) => `<@${v.id}> (${app.vouchers.length}/${VOUCH_REQUIRED})`)
          .join(", ")
      : `None (0/${VOUCH_REQUIRED})`;

  const voucherInfo =
    app.vouchers.length > 0
      ? app.vouchers
          .map((v) => {
            const t = Math.floor(v.at / 1000);
            return `${v.tag} — <t:${t}:F> (<t:${t}:R>)`;
          })
          .join("\n")
      : app.needsInterview
        ? "Interview path — vouch not required"
        : "No vouches yet";

  const titleSuffix =
    app.status === "approved"
      ? "Approved"
      : app.status === "denied"
        ? "Denied"
        : app.status === "revoked"
          ? "Revoked"
          : "Pending";

  let description;
  if (app.status === "approved") {
    description = "This whitelist application has been **approved**.";
  } else if (app.status === "denied") {
    description = "This whitelist application has been **denied**.";
  } else if (app.status === "revoked") {
    description = "This whitelist has been **revoked** by staff.";
  } else if (app.needsInterview) {
    description =
      "This applicant selected **No Vouch** and needs an admin interview.";
  } else {
    description = "A new whitelist application is awaiting review.";
  }

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setAuthor({ name: SERVER_NAME, iconURL: logo })
    .setTitle(`Whitelist Application - ${titleSuffix}`)
    .setDescription(description)
    .addFields(
      { name: "Application ID", value: `\`${app.id}\`` },
      {
        name: "Applicant",
        value: `<@${app.userId}> (${app.username})`,
      },
      { name: "Account Created", value: app.accountCreated },
      { name: "First Name", value: app.firstName, inline: true },
      { name: "Last Name", value: app.lastName, inline: true },
      { name: "Status", value: statusLine },
      { name: "Vouchers", value: vouchers },
      { name: "Voucher Information", value: voucherInfo }
    )
    .setFooter({
      text: `${SERVER_NAME} • Whitelist System`,
      iconURL: logo,
    })
    .setTimestamp(app.createdAt);

  if (logo) embed.setThumbnail(logo);
  return embed;
}

function buildAppButtons(app) {
  const closed = app.status !== "pending";
  const row = new ActionRowBuilder();

  if (!app.needsInterview) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${IDS.VOUCH}:${app.id}`)
        .setLabel("Vouch")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(closed || app.vouchers.length >= VOUCH_REQUIRED)
    );
  }

  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`${IDS.APPROVE}:${app.id}`)
      .setLabel("Approve")
      .setStyle(ButtonStyle.Success)
      .setDisabled(closed),
    new ButtonBuilder()
      .setCustomId(`${IDS.DENY}:${app.id}`)
      .setLabel("Deny")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(closed)
  );

  return row;
}

function hasPendingApp(userId) {
  const apps = loadApps();
  return Object.values(apps).some(
    (a) => a.userId === userId && a.status === "pending"
  );
}

async function postPanel(channel) {
  const payload = {
    embeds: [buildPanelEmbed(channel.guild)],
    components: buildPanelButtons(),
  };

  // Update the latest bot panel in this channel instead of leaving an old one
  try {
    const messages = await channel.messages.fetch({ limit: 30 });
    const existing = messages.find(
      (m) =>
        m.author.id === channel.client.user.id &&
        (m.embeds[0]?.title === "Request Whitelist" ||
          m.embeds[0]?.title === "APPLICATION GUIDE" ||
          m.embeds[0]?.title === "Whitelist Guide")
    );
    if (existing) {
      await existing.edit(payload);
      return existing;
    }
  } catch (err) {
    console.error("Failed to edit existing whitelist panel:", err.message);
  }

  return channel.send(payload);
}

async function ensurePanel(client) {
  const panelChannelId = process.env.WHITELIST_PANEL_CHANNEL_ID;
  if (!panelChannelId) return;

  try {
    const channel = await client.channels.fetch(panelChannelId);
    if (!channel?.isTextBased()) return;
    await postPanel(channel);
    console.log(`Whitelist panel updated → #${channel.name}`);
  } catch (err) {
    console.error("Failed to update whitelist panel:", err.message);
  }
}

/** Updates panel embed + buttons to the Application Guide */
async function syncPanelButtons(client) {
  const panelChannelId = process.env.WHITELIST_PANEL_CHANNEL_ID;
  if (!panelChannelId) return;

  try {
    const channel = await client.channels.fetch(panelChannelId);
    if (!channel?.isTextBased()) return;

    const messages = await channel.messages.fetch({ limit: 30 });
    const existing = messages.find(
      (m) =>
        m.author.id === client.user.id &&
        (m.embeds[0]?.title === "Request Whitelist" ||
          m.embeds[0]?.title === "APPLICATION GUIDE" ||
          m.embeds[0]?.title === "Whitelist Guide" ||
          m.components?.some((row) =>
            row.components?.some(
              (c) => c.customId === IDS.REQUEST || c.customId === IDS.NO_VOUCH
            )
          ))
    );
    if (!existing) return;

    await existing.edit({
      embeds: [buildPanelEmbed(channel.guild)],
      components: buildPanelButtons(),
    });
    console.log(`Whitelist Application Guide synced → #${channel.name}`);
  } catch (err) {
    console.error("Failed to sync whitelist panel:", err.message);
  }
}

async function revokeVouch(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const playerQuery = interaction.fields.getTextInputValue(IDS.PLAYER).trim();
  const member = await resolveMember(interaction.guild, playerQuery);
  if (!member) {
    await interaction.editReply({
      content: `Could not find a member matching \`${playerQuery}\`.`,
    });
    return;
  }

  const apps = loadApps();
  const pending = Object.values(apps).filter(
    (a) =>
      a.userId === member.id &&
      a.status === "pending" &&
      !a.needsInterview &&
      a.vouchers.some((v) => v.id === interaction.user.id)
  );

  if (!pending.length) {
    await interaction.editReply({
      content: `You have no active vouch on a pending application for ${member}.`,
    });
    return;
  }

  for (const app of pending) {
    app.vouchers = app.vouchers.filter((v) => v.id !== interaction.user.id);
    await refreshAppMessage(interaction.client, app);
    await logger.logWhitelist(interaction.client, interaction.guild, {
      action: "Vouch Revoked",
      app,
      actorId: interaction.user.id,
      extra: `Revoked vouch for <@${member.id}>`,
    });
  }
  saveApps(apps);

  await interaction.editReply({
    content: `Your vouch for ${member} was revoked.`,
  });
}

async function handleRevokeCommand(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!isStaff(interaction.member)) {
    await interaction.editReply({
      content:
        "Only moderators or admins can revoke whitelist. (Patron / EMS / PD leads cannot.)",
    });
    return true;
  }

  const targetUser = interaction.options.getUser("user", true);
  const reason =
    interaction.options.getString("reason")?.trim() || "No reason provided";

  if (targetUser.bot) {
    await interaction.editReply({ content: "You cannot revoke a bot." });
    return true;
  }

  const roleId = (process.env.CITIZEN_ROLE_ID || "").trim();
  let member = null;
  try {
    member = await interaction.guild.members.fetch(targetUser.id);
  } catch {
    member = null;
  }

  const hasCitizen =
    Boolean(roleId) && Boolean(member?.roles.cache.has(roleId));

  const apps = loadApps();
  const approvedApps = Object.values(apps).filter(
    (a) => a.userId === targetUser.id && a.status === "approved"
  );

  if (!hasCitizen && approvedApps.length === 0) {
    await interaction.editReply({
      content: `${targetUser} is not currently whitelisted (no Citizen role / approved application).`,
    });
    return true;
  }

  let roleNote = "";
  if (roleId && member) {
    if (hasCitizen) {
      try {
        await member.roles.remove(roleId, `Whitelist revoked by ${interaction.user.tag}: ${reason}`);
      } catch (err) {
        console.error("Failed to remove Citizen role on revoke:", err.message);
        roleNote =
          " (Could not remove Citizen role — check bot permissions / role hierarchy.)";
      }
    }
  } else if (roleId && !member) {
    roleNote = " (User left the server — Citizen role could not be removed.)";
  } else if (!roleId) {
    roleNote = " (CITIZEN_ROLE_ID is not set.)";
  }

  for (const app of approvedApps) {
    app.status = "revoked";
    app.reviewedBy = interaction.user.id;
    app.revokedAt = Date.now();
    app.revokeReason = reason;
    await refreshAppMessage(interaction.client, app);
  }
  if (approvedApps.length) saveApps(apps);

  const primary = approvedApps[0] || {
    userId: targetUser.id,
    username: targetUser.username,
    firstName: member?.displayName || targetUser.username,
    lastName: "",
    needsInterview: false,
    status: "revoked",
    vouchers: [],
    reviewedBy: interaction.user.id,
    accountCreated: member
      ? formatAccountCreated(member.user)
      : formatAccountCreated(targetUser),
  };

  await logger.logWhitelist(interaction.client, interaction.guild, {
    action: "Revoked",
    app: { ...primary, status: "revoked" },
    actorId: interaction.user.id,
    extra: `Reason: ${reason}${
      approvedApps.length
        ? `\nApplications marked revoked: ${approvedApps.length}`
        : "\nNo stored application — Citizen role removed only."
    }`,
  });

  await interaction.editReply({
    content: `Revoked whitelist for ${targetUser}.${
      roleNote || " Citizen role removed."
    }`,
  });
  return true;
}

async function staffAddPlayer(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!isStaff(interaction.member)) {
    await interaction.editReply({
      content: "Only moderators or admins can use **Add Player**.",
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

  const roleId = process.env.CITIZEN_ROLE_ID;
  if (roleId) {
    try {
      await member.roles.add(roleId);
    } catch (err) {
      await interaction.editReply({
        content: `Found ${member}, but failed to add Citizen role: ${err.message}`,
      });
      return;
    }
  }

  const apps = loadApps();
  let changed = false;
  for (const app of Object.values(apps)) {
    if (app.userId === member.id && app.status === "pending") {
      app.status = "approved";
      app.reviewedBy = interaction.user.id;
      changed = true;
      await refreshAppMessage(interaction.client, app);
    }
  }
  if (changed) saveApps(apps);

  await logger.logWhitelist(interaction.client, interaction.guild, {
    action: "Staff Added",
    app: {
      userId: member.id,
      username: member.user.username,
      firstName: member.displayName,
      lastName: "",
      needsInterview: false,
      status: "approved",
      vouchers: [],
      reviewedBy: interaction.user.id,
      accountCreated: formatAccountCreated(member.user),
    },
    actorId: interaction.user.id,
    extra: "Manually whitelisted via Add Player",
  });

  const appChannelId = process.env.WHITELIST_APP_CHANNEL_ID;
  if (appChannelId) {
    try {
      const channel = await interaction.client.channels.fetch(appChannelId);
      if (channel?.isTextBased()) {
        const logo = getLogo(interaction.guild);
        const embed = new EmbedBuilder()
          .setColor(EMBED_COLOR)
          .setAuthor({ name: SERVER_NAME, iconURL: logo })
          .setTitle("Whitelist Application - Approved")
          .setDescription("Player was **manually added** by staff.")
          .addFields(
            {
              name: "Applicant",
              value: `${member} (${member.user.username})`,
            },
            {
              name: "Account Created",
              value: formatAccountCreated(member.user),
            },
            {
              name: "Status",
              value: `Manually added by ${interaction.user}`,
            }
          )
          .setFooter({
            text: `${SERVER_NAME} • Whitelist System`,
            iconURL: logo,
          })
          .setTimestamp();

        if (logo) embed.setThumbnail(logo);
        await channel.send({ embeds: [embed] });
      }
    } catch (err) {
      console.error("Failed to log staff add:", err.message);
    }
  }

  await interaction.editReply({
    content: `Added ${member} — they now have the Citizen role.`,
  });
}

async function createApplication(interaction, needsInterview) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (hasPendingApp(interaction.user.id)) {
    await interaction.editReply({
      content: "You already have a pending whitelist application.",
    });
    return;
  }

  const firstName = interaction.fields.getTextInputValue(IDS.FIRST).trim();
  const lastName = interaction.fields.getTextInputValue(IDS.LAST).trim();
  const nickname = `${firstName} ${lastName}`.trim().slice(0, 32);

  try {
    const member =
      interaction.member ??
      (await interaction.guild.members.fetch(interaction.user.id));
    if (member?.manageable) {
      await member.setNickname(nickname, "Whitelist application name");
    } else {
      console.warn(
        `Could not set nickname for ${interaction.user.id} (role hierarchy)`
      );
    }
  } catch (err) {
    console.error("Failed to set whitelist nickname:", err.message);
  }

  const appChannelId = needsInterview
    ? process.env.WHITELIST_NO_VOUCH_CHANNEL_ID
    : process.env.WHITELIST_APP_CHANNEL_ID;

  if (!appChannelId) {
    await interaction.editReply({
      content: needsInterview
        ? "No Vouch / interview channel is not configured."
        : "Whitelist application channel is not configured.",
    });
    return;
  }

  const channel = await interaction.client.channels.fetch(appChannelId);
  if (!channel || !channel.isTextBased()) {
    await interaction.editReply({
      content: "Could not find the whitelist application channel.",
    });
    return;
  }

  const id = crypto.randomUUID();
  const app = {
    id,
    userId: interaction.user.id,
    username: interaction.user.username,
    firstName,
    lastName,
    accountCreated: formatAccountCreated(interaction.user),
    needsInterview: !!needsInterview,
    status: "pending",
    vouchers: [],
    reviewedBy: null,
    createdAt: Date.now(),
    messageId: null,
    channelId: appChannelId,
    guildId: interaction.guildId,
  };

  const msg = await channel.send({
    embeds: [buildAppEmbed(app, interaction.guild)],
    components: [buildAppButtons(app)],
  });

  app.messageId = msg.id;
  const apps = loadApps();
  apps[id] = app;
  saveApps(apps);

  await logger.logWhitelist(interaction.client, interaction.guild, {
    action: "Submitted",
    app,
    actorId: interaction.user.id,
  });

  await interaction.editReply({
    content: needsInterview
      ? `Your application was submitted as **${nickname}**. An admin will interview you.`
      : `Your whitelist application was submitted as **${nickname}**. Staff and community will review it.`,
  });

  if (!needsInterview) {
    setTimeout(() => autoDenyIfNoVouch(interaction.client, id), AUTO_DENY_MS);
  }
}

async function refreshAppMessage(client, app) {
  try {
    const channel = await client.channels.fetch(app.channelId);
    const msg = await channel.messages.fetch(app.messageId);
    const guild = await client.guilds.fetch(app.guildId);
    await msg.edit({
      embeds: [buildAppEmbed(app, guild)],
      components: [buildAppButtons(app)],
    });
  } catch (err) {
    console.error("Failed to refresh application message:", err.message);
  }
}

async function autoDenyIfNoVouch(client, appId) {
  const apps = loadApps();
  const app = apps[appId];
  if (!app || app.status !== "pending" || app.needsInterview) return;
  if (app.vouchers.length >= VOUCH_REQUIRED) return;

  app.status = "denied";
  app.reviewedBy = client.user.id;
  saveApps(apps);
  await refreshAppMessage(client, app);

  let guild = null;
  try {
    guild = await client.guilds.fetch(app.guildId);
  } catch {
    // ignore
  }
  await logger.logWhitelist(client, guild, {
    action: "Auto-Denied",
    app,
    actorId: client.user.id,
    extra: "No vouch within 2 hours",
  });
}

async function handleInteraction(interaction) {
  // Panel buttons → open modal
  if (interaction.isButton()) {
    if (interaction.customId === IDS.REQUEST) {
      await interaction.showModal(buildNameModal(IDS.MODAL_NORMAL));
      return true;
    }
    if (interaction.customId === IDS.NO_VOUCH) {
      await interaction.showModal(buildNameModal(IDS.MODAL_INTERVIEW));
      return true;
    }
    if (interaction.customId === IDS.ADD_PLAYER) {
      await interaction.reply({
        content:
          "**Add Player** is only available inside tickets now, not on the whitelist panel.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const [action, appId] = interaction.customId.split(":");
    if (![IDS.VOUCH, IDS.APPROVE, IDS.DENY].includes(action)) return false;

    // Acknowledge immediately so Discord doesn't show "didn't respond in time"
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const apps = loadApps();
    const app = apps[appId];
    if (!app) {
      await interaction.editReply({ content: "Application not found." });
      return true;
    }
    if (app.status !== "pending") {
      await interaction.editReply({
        content: "This application is already closed.",
      });
      return true;
    }

    if (action === IDS.VOUCH) {
      if (app.needsInterview) {
        await interaction.editReply({
          content:
            "This application needs an admin interview — vouching is disabled.",
        });
        return true;
      }
      if (interaction.user.id === app.userId) {
        await interaction.editReply({
          content: "You cannot vouch for yourself.",
        });
        return true;
      }
      const citizenRoleId = process.env.CITIZEN_ROLE_ID;
      if (
        !citizenRoleId ||
        !interaction.member?.roles?.cache?.has(citizenRoleId)
      ) {
        await interaction.editReply({
          content: "Only players with the **Citizen** role can vouch.",
        });
        return true;
      }
      if (app.vouchers.some((v) => v.id === interaction.user.id)) {
        await interaction.editReply({
          content: "You already vouched for this application.",
        });
        return true;
      }
      if (app.vouchers.length >= VOUCH_REQUIRED) {
        await interaction.editReply({
          content: "This application already has enough vouches.",
        });
        return true;
      }

      app.vouchers.push({
        id: interaction.user.id,
        tag: interaction.user.username,
        at: Date.now(),
      });
      saveApps(apps);
      await refreshAppMessage(interaction.client, app);
      await logger.logWhitelist(interaction.client, interaction.guild, {
        action: "Vouched",
        app,
        actorId: interaction.user.id,
      });
      await interaction.editReply({
        content: `You vouched for **${app.firstName} ${app.lastName}**.`,
      });
      return true;
    }

    // Approve / Deny — staff only
    if (!isStaff(interaction.member)) {
      await interaction.editReply({
        content: "Only moderators or admins can approve or deny applications.",
      });
      return true;
    }

    if (
      action === IDS.APPROVE &&
      !app.needsInterview &&
      app.vouchers.length < VOUCH_REQUIRED
    ) {
      await interaction.editReply({
        content: `This application still needs a vouch (${app.vouchers.length}/${VOUCH_REQUIRED}). Use **No Vouch** on the panel for interview applicants, or wait for a vouch.`,
      });
      return true;
    }

    app.status = action === IDS.APPROVE ? "approved" : "denied";
    app.reviewedBy = interaction.user.id;
    saveApps(apps);
    await refreshAppMessage(interaction.client, app);

    // Log approve/deny with full details (admin, vouchers, IC name, etc.)
    await logger.logWhitelist(interaction.client, interaction.guild, {
      action: action === IDS.APPROVE ? "Approved" : "Denied",
      app,
      actorId: interaction.user.id,
    });

    if (action === IDS.APPROVE) {
      const roleId = process.env.CITIZEN_ROLE_ID;
      if (roleId) {
        try {
          const member = await interaction.guild.members.fetch(app.userId);
          await member.roles.add(roleId);
        } catch (err) {
          console.error("Failed to add Citizen role:", err.message);
        }
      }
      await interaction.editReply({
        content: `Approved **${app.firstName} ${app.lastName}**.`,
      });
    } else {
      await interaction.editReply({
        content: `Denied **${app.firstName} ${app.lastName}**.`,
      });
    }
    return true;
  }

  if (interaction.isModalSubmit()) {
    if (interaction.customId === IDS.MODAL_NORMAL) {
      await createApplication(interaction, false);
      return true;
    }
    if (interaction.customId === IDS.MODAL_INTERVIEW) {
      await createApplication(interaction, true);
      return true;
    }
    if (interaction.customId === IDS.MODAL_ADD) {
      await staffAddPlayer(interaction);
      return true;
    }
    if (interaction.customId === IDS.MODAL_REVOKE) {
      await revokeVouch(interaction);
      return true;
    }
  }

  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === "setup-whitelist") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      if (!isStaff(interaction.member)) {
        await interaction.editReply({
          content: "Only moderators or admins can post the whitelist panel.",
        });
        return true;
      }
      const panelChannelId = process.env.WHITELIST_PANEL_CHANNEL_ID;
      const channel = panelChannelId
        ? await interaction.client.channels.fetch(panelChannelId)
        : interaction.channel;

      await postPanel(channel);
      await interaction.editReply({
        content: `Whitelist panel posted in <#${channel.id}>.`,
      });
      return true;
    }

    if (interaction.commandName === "revoke") {
      return handleRevokeCommand(interaction);
    }
  }

  return false;
}

function getCommands() {
  return [
    {
      name: "setup-whitelist",
      description: "Post the UNLABLED RP whitelist request panel",
      defaultMemberPermissions: PermissionFlagsBits.ManageGuild.toString(),
    },
    {
      name: "revoke",
      description:
        "Revoke a player's whitelist and remove their Citizen role (mods/admins only)",
      defaultMemberPermissions:
        PermissionFlagsBits.ModerateMembers.toString(),
      dmPermission: false,
      options: [
        {
          name: "user",
          description: "The player to revoke whitelist from",
          type: ApplicationCommandOptionType.User,
          required: true,
        },
        {
          name: "reason",
          description: "Reason for the revoke",
          type: ApplicationCommandOptionType.String,
          required: false,
          max_length: 200,
        },
      ],
    },
  ];
}

function resumeAutoDenies(client) {
  const apps = loadApps();
  const now = Date.now();
  for (const app of Object.values(apps)) {
    if (app.status !== "pending" || app.needsInterview) continue;
    if (app.vouchers.length >= VOUCH_REQUIRED) continue;
    const remaining = app.createdAt + AUTO_DENY_MS - now;
    if (remaining <= 0) {
      autoDenyIfNoVouch(client, app.id);
    } else {
      setTimeout(() => autoDenyIfNoVouch(client, app.id), remaining);
    }
  }
}

module.exports = {
  handleInteraction,
  getCommands,
  resumeAutoDenies,
  postPanel,
  ensurePanel,
  syncPanelButtons,
};
