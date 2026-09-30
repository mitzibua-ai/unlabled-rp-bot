# UNLABLED RP Bot — Railway 24/7

## Deploy steps

1. Go to https://railway.app and sign in (GitHub recommended).
2. **New Project** → **Deploy from local directory** or connect this folder with the Railway CLI:

```bash
cd "c:\Users\Administrator\Desktop\UNLABLED ROLEPLAY"
railway login
railway init
railway up
```

3. In Railway → your service → **Variables**, paste every key from your local `.env`
   (at minimum `DISCORD_TOKEN` and `WELCOME_CHANNEL_ID`, plus all channel/role IDs you use).

4. Set **Start Command** to: `node index.js` (already in `railway.toml` / `Procfile`).

5. After deploy, **stop the local bot** so you do not run two instances with the same token.

## Notes

- Railway restarts the bot if it crashes (`restartPolicyType: ON_FAILURE`).
- JSON under `data/` resets on redeploy unless you add a Railway **Volume** mounted at `/app/data`.
- Do not commit `.env` — use Railway Variables only.
