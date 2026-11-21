# Deploying the public demo

Mosaic's public demo is nine Vercel projects built from this one repository, plus Scout on a server
of your own. Every Vercel project runs the same code; the `MOSAIC_ROLE` variable picks what that
origin serves (src/roles.ts):

| Role | Serves | Suggested project |
|---|---|---|
| `host` | The Mosaic workspace | `mosaic-host` |
| `docs` | Pagewright (network `pagewright`) | `mosaic-docs` |
| `releases` | Tagforge (`tagforge`) | `mosaic-releases` |
| `announcer` | Loudhailer (`loudhailer`) | `mosaic-announcer` |
| `newsletter` | Inkpost (`inkpost`), the site connected by typing its URL | `mosaic-newsletter` |
| `videos` | Reelhouse (`reelhouse`) | `mosaic-videos` |
| `issues` | Patchbay (`patchbay`) | `mosaic-issues` |
| `agents` | Foreman (`foreman`) | `mosaic-agents` |
| `corkboard` | Corkboard, the forum with no manifest that Scout learns | `mosaic-corkboard` |

Scout does not run on Vercel: it drives Chromium and serves each learned site on a port of its own.
It runs on a server behind Caddy (below).

## How a deployment is built

`vercel.json` sets the Bun runtime and the build command `bun run build:deploy`
(scripts/build-deploy.ts). The build prebuilds everything a server would otherwise read or build at
run time: the host page (src/host/index.html), the bridge actions module, the bridge page and the
vendored nsdeploy runtime. It bundles src/roles.ts with those assets inside into one file,
`dist-server/server.js` (about 3.6 MB). In production (`VERCEL` or `NODE_ENV=production` set) root
`server.ts` runs that file, so a deployment uses no HTML imports, reads no files and never runs
`Bun.build` on a request. From source (`bun run dev`, tests, e2e) nothing changes.

Check a build locally:

```bash
bun run build:deploy
MOSAIC_ROLE=docs NODE_ENV=production PORT=7901 bun server.ts
```

## Variables per role

Set each in the project's Production environment. Origins are exact: scheme and host, no path, no
trailing slash. Use the production alias (for example `https://mosaic-docs.vercel.app`), never a
per-deployment URL, which Deployment Protection hides behind a Vercel login.

| Variable | host | 7 sites | corkboard | Meaning |
|---|---|---|---|---|
| `MOSAIC_ROLE` | `host` | the role | `corkboard` | What this origin serves. |
| `NODE_ENV` | `production` | `production` | `production` | Runs the deploy bundle (Vercel's `VERCEL=1` does too). |
| `PUBLIC_ORIGIN` | - | required | optional | This site's own origin. Its API accepts calls only from this exact origin, so a wrong value breaks every capability call. Corkboard only prints it. |
| `MOSAIC_HOSTS` | - | required | - | Mosaic host origins, comma separated. Only these may frame the site's action bridge (`frame-ancestors`). |
| `SITE_ORIGINS` | recommended | - | - | `slug=origin` pairs, comma separated, of the sites the host's agent network links. Inkpost stays out on purpose. Also allowed by the host's CSP. |
| `MOSAIC_SUGGEST` | recommended | - | - | Site URLs suggested on the empty page, comma separated. Inkpost stays out. Also allowed by the host's CSP. |
| `MOSAIC_AGENT` | optional | - | - | Scout's origin. Unset: the "Teach Scout" offer never shows. Also allowed by the host's CSP. |
| `MOSAIC_CSP_ORIGINS` | optional | - | - | More http origins the host page may frame and fetch in local runs (https origins are always allowed). |
| `PORT` | local only | local only | local only | Ignored on Vercel. |

The host page's Content-Security-Policy (src/host/csp.ts) allows scripts from the host only, and
frames and fetches to any https origin, so a person can connect a site Mosaic has never seen and use
their own model router. The consent dialog gates each new origin before contact. The listed origins
(`SITE_ORIGINS`, `MOSAIC_SUGGEST`, `MOSAIC_AGENT`, `MOSAIC_CSP_ORIGINS`, `https://api.otari.ai`) stay
in the policy for http sites in local runs. Bridge pages send `frame-ancestors <MOSAIC_HOSTS>` and no
Cross-Origin-Opener-Policy, so the write popup keeps its opener. Only public agent files
(agent-manifest.json, the network file, links.json) and `/runtime/*` send
`Access-Control-Allow-Origin: *`.

## Vercel steps

Needs the owner's OK: each step below creates or changes something public. Run from the repository
root with the Vercel CLI logged in. Replace `<team>` with the team slug (`bunx vercel teams ls`).

```bash
SCOPE=<team>
ROLES="host docs releases announcer newsletter videos issues agents corkboard"

# 1. Create the projects and set each role.
for r in $ROLES; do
  bunx vercel@latest project add mosaic-$r --scope $SCOPE
  printf %s "$r"        | bunx vercel@latest env add MOSAIC_ROLE production --project mosaic-$r --scope $SCOPE
  printf %s production  | bunx vercel@latest env add NODE_ENV    production --project mosaic-$r --scope $SCOPE
done

# 2. First deploy, to learn each production alias (printed by the deploy, or `vercel project inspect`).
for r in $ROLES; do bunx vercel@latest deploy --prod --yes --project mosaic-$r --scope $SCOPE; done
```

Write the aliases down. The commands below assume `https://mosaic-<role>.vercel.app`; if Vercel
gave a project another name, use that.

```bash
o() { echo "https://mosaic-$1.vercel.app"; }
HOST=$(o host)
SCOUT_DOMAIN=<scout domain>           # for example 203-0-113-10.sslip.io; omit the Scout lines without Scout

# 3. Sites: their own origin and the host that may use them.
for r in docs releases announcer newsletter videos issues agents; do
  printf %s "$(o $r)" | bunx vercel@latest env add PUBLIC_ORIGIN production --project mosaic-$r --scope $SCOPE
  printf %s "$HOST"   | bunx vercel@latest env add MOSAIC_HOSTS  production --project mosaic-$r --scope $SCOPE
done
printf %s "$(o corkboard)" | bunx vercel@latest env add PUBLIC_ORIGIN production --project mosaic-corkboard --scope $SCOPE

# 4. Host: linked sites, suggestions, extra CSP origins, Scout.
printf %s "pagewright=$(o docs),tagforge=$(o releases),loudhailer=$(o announcer),reelhouse=$(o videos),patchbay=$(o issues),foreman=$(o agents)" \
  | bunx vercel@latest env add SITE_ORIGINS production --project mosaic-host --scope $SCOPE
printf %s "$(o docs),$(o releases),$(o announcer),$(o videos),$(o issues),$(o agents)" \
  | bunx vercel@latest env add MOSAIC_SUGGEST production --project mosaic-host --scope $SCOPE
printf %s "$(o newsletter),https://*.$SCOUT_DOMAIN" \
  | bunx vercel@latest env add MOSAIC_CSP_ORIGINS production --project mosaic-host --scope $SCOPE
printf %s "https://scout.$SCOUT_DOMAIN" \
  | bunx vercel@latest env add MOSAIC_AGENT production --project mosaic-host --scope $SCOPE

# 5. Redeploy every project: variables apply to new deployments only.
for r in $ROLES; do bunx vercel@latest deploy --prod --yes --project mosaic-$r --scope $SCOPE; done
```

If a CLI version lacks `--project`, deploy each project from a folder linked to it
(`vercel link --project mosaic-<role>`), or set `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` per run.

## Smoke test

```bash
# Host: the page, its policy, its public agent files, the runtime.
curl -sI "$HOST/" | grep -iE '^HTTP|content-security-policy'
curl -s  "$HOST/mosaic-host.json"
curl -sI "$HOST/agent-manifest.json" | grep -i access-control-allow-origin      # *
curl -sI "$HOST/runtime/engine.js"   | grep -iE '^HTTP|content-type'

# Every site: home, manifest, runtime, bridge page (frame-ancestors = host, no COOP), actions module.
for r in docs releases announcer newsletter videos issues agents; do
  for p in / /agent-manifest.json /runtime/engine.js /bridge/action-bridge.html /bridge/bridge-actions.js; do
    printf '%-10s %-28s %s\n' $r $p "$(curl -s -o /dev/null -w '%{http_code}' "$(o $r)$p")"
  done
  curl -sI "$(o $r)/bridge/action-bridge.html" | grep -iE 'content-security-policy|cross-origin-opener'
done
curl -s "$(o corkboard)/" | grep -o '<title>[^<]*'

# The agentic-web partner check, over HTTPS, for each site's network.
CHECK=<agentic-web checkout>/skills/agentify-website/scripts/check_partner.mjs
for pair in docs/pagewright releases/tagforge announcer/loudhailer newsletter/inkpost videos/reelhouse issues/patchbay agents/foreman; do
  node "$CHECK" "$(o ${pair%/*})/${pair#*/}" --origin "$HOST" || echo "FAILED: $pair"
done
```

Then a browser pass on `$HOST`: connect Pagewright from the suggestions, connect Inkpost by typing
its URL, run a read, approve one write in the site's popup, and check the badge still says
"Mosaic unchanged".

## Scout on a server

Needs the owner's OK: installing Caddy and opening ports 80 and 443 are outward steps. Placeholders:
`<server-ip>` and `<scout domain>` (for example `203-0-113-10.sslip.io`, which resolves to the IP
written in the name).

```bash
# 1. Caddy (automatic HTTPS) and the firewall: only 80 and 443 face the internet.
apt-get install -y caddy
ufw allow 80/tcp
ufw allow 443/tcp
ufw status                                  # 4108-4129 must stay closed

# 2. The code, Bun and Chromium for a dedicated user.
useradd --system --create-home --home-dir /var/lib/scout scout
git clone <repo url> /opt/mosaic && cd /opt/mosaic && bun install
sudo -u scout bunx playwright-core install chromium   # note the chrome path it prints

# 3. Scout's environment: copy, then fill in the domain, the host origin, Corkboard and CHROMIUM_PATH.
mkdir -p /etc/mosaic
cp deploy/scout.env.example /etc/mosaic/scout.env
#   PUBLIC_ORIGIN=https://scout.<scout domain>
#   MOSAIC_HOSTS=https://mosaic-host.vercel.app
#   SCOUT_TARGETS=https://mosaic-corkboard.vercel.app
#   SCOUT_ADAPTER_ORIGIN=https://scout-{port}.<scout domain>
#   CHROMIUM_PATH=/var/lib/scout/.cache/ms-playwright/chromium-<rev>/chrome-linux64/chrome

# 4. Caddy config: deploy/Caddyfile reads SCOUT_DOMAIN from its environment.
cp deploy/Caddyfile /etc/caddy/Caddyfile
mkdir -p /etc/systemd/system/caddy.service.d
printf '[Service]\nEnvironment=SCOUT_DOMAIN=<scout domain>\n' > /etc/systemd/system/caddy.service.d/scout.conf
systemctl daemon-reload && systemctl restart caddy

# 5. Scout as a service (deploy/mosaic-scout.service).
cp deploy/mosaic-scout.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now mosaic-scout
journalctl -u mosaic-scout -n 20

# 6. Check over HTTPS.
curl -sI https://scout.<scout domain>/ | head -1
```

Without Scout, leave `MOSAIC_AGENT` unset on the host. Corkboard still deploys, as "a site with no
manifest" that Mosaic refuses.

## What resets

Each site keeps its state (activity log, documents, counters, Corkboard threads) in memory, so a
cold start or a request served by another instance shows the seed data again. Nothing crashes.
