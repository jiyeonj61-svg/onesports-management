# Management repository discovery (2026-10-30)

## Verified local facts

- Source: `C:/Users/wkdwl/Documents/Codex/2026-09-28/https-onesports-management-vercel-app-admin/work/onesports-management`.
- Git remote: `https://github.com/jiyeonj61-svg/onesports-management.git`; clean `main` checkout at `dca315d` (2026-09-29), matching the locally stored `origin/main`. No fetch was performed; remote freshness remains unverified.
- No applicable AGENTS.md was found in the repository or its filesystem ancestors.
- Architecture: static HTML, browser ES modules and CSS; Supabase JS v2 dynamically imported from CDN. Vercel Node function `api/config.js` returns public configuration. No Next.js/React/framework conversion is needed.
- `package.json`: `npm run dev` runs `scripts/dev.mjs`; `npm test` runs Node test files; `npm run test:db` runs `tests/database.mjs`. DB tests use embedded PostgreSQL 17 via `tests/db-harness.mjs`, loopback port 55439, isolated `work/pg-test-*` directories.
- `vercel.json`: clean URLs; `/members/:path*` rewrite; no-store headers for `/members`, `/admin`, `/api/config`; `npm ci --omit=dev --ignore-scripts` installation.
- `config.js` has an empty Supabase URL. Runtime config is from environment names `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` (or legacy `SUPABASE_ANON_KEY`). Local files alone do not establish the runtime project; see verified live metadata below.

## Verified live metadata, 2026-10-30

The primary agent inspected Supabase metadata read-only through the authenticated dashboard SQL interface and supplied these findings. No production business rows, photographs or secret values were copied.

- Project `csacwkwasjntfkzinzfg`, display name `jangjiyeon-work-calendar`, branch main marked PRODUCTION.
- Actual core columns match the legacy operations schema, including `inspections.item_statuses`.
- Shared `calendar_tasks` is present and includes an additional `end_date` column. It must remain unchanged.
- `management-photos` is PUBLIC in live bucket metadata, confirming the repository definition.
- Live policy names are not identical to one setup file: app_admins has both `app_admins_self_read` and `onesports_app_admins_self_read`; areas includes `onesports_areas_authenticated_read` with `(active=true) OR onesports_is_admin()` and `onesports_areas_public_read` with `active=true`. Head-office delete uses `is_app_admin()`.
- Additive restrictive policies intentionally combine with all existing permissive policies, including these duplicate/renamed policies. No existing policy is removed.
- A suitable isolated nonproduction Supabase project was not identified. Other unrelated organization projects are not authorized test databases. Production SQL changes and external writes remain unexecuted.

## Existing feature preservation inventory

| Surface | Existing functionality | Principal implementation |
| --- | --- | --- |
| `/`, `#today` | Public daily AM/PM inspection grid, space/checklist/detail/photo viewing, issue/complaint statuses, head-office checks, inventory, calendar, monthly report, print/PDF, realtime updates, PWA | `index.html`, `assets/viewer.js`, `assets/common.js`, `assets/data.js`, `sw.js` |
| `/admin` | Supabase email/password login; approved app_admins check; inspection edit/delete and bulk normal; issue/complaint CRUD; head-office checks CRUD; inventories CRUD; photo uploads | `admin.html`, `assets/admin.js`, `assets/data.js` |
| `/members` | Existing-member renewal applications, fitness/golf/GX program forms, notices, private requests, accountless receipt lookup with receipt key, consent snapshots, payment reporting | `members.html`, `assets/members.js`, `assets/member-client.js`, `assets/application-documents.js` |
| Member admin in `/admin` | Member profiles, entitlement/pass management, applications/payment review, GX capacity and waitlist flows, posts, private requests, center settings, immutable forms/terms, CSV import, audits | `assets/member-admin.js`, `supabase/member-service.sql`, `supabase/guest-service.sql`, subsequent program/consent/renewal migrations |

The member service is already part of this source and must not disappear during integration even though the integration prompt does not enumerate it. Its existing handling of payments is preservation scope, not permission to add unrelated accounting.

## Legacy operations schema and authorization

- `public.app_admins(user_id, display_name, active)` references Auth users. `is_app_admin()` checks the current `auth.uid()` and active flag, and is the authority for all existing management writes and member admin RPCs.
- `areas`: bigint identity primary key, globally unique slug, name/sort/checklist/active. No site scope.
- `inspections`: UUID primary key, date, AM/PM, area_id, status, checked_items, item_statuses, note, photo_paths, manager_name, updated_by, timestamps. Unique `(inspection_date, period, area_id)`; no site scope or is_public.
- `issues`: UUID, category/area/title/description/status/priority/date/due_date/action_note/photo_paths/is_public/manager_name/completion/audit fields. is_public defaults true in legacy schema and client.
- `inventories`: UUID, record_date/area/category/name/quantity/status/note/photo_paths/is_public/manager_name/audit fields. is_public defaults true in legacy schema and client.
- `head_office_checks`: UUID, date/type, fixed `scope='all'` and `status='completed'`, title/result/follow_up/photo_paths/manager_name/audit fields. No site scope or is_public.
- Legacy operations client queries whole tables with date filters, uses select('*'), mutates by record ID, and subscribes to all row events for the four operations tables. Tenant filters do not exist.
- Operations dates are constrained from 2026-09-01. `assets/common.js:81` uses the browser local timezone for today; it does not explicitly use Asia/Seoul.
- Legacy Supabase session uses `persistSession:true`, `autoRefreshToken:true`, `detectSessionInUrl:true`; new cookie-session authentication must be implemented separately or the client deliberately adapted.
- Demo mode exists only on localhost with explicit `?demo=1`; actual config failures throw. Do not reuse LocalStorage demo authentication for integration.

## Public access and files

- SQL repository definitions grant anon public reads of active areas, all inspections after cutoff, all head-office checks after cutoff, and is_public issues/inventories after cutoff. Authenticated app_admins can read private issues/inventories and mutate operations records without site restriction.
- `management-photos` is declared a PUBLIC bucket (5 MiB; JPEG, PNG, WebP, GIF); storage read policy permits all bucket objects. `assets/data.js` stores paths `YYYY-MM/randomUUID.extension` and calls getPublicUrl. This does not provide file privacy for is_public=false records.
- Member service instead declares PRIVATE `member-service-files`, scoped storage access, and signed URLs (60 seconds). Accountless guest photos are stored in private `ms_guest_photos` with receipt-scoped checks; not the operations public bucket.
- `sw.js` excludes `/api`, `/admin`, `/members`, sensitive JS/config and authorization-bearing requests. New `/hq` and `/staff` exclusions must be added before those routes are introduced.
- Existing `/admin` member RPCs depend on `is_app_admin()`; changing that function globally to an HQ-only check would break legacy approved site administrators and possibly other shared workloads.

## Critical migration constraints

1. DO NOT execute `supabase/setup.sql` or `supabase/update-2026-09-01.sql` on the existing service: both delete records before 2026-09-01; setup also seeds global area templates and overwrites public storage settings.
2. Add migrations separately with nullable site links, validated mapping manifests, compatibility policies, then constraints. Existing area IDs and operational records must retain their original identity.
3. Do not assume all existing records belong to the first site until actual provenance is verified. Do not bulk expose new records; new integration sites must be non-public by default.
4. Existing public-photo links need a mapping/audit before moving private material. Creating a new private bucket is safer than changing visibility and breaking existing links blindly.
5. New site templates must create new area identities; inspections currently depend on area ID uniqueness and their upsert conflict key.
6. New staff role must not inherit legacy is_app_admin privileges, which include permanent deletion and member administration. A server-validated site-bound API is required.
7. Existing ms_* singleton settings and member APIs are single-center. Either retain them explicitly as legacy-center-only or tenant-scope them in a separate verified migration; never present them as cross-site capable without implementation.

## Existing verification assets

- Node UI/security tests: `admin-ui.test.mjs`, `member-ui.test.mjs`, `privacy-and-qr.test.mjs`.
- Local database checks: `database.mjs`, `backend-security.mjs`, `guest-service.mjs`, `program-forms.mjs`, `application-consent-payments.mjs`, `renewal-only.mjs`.
- DB scripts share loopback port 55439 and should run sequentially. No tests were run as part of read-only discovery.

## Unverified externally

- Current GitHub main versus this local checkout; Vercel project's actual linked repository, root directory, deployed commit and environment configuration.
- Complete live policy/role inventory, file/object inventory, Auth signing mode, backups and restored nonproduction environment. The project, presence of calendar_tasks, selected live policies, core columns, and management-photos visibility were verified as listed above.
- Existing account identities or approved HQ user ID; no user data or credentials were read.
- Production versus staging data isolation, backup/restore availability, Cloudflare bindings/API source.

Discovery did not change deployments, accounts, data or live configuration. Subsequent implementation in the new development checkout adds the migration, tests and operations guide; the source checkout at the older path remains untouched.
