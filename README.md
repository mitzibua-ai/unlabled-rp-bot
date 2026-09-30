# UNLABLED RP — Welcome Bot

Sends a styled welcome embed when someone joins your Discord server.

## Setup

### 1. Create the bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. **New Application** → name it (e.g. `UNLABLED Welcome`)
3. Open **Bot** → **Reset Token** → copy the token
4. Enable **Server Members Intent** (under Privileged Gateway Intents)
5. Open **OAuth2 → URL Generator**
   - Scopes: `bot`
   - Permissions: `Send Messages`, `Embed Links`, `View Channels`
6. Open the generated URL and invite the bot to **UNLABLED RP**

### 2. Get your welcome channel ID

1. Discord → User Settings → Advanced → enable **Developer Mode**
2. Right-click your welcome channel → **Copy Channel ID**

### 3. Configure the bot

```bash
copy .env.example .env
```

Edit `.env`:

```
DISCORD_TOKEN=paste_your_bot_token
WELCOME_CHANNEL_ID=paste_your_channel_id
WELCOME_BANNER_URL=https://link-to-your-banner.png
```

`WELCOME_BANNER_URL` is optional. Use a direct image link (Discord CDN, Imgur, etc.) for the bottom banner.

### 4. Install & run

```bash
npm install
npm start
```

## Message style

Matches the reference layout:

- Text: `Welcome to **UNLABLED RP** @user,`
- Yellow embed sidebar
- Author + thumbnail use the joiner’s avatar
- Title / description use **UNLABLED RP**
- Optional banner image at the bottom

## Whitelist system

### Extra `.env` values

```
WHITELIST_PANEL_CHANNEL_ID=channel_for_request_form
WHITELIST_APP_CHANNEL_ID=channel_for_normal_applications
WHITELIST_NO_VOUCH_CHANNEL_ID=channel_for_no_vouch_interviews
CITIZEN_ROLE_ID=role_given_on_approve
STAFF_ROLE_ID=staff_role_id
SERVER_LOGO_URL=optional_logo_url
```

### Post the form

1. Fill in the whitelist IDs in `.env`
2. Restart the bot
3. In Discord, run `/setup-whitelist`

### Flow

- **Request Whitelist** (green) → modal → **apps channel** → needs 1 vouch → staff Approve/Deny
- **No Vouch** (gray) → modal → **No Vouch channel** → admin interview → Approve/Deny
- No vouch within **2 hours** → auto-deny (normal applications only)
- Approve → DM + Citizen role
- Deny → DM

## Ticket system

### Extra `.env` values

```
TICKET_PANEL_CHANNEL_ID=channel_for_ticket_panel
TICKET_CATEGORY_ID=category_for_ticket_channels
TICKET_LOG_CHANNEL_ID=optional_close_log_channel
```

Staff role uses the same `STAFF_ROLE_ID` as whitelist.

### Post the panel

1. Fill in the ticket IDs in `.env`
2. Restart the bot
3. In Discord, run `/setup-tickets`

### Flow

- **Create Ticket** (green) → private channel under the category
- Only the opener + staff can see it
- **Close Ticket** → confirm → channel deletes after 5 seconds
- Optional log embed sent to `TICKET_LOG_CHANNEL_ID`
