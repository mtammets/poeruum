# CI checks

Every pull request and push to `main` runs lint, all unit tests, the production build and the production dependency audit.

`scripts/ci-scope.mjs` selects additional checks from the complete Git diff:

- Changes confined to the listed story, directory, horoscope or campaign views run their related browser and server tests. Database, Edge Function and payment journey checks are skipped.
- Changes confined to `README.md` and Markdown files under `docs/` run only the baseline checks.
- All other changes run the full suite, including database migrations, Edge Functions, server tests and seller/payment journeys. This includes shared code, global styles, authentication, payments, dependencies, test files and CI configuration. Removed or renamed files also select the full suite.

Mixed changes use the broader scope. Pushes compare the previous branch commit with the new head, including every commit in the push. Pull requests compare their base with the checked-out merge commit. Missing history or an unknown scope falls back to the full suite.

The full browser suite runs in four parallel shards with one worker per shard. Application, browser, database and journey checks run independently. No tests are removed from a full run.

The always-running **CI ready** job verifies that every required job succeeded and that only deliberately excluded jobs were skipped. Render remains configured to deploy only after CI passes. If branch protection is added, require **CI ready**.

To request all checks regardless of changed files, open **Actions → CI → Run workflow**. To extend a UI scope, update its exact file list and related checks in `scripts/ci-scope.mjs`; unlisted files deliberately trigger full CI.

Validate changes to the selector with `node --test scripts/test-ci-scope.mjs`.
