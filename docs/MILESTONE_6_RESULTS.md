# Milestone 6: cloud preparation checkpoint

17 November 2026. **IN PROGRESS, not accepted.** No push, provisioning or deployment. Broad answer-quality evaluation deferred per latest user instruction; necessary configuration checks performed.

## Reproduced defect and localized change

The previous `render.yaml` had only a free API, default integrated scheduling, automatic startup migration and no worker/queue configuration. A parsed-config assertion failed with `Cloud blueprint has no separate worker` (`data/m6-config-before.log`). That configuration could not represent the separately tested Docker architecture.

The updated Blueprint reuses the existing backend image and worker entrypoint. It explicitly sets API/worker roles, BullMQ, shared configuration, referenced secrets, disabled runtime migrations, API-owned pre-deploy migration, manual deployment triggers, 30-second shutdown, API readiness and worker heartbeat path. Both service templates select paid Starter instances; no resources were purchased. These are staging choices, not measured capacity.

Files changed in this checkpoint: `render.yaml`, `.env.example` (guide comments), root `DEPLOYMENT.md` (canonical link), `docs/DEPLOYMENT.md`, `docs/TROUBLESHOOTING.md`, `docs/IMPLEMENTATION_PLAN.md`, `docs/RAG_STABILITY_STATE.md`, `docs/RELEASE_READINESS.md`, and this report. Existing unrelated edits were preserved. No frontend/backend algorithm, SQL migration or application dependency changed.

## Executed checks

| Check | Actual outcome / evidence |
| --- | --- |
| YAML parse | Passed with local PyYAML 6.0.2; parsed configuration in `data/m6-render-parsed.json` |
| Render published schema | Passed using `https://render.com/schema/render.yaml.json`, Draft 2020-12 validator; `data/m6-render-schema-final.log` |
| API/worker environment contracts | Passed existing compiled `validateEnvironment`, `backgroundConfig`, Redis connection policy, shared settings, single migration owner, and rejected invalid origin/insecure cookies/HTTP queue URL; `data/m6-config-after.log` |
| Account-aware Render validation | **Blocked, HTTP 401 Unauthorized**; `data/m6-render-validation.log`. No cloud acceptance implied |
| Source/history private-file audit | Passed, no findings; final count in `data/m6-source-audit.log` |
| Whitespace check | `git diff --check` passed |
| Full backend/infrastructure/browser suites | Not rerun for this config/docs-only slice; earlier milestone results retained separately |
| Live models / cloud workflow | Not run; no quota spent on new model benchmarking |

Validation tooling: the repository's existing Ajv version could not interpret the published 2020-12 schema. Used jsonschema 4.26.0 installed only under ignored `data/m6-validation-tools`, without changing application dependencies. The initial validator-tool failure is not a service failure. Python reported unrelated ambient dependency warnings; schema validation itself then passed. The configuration contract harness uses synthetic values and does not open network services. Its ignored local harness is `data/m6-check-config.cjs`; no real secrets were printed.

## Remaining work and boundaries

- Renew Render CLI authentication before account-aware validation. Local schema success cannot confirm workspace permissions, billing or resource names.
- Obtain explicit release/deployment and paid-resource budget authorization before provisioning. Automatic Render rollouts are disabled in the template; GitHub/Vercel promotion policy must also be set in the actual accounts.
- Execute Neon TLS, extension/migration, cold-start/reconnect and pooled-runtime tests. Current profile uses direct URL with bounded pools. Separate migration/runtime privileges remain a release task.
- Verify the actual managed Redis endpoint supports the pinned clients, noeviction/INFO, scripts and blocking connections; measure idle and active command usage.
- Wire cloud worker heartbeat alerting and supervision. A heartbeat file/manual command and API readiness do not automatically monitor/restart a stale worker.
- Verify Vercel cookies/origins/forwarded headers, near-limit upload bodies, long query deadlines and downloads; measure memory, connection pools and queue delay.
- Run the cloud update/revalidation/restart/restore/rollback acceptance sequence in the deployment guide. Initial worker creation can race API migrations; the guide requires API migration/readiness before worker release/redeployment.
- Keep LIVE-001/LIVE-002 and independent evaluation/soak/security release gates open. This configuration change makes no factual-accuracy or performance improvement claim.

Next: finish remaining milestone 6 operational preparation and authorized staging acceptance. Do not mark milestone 6 or 7 complete from documentation alone.
