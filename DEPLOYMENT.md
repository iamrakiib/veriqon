# Deploy Veriqon

Use [docs/INSTALLATION.md](docs/INSTALLATION.md) for the tested local Docker stack.

Use [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the current Vercel, Render API/worker, Neon and managed Redis configuration, deployment sequence and acceptance requirements. See [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) for failures and recovery.

The existing Vercel frontend, free Render API and Neon database were updated on 24 November 2026 and passed a narrow PDF/query smoke. Full cloud lifecycle acceptance remains incomplete. The supplied Blueprint selects paid API and worker resources; that separate-worker profile is not the current free deployment. Provisioning requires an approved budget. See [release readiness](docs/RELEASE_READINESS.md) for current evidence.

The older hosted release is historical evidence only: [29 October release review](https://github.com/iamrakiib/veriqon/blob/febdf8bfced91e8e03c474015a00dc5b9a828458/docs/release-review-2026-10-29.md). It does not validate the current source or separate-worker deployment. Follow the current guide rather than the superseded single-API instructions.
