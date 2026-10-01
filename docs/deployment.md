# Deploying the Sharibo browser app

The live demo linked from the root README
([https://dist-flax-three-43.vercel.app](https://dist-flax-three-43.vercel.app))
is a **manual** Vercel deployment of `app/`.

## Why it is manual

Both [`vercel.json`](../vercel.json) and [`app/vercel.json`](../app/vercel.json)
set `"git.deploymentEnabled": false`. Pushes to GitHub do **not** trigger a
deploy. Environment variables are baked into the static build from `app/.env`
at build time (Vite `VITE_*`), not configured as Vercel project env vars.

## Prerequisites

1. Root `npm install`
2. `npm run build --workspace=packages/client` (app resolves `@sharibo/client` from `dist/`)
3. Circuit artifacts built (`cd circuits && npm run compile && npm run setup`)
4. `app/.env` filled with the current testnet contract + token IDs

## Deploy

```bash
cd app
npm run build     # sync-circuit + vite build → app/dist
vercel --prod     # deploys dist/ to the existing project
cd ..
```

If the CLI is not linked yet: `vercel link` and select the **existing** project
so the public URL stays the same.

After a contract redeploy, also follow
[docs/runbook-testnet-reset.md](runbook-testnet-reset.md) §7–8 so README
on-chain evidence stays accurate.
