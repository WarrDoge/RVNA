# RVNA

RVNA (say "runa") is a self-hosted issue tracker, service desk and wiki in one web app. It is an
alternative to Jira, Jira Service Management and Confluence, and it imports from Jira and Confluence.
SvelteKit (adapter-node) is the server and the only front end. PostgreSQL 17 with Drizzle.

Jira, Jira Service Management, Confluence and Atlassian are trademarks of Atlassian. This project is
not affiliated with or endorsed by Atlassian.

Licence: Apache-2.0, see `LICENSE`. `NOTICE` lists the parts that come from Atlassian's Apache-2.0
packages.

## Requirements

- Node.js 26 — `node build` runs the SvelteKit server; server modules stay TypeScript source
- Docker with Compose, for the PostgreSQL 17 database

## Run it

```sh
cp .env.example .env      # then set DATABASE_URL, see below
npm install
docker compose up -d db
npm run dev               # one server on :6460
```

Without an OpenID Connect provider, set `DEV_LOGIN_USER=dev` in `.env` to sign in locally, or
create a local account with `npm run user:create` (see Identity).

`DATABASE_URL` is required: the server, `npm test` and `npm run e2e` all read it from `.env`.
The compose database is `postgres://rvna:rvna@127.0.0.1:55440/rvna`.

The database schema is migrated when the server starts. `npm run db:generate` creates a new
Drizzle migration in `drizzle/` after you change `src/lib/server/schema.ts`.

## Check, test, build

```sh
npm ci          # a fresh worktree starts here
npm run check   # Biome + native tsc + svelte-check
npm test        # builds if stale, then Vitest against the compose database
npm run build   # builds the server and the browser code into build/
npm run e2e     # builds if stale, then Playwright
npm start       # BODY_SIZE_LIMIT=250M node build on :3000
```

The tests run the built server: `test/server.ts` imports `build/server`. `npm test` and `npm run e2e`
rebuild when `src`, `test` or a config file is newer than `build/`. `npm run check` type-checks
`test/server.ts` as well, so it builds once when `build/` is missing and does not rebuild after that.

`node build` needs `ORIGIN` (for example `ORIGIN=http://localhost:3000`): without it the server
cannot tell its own origin, and every form sign-in answers 403 "Cross-site POST form submissions are
forbidden". `.env.example` sets it.

Playwright needs its browser once: `npx playwright install chromium`. `npm run e2e` starts its
server on `:4960`, or on `PORT` when set (set it when worktrees share a host). `npm test` needs no
port. Vite dev listens on `:6460`.

## Architecture at a glance

Six diagrams: the system and its neighbours, the layers of the code, the path of one request, the
core tables, the import from Jira and Confluence, and the way a change reaches the cluster. The
section [Architecture: SvelteKit](#architecture-sveltekit) below holds the rules behind them.

### System context

One Node.js process serves the pages and the REST API. Everything it keeps is in PostgreSQL and on
one volume for files.

```mermaid
flowchart LR
    user["Team member<br/>(browser)"]
    script["Scripts and bots<br/>(API token)"]

    subgraph cluster["Kubernetes"]
        gateway["Gateway<br/>(HTTPRoute, TLS)"]
        subgraph pod["rvna pod"]
            app["SvelteKit server<br/>node build"]
            jobs["Job workers<br/>(pg-boss: mail, GitLab events)"]
        end
        files[("Volume<br/>attachments, avatars")]
    end

    db[("PostgreSQL 17")]
    oidc["OIDC provider<br/>(optional single sign-on)"]
    gitlab["GitLab"]
    smtp["SMTP server<br/>(optional)"]

    user --> gateway
    script --> gateway
    gateway --> app
    app --> db
    app --> files
    jobs --> db
    app -- "sign-in redirect and callback" --> oidc
    gitlab -- "webhooks" --> gateway
    jobs -- "REST API" --> gitlab
    jobs -- "notification email" --> smtp
```

### Code layers

A page reads through `load`, a form posts to a form action, and the REST API is a set of thin
endpoints. All three call the same domain functions. The importer and the maintenance scripts call
those functions too, with plain `node file.ts`.

```mermaid
flowchart TB
    subgraph browser["Browser"]
        pages["Pages and components<br/>src/routes/**/+page.svelte, src/lib/components, src/lib/&lt;feature&gt;"]
    end

    subgraph kit["SvelteKit server: src/routes, src/hooks*.ts"]
        reroute["reroute<br/>old Jira and Confluence addresses"]
        guard["handle<br/>session or token, CSRF rule, forced password change"]
        load["load<br/>+page.server.ts, +layout.server.ts"]
        actions["Form actions<br/>+page.server.ts"]
        endpoints["Endpoints<br/>/api, /rest, /auth, avatars, attachments, webhooks"]
    end

    subgraph edge["Edge helpers: src/lib/server/http*.ts"]
        wrappers["pageLoad, pageAction, endpoint"]
    end

    subgraph domain["Domain modules: src/lib/server/&lt;area&gt;"]
        functions["Plain functions (actor, input) =&gt; result<br/>issues, jql, boards, wiki, servicedesk, sla, permissions, ..."]
        schema["Drizzle schema and queries<br/>schema*.ts, db.ts"]
    end

    shared["src/lib/shared<br/>code for server and browser"]
    cli["Importer and scripts<br/>src/importer, sla-rebuild, user-create, wiki-edit/convert-all"]
    db[("PostgreSQL")]

    pages -- "navigation" --> reroute
    pages -- "form post" --> reroute
    pages -- "fetch" --> reroute
    reroute --> guard
    guard --> load
    guard --> actions
    guard --> endpoints
    load --> wrappers
    actions --> wrappers
    endpoints --> wrappers
    wrappers --> functions
    functions --> schema
    schema --> db
    cli --> functions
    cli --> schema
    pages -.-> shared
    functions -.-> shared
```

### One request

The server renders the page, the browser hydrates it, and a later change goes through a form action
or an endpoint and then reloads only the data it touched.

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant B as Browser
    participant H as hooks (reroute, handle)
    participant L as load / action / endpoint
    participant D as Domain function
    participant P as PostgreSQL

    U->>B: open /browse/KEY-1
    B->>H: GET page
    H->>P: session lookup
    H->>L: locals.user is set
    L->>D: read the issue view (actor, key)
    D->>P: permission check and queries
    P-->>D: rows
    D-->>L: result, or HttpError 403 / 404
    L-->>B: server-rendered HTML with the page data
    B->>B: hydrate (the page becomes interactive)

    U->>B: change a field
    B->>H: PATCH /api/issues/KEY-1 with X-Requested-With
    H->>L: guard passed
    L->>D: update the issue (actor, key, input)
    D->>P: write in a transaction
    L-->>B: 200 JSON
    B->>H: invalidate('app:issue:KEY-1') reruns load
    H-->>B: fresh page data
```

### Core tables

The main tables of the three products and how they hang together. The database has about 100
tables; boards, workflows, permissions, dashboards, filters, SLA and the GitLab tables follow the
same pattern and are left out here.

```mermaid
erDiagram
    users ||--o{ sessions : "signs in"
    users ||--o{ api_tokens : "owns"
    users }o--o{ groups : "user_groups"

    projects ||--o{ issues : "contains"
    projects ||--o{ boards : "has"
    projects ||--o| service_desks : "may be"
    issue_types ||--o{ issues : "typed"
    statuses ||--o{ issues : "in"
    users ||--o{ issues : "reporter, assignee"
    issues ||--o{ issues : "parent, epic"
    issues ||--o{ comments : "has"
    issues ||--o{ worklogs : "has"
    issues ||--o{ attachments : "has"
    issues ||--o{ issue_history : "changes"
    issue_history ||--o{ issue_history_items : "field changes"
    issues ||--o{ issue_links : "source, target"
    boards ||--o{ sprints : "plans"
    sprints }o--o{ issues : "issue_sprints"

    service_desks ||--o{ request_types : "offers"
    request_types ||--o{ issues : "requests"
    issues ||--o{ sla_cycles : "measured"

    workflows ||--o{ workflow_transitions : "allows"
    statuses ||--o{ workflow_transitions : "from, to"

    spaces ||--o{ pages : "contains"
    pages ||--o{ pages : "parent"
    pages ||--o{ page_versions : "history"
    pages ||--o{ page_comments : "has"
    pages ||--o{ page_attachments : "has"
    pages ||--o{ page_restrictions : "view, edit"
    spaces ||--o{ space_permissions : "grants"
```

### Import and parity

The importer only reads production (GET requests, four at a time) and upserts by the source id, so
a second run updates changed rows. The parity check then compares counts, field values and
attachment hashes with the source.

```mermaid
flowchart LR
    jira["Jira and<br/>Jira Service Management"]
    confluence["Confluence"]

    subgraph importer["npm run import (src/importer)"]
        direction TB
        s1["1. jira<br/>users, projects, permissions, issues, history, attachments"]
        s2["2. jira-agile<br/>boards and sprints"]
        s3["3. jira-dashboards<br/>dashboards, gadgets, filters"]
        s4["4. confluence<br/>spaces, pages, versions, comments, permissions"]
        s1 --> s2 --> s3 --> s4
    end

    subgraph after["Maintenance scripts"]
        direction TB
        m1["5. sla:rebuild"]
        m2["6. wiki:convert"]
        m1 --> m2
    end

    db[("PostgreSQL<br/>and attachment files")]
    parity["7. npm run parity<br/>counts, fields, hashes, old URLs"]

    jira -- "GET only" --> s1
    jira -- "GET only" --> s2
    jira -- "GET only" --> s3
    confluence -- "GET only" --> s4
    importer -- "upsert by source id" --> db
    db --> after
    after --> db
    db --> parity
    jira -. "compare" .-> parity
    confluence -. "compare" .-> parity
```

### From a merge to the cluster

A merge to `main` publishes the image and the chart with one version, `0.2.N`, to GitHub's container
registry. A cluster that follows the `0.x` chart releases updates by itself. The chart is published
only after its image was built. A pull request runs the same checks and builds the image, and
publishes nothing.

```mermaid
flowchart LR
    merge["Merge to main"]

    subgraph ci["GitHub Actions"]
        direction LR
        check["check<br/>Biome, tsc, svelte-check"]
        test["test<br/>vitest"]
        e2e["e2e<br/>Playwright"]
        image["image<br/>container build"]
        chart["chart<br/>lint and package"]
        check --> test --> e2e --> image --> chart
    end

    registry[("ghcr.io<br/>image and OCI chart 0.2.N")]

    subgraph dev["Cluster"]
        direction TB
        flux["Flux HelmRelease<br/>follows 0.x"]
        start["Pod start<br/>migrations, first administrator, job queues"]
        ready["Ready<br/>/api/health"]
        flux --> start --> ready
    end

    merge --> check
    image --> registry
    chart --> registry
    registry --> flux
```

## Architecture: SvelteKit

This is the contract of the code base. The product URLs, REST API shapes, database and importer
are stable: a change to them is a change of the product, not of a screen.

- **One server.** SvelteKit 3 with `@sveltejs/adapter-node`; production is `node build`. Database
  migrations, the administrator bootstrap, SMTP, pg-boss queues and workers start in the
  `init` server hook (`src/hooks.server.ts`). `sveltekit:shutdown` closes the mail queue, the
  SMTP transport and the database pool.
- **`src/lib/server/**`** is all server code: database, schema, domain logic, integrations. Domain
  modules are framework-free: relative or `#lib/...` imports with `.ts` extensions, configuration
  only through `src/lib/server/env.ts`, no `$app/*` and no `$env/*`. The thin `http.ts` and
  `http-svelte.ts` edge helpers import SvelteKit types and `error`/`fail`; domain services do not.
  The importer and the maintenance scripts (`sla-rebuild`, `user-create`, `wiki-edit/convert-all`,
  `gitlab/backfill`) run these same modules with plain `node file.ts`, including in the production
  image.
- **`src/lib/shared/**`** is framework-free TypeScript used by both server and browser (the old
  `src/shared`), never components.
- **Components** are Svelte files. `src/lib/components/` holds the kit shared by several areas
  (Button, Modal, Icon, ...). `src/lib/<feature>/` holds a feature's components used by more than one
  route (`charts`, `editor`). A component used by one route sits next to its `+page.svelte`.
- **Styling** is a scoped `<style>` block that uses the design token variables (`var(--ds-...)`).
  `src/theme.css` defines the variables, `src/reset.css` is the base reset and `src/app.css` holds the
  global classes (`fat-menu-item`, `fat-table`, `.fat-editor-content`, ...); all three load in the root
  layout. `token("color.text")` from `#lib/tokens.ts` returns `var(--ds-text)` for an inline style.
  Use inline `style=` only for values computed at run time.

### Conventions

Domain logic is plain functions, one module per area under `src/lib/server/<area>/`:
`(actor, input) => result`. `actor` is the signed-in `CurrentUser`; functions throw
`HttpError(status, message)` for not found, forbidden and invalid input, and never see a request,
response or `RequestEvent`.

There are exactly three ways in, and all of them call those functions:

1. **`load`** in `+page.server.ts` / `+layout.server.ts` for everything a page reads, wrapped in
   `pageLoad`, with `depends('app:<thing>')`.
2. **Form actions** with `use:enhance` for flat fields a user types into a form, wrapped in
   `pageAction`.
3. **`+server.ts` endpoints** under `src/routes/api/**`, `/rest/**`, `/auth/**`, avatars,
   attachments and webhooks: the REST API contract, unchanged. The browser calls it with `fetch`
   only for structured payloads (arrays, nested objects, rich text), mutations without a submit
   (drag and drop, inline toggles, autosave, shortcuts), uploads and polling, then calls
   `invalidate('app:<thing>')`.

No remote functions and no global store for server data. Page data comes from
`load`; local UI state is `$state`.

#### One function

```ts
export async function revokeToken(actor: CurrentUser, id: string) {
	const [deleted] = await db
		.delete(apiTokens)
		.where(and(eq(apiTokens.id, id), eq(apiTokens.userId, actor.id)))
		.returning({ id: apiTokens.id });
	if (!deleted) throw new HttpError(404, "Not found");
}
```

#### One endpoint

`endpoint()` takes SvelteKit's `RequestEvent`, returns a `RequestHandler`, validates with zod and
runs the auth guard. `actor` is non-null for `auth: "user"` (the default) and `"admin"`; `params`,
`query` and `body` are non-undefined when their schema is given. Return the 200 value directly, or
`{ status, body }` for another status (`{ status: 204 }` for no body). It uses SvelteKit's normal
405 and trailing-slash handling; do not add per-route method or slash code.

```ts
export const DELETE = endpoint(
	{ params: z.object({ id: z.uuid() }) },
	async ({ actor, params, event }) => {
		if (isBearer(event.request)) {
			throw new HttpError(403, "Bearer tokens cannot manage tokens");
		}
		await revokeToken(actor, params.id);
		return { status: 204 };
	},
);
```

Invalid input answers 400 with the API's validation body (`statusCode`, `code: "FST_ERR_VALIDATION"`,
`error`, `message`), the response is parsed through its schema with unknown fields stripped, and
`HttpError` becomes `{ error: text }` with its status.

#### One load

```ts
// src/routes/projects/[key]/+page.server.ts
export const load = pageLoad(async (event, actor) => {
	event.depends("app:project");
	return { project: await getProject(actor, event.params.key) };
}) satisfies PageServerLoad;
```

`event` is the route's own typed `ServerLoadEvent` (`event.params.key` is a `string`), and the
returned object types `PageData` without casts. Write `satisfies PageServerLoad`, not
`: PageServerLoad`, or `PageData` loses its type.

`pageLoad` is the one sign-in redirect: signed out, it sends the browser to
`/login.jsp?returnTo=<current path and query>`. It also turns `HttpError` into `error(status,
message)`. Do not write a redirect or a `try`/`catch` in the page. A page that needs only a
sign-in is `export const load = pageLoad(() => ({})) satisfies PageServerLoad;`.

A page is public only when its load does not use `pageLoad` and its route id is in the explicit
`PUBLIC` list of `test/auth-default-deny.test.ts`; that list is the only place that declares one.
A data route that authenticates itself and must skip `handle` (the session lookup and the CSRF
check) is also in `selfAuthenticatedRoutes` in `src/lib/server/public-routes.ts`, with the reason.
`handle` reads only that list and the liveness routes (`livenessRouteIds`: `/api/health` and
`/api/health/live`, answered before any lookup so they work when the database is down), and the
default-deny test fails when they and `PUBLIC` disagree.
The root layout load is the one load that reads `locals.user` without requiring it.

#### One action

```ts
export const actions = {
	default: pageAction(async ({ event, form }, actor) => {
		const parsed = createSchema.safeParse({ name: form.get("name") });
		if (!parsed.success) {
			return fail(400, {
				error: parsed.error.issues[0]?.message ?? "Invalid token",
			});
		}
		return createToken(actor, parsed.data);
	}),
} satisfies Actions;
```

`pageAction` authenticates, reads the `FormData` once and passes it as `form` next to the typed
`event`, runs the write guards, and turns `HttpError` into `fail(status, { error })`; `ActionData`
includes that shape. Use `use:enhance` in the page and show `form.error`.

A page with several operations has one of two forms, and both pass the guard tests:

- Named actions (`createStatus`, `renameStatus`), one `<form action="?/createStatus">` each. This is
  the rule for new pages. The guard tests post to every action address (`?/name`, or the page
  address for `default`) with a form body and a same-origin `Origin`. `?/name` replaces the query
  string, so an action that needs the page's query state (filters, paging) gets it in a hidden field.
- One `default` action that reads an `intent` field (project settings and roles). Leave an existing
  page in this form; do not rewrite it.

A test that posts a page action sends `application/x-www-form-urlencoded` or multipart, never JSON:
SvelteKit answers a JSON body with 415 before the action runs.

#### One fetch and invalidate

For a mutation without a submit, call the REST endpoint with the header
`X-Requested-With: rvna`, then invalidate the load dependency:

```ts
await fetch(`/api/me/tokens/${id}`, {
	method: "DELETE",
	headers: { "x-requested-with": "rvna" },
});
await invalidate("app:tokens");
```

### The request guard

`handle` in `src/hooks.server.ts` is the complete guard. Only the liveness route and the
self-authenticated routes of `public-routes.ts` skip it. A request that no route answers is
answered before the session lookup when it is a data path (`/api/**`, `/rest/**`, `/auth/**`):
404 `{ "error": "Not found" }`.

- It loads the session cookie or API token into `locals.user`; an invalid token is simply no user.
- CSRF is one rule: a bearer request is never checked. A mutating request to `/api/**`, `/rest/**`
  or `/auth/**` that carries the session cookie needs an `X-Requested-With` header; the value is free, the app sends `rvna` (403
  `{ "error": "Missing X-Requested-With header" }`); without a session cookie it passes. A mutating
  request to anything else (a page form action) needs `Origin` equal to the app origin.
- Every response carries `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN` and
  `Referrer-Policy: same-origin`, and `Strict-Transport-Security` when `APP_URL` is https. A page also
  carries the Content-Security-Policy of `vite.config.ts`: scripts only from the app itself (SvelteKit
  adds a nonce to its own inline script), no plugins, no `<base>` to another site, no framing by another
  site. Stored HTML is sanitized on write; the policy is the second barrier. A new inline `<script>` or
  an HTML `on…=` attribute will not run; the browser tests fail when the policy blocks something.
- Forced password change: every request answers `403 { "error": "Password change required" }` except
  `GET /api/me` and `POST /api/me/password`; a session request to a page (unknown addresses included)
  redirects to `/secure/ViewProfile.jspa?selectedTab=password` instead, and that page runs only its
  password change while the mark is set. The gate applies to API token (bearer) requests too.
- Previous project keys and archived-project writes are applied by `endpoint()` and `pageAction()`
  automatically: they run after the body is parsed, which `handle` cannot do without consuming it.
  A mutating route is either in `writeRouteScopes` or exempt; anything else is refused, so a new
  route fails closed until it is classified. A server task never has to remember either guard.

SvelteKit's built-in CSRF check stays disabled with `csrf.trustedOrigins: ['*']`. It runs after
`handle` and cannot distinguish a page action from a token-authenticated multipart upload with no
`Origin`; the `handle` rule above is the exact replacement.

### Unknown and old addresses

An address that no route answers renders `+error.svelte`, which shows `NotFound.svelte` (status 404)
inside the shell; a data path answers the JSON 404 above. The component galleries (`/sk-*`) live in
the route group `src/routes/(gallery)/`, whose `+layout.server.ts` answers 404 unless the app runs
in development or with `NODE_ENV=test`, the value the Playwright run sets.

Old Jira addresses are handled by `reroute` (`src/hooks.ts`, one module per area in
`src/reroute/<area>.ts`) for pages that have moved (the address bar does not change) and by the
`src/lib/server/legacy.ts` logic for redirects. The profile page, `/secure/ViewProfile.jspa`, is the
worked example of a page: `pageLoad`, form actions with `use:enhance`, `depends` keys, and the forced
password change on its password tab.

### Adding a server endpoint

Every task ends with `npm run check`, `npm test` and the relevant Playwright spec.

1. Add the domain function(s) under `src/lib/server/<area>/`.
2. Add the `+server.ts` endpoint(s) with `endpoint({ params, query, body, response, auth }, handler)`;
   keep the URL, method, status codes and JSON shapes exactly.
3. Call the service; do not read `RequestEvent` in the service and do not add per-route method,
   trailing-slash or CSRF code.
4. Keep the existing tests and URLs; add a test only for new behaviour.
5. Before the commit run `git status --short --ignored -- src test | grep '^!!'`: it must print
   nothing. An ignored route file passes every test in your worktree and is missing in git.
6. A domain function returns the API shape, never raw table rows: select the named fields, so a
   column added later (`sourceId`, `importedAt`) does not reach the client. A function that takes a
   row an earlier step loaded (a page, an issue) is not a trust boundary: take the id and check
   access inside the function, whatever the caller did first.

The shared route inventory (the built SvelteKit manifest) feeds the default-deny, admin and permission
tests automatically. A new route needs no per-route edit in those tests; only a new public route must
be added to the explicit `PUBLIC` list. `test/route-pin.test.ts` pins the other direction: every
route of the old API (`test/fixtures/old-routes.txt`) must still be a route, so a route that no file
answers fails a test.

### Adding a page

1. Add `+page.server.ts` with `pageLoad` (and `depends('app:<thing>')`) and `pageAction` for each
   form, both with `satisfies`. Do not hand-write sign-in redirects or `try`/`catch`.
2. Add `+page.svelte` with `$state` for local UI state; use `use:enhance` on forms.
3. Use `fetch` + `invalidate('app:<thing>')` only for mutations without a submit, structured
   payloads, uploads and polling.
4. If the old address differs, add one entry to `reroute` in your area's `src/reroute/<area>.ts`; do not
   change the address bar and do not edit `src/hooks.ts`.
5. An administration page (`/secure/admin/**`, project administration, GitLab settings) uses
   `adminLoad` and `adminAction` instead of `pageLoad` and `pageAction`; there are no exceptions.
   They answer 403 for a signed-in user who is not an administrator. Every exported administration
   function also starts with `requireAdminActor(actor)` from `permissions.ts`: the wrapper protects
   the page, the function protects every other caller.
6. A `load` returns only what the page renders, in the same shape as the API; it never returns a raw
   row. A route with a `[key]` segment gets the previous-project-key redirect from `pageLoad`
   (302 to the same address with the current key); name the segment `[key]` to get it.

### The shell

The root `+layout.server.ts` and `+layout.svelte` render the Svelte shell (`src/lib/shell/`: top
bar, menus, quick search, notifications, shortcut help, the Create button) around every Svelte page.
`/login.jsp` and `/login` are pages with a public form action, `+error.svelte` renders the error
pages (the 403 page of an administration route included), and the profile at
`/secure/ViewProfile.jspa` holds the password, profile, token and notification screens. What a page
must know:

- The root layout returns the signed-in user (`CurrentUser`) and the site settings to every page; it
  returns nothing else. A page `load` adds only what that page renders.
- Page title: `<PageTitle title="Dashboards" />` from `#lib/components/PageTitle.svelte` emits
  `<title>{title} - {site title}</title>`. Do not add a `<title>` anywhere else.
- Sidebars: the layout only wraps the page in `<main>`, with no grid and no padding. A project or
  service-desk sidebar belongs in the page, as a flex row next to the content. The profile page is
  the reference (`padding: 24px 32px; max-width: 1120px`).
- `depends` keys: the shell uses `app:shell` (user, avatar, site, unread count) and
  `app:notifications` (polling). The profile page adds `app:profile` and `app:tokens`. A page
  uses its own `app:<thing>` and invalidates it after a mutation.
- Navigation: a link is a plain `<a href>`; programmatic navigation (a click handler, a shortcut, a
  redirect after a form) is `goto(href)` from `$app/navigation`. `window.location.assign` and
  `data-sveltekit-reload` are only for a change of session (sign-in, sign-out, a forced password
  change): the layout data holds the user, so the next page must be a full load.
- Forms: `pageAction` with `use:enhance`. The CSS reset gives `form` a 12 px top margin: add a
  scoped `form { margin: 0 }` when the form must not have it.
- The Create button and the `c` shortcut open the dialog in place (`src/lib/shell/CreateIssue.svelte`,
  see "Issue form components").
- The gallery pages (`/sk-kit`, `/sk-charts`, `/sk-jql`, `/sk-dnd`, `/sk-workflow`, `/sk-editor`,
  `/sk-sidebar`, `/sk-admin`) render inside the shell, except `/sk-kit`. Their Playwright specs pin
  the behaviour of the shared components; see "Unknown and old addresses" for who may open them.

### Shared components and helpers

Page tasks import the Svelte 5 components of `src/lib/components/` directly
(`#lib/components/Button.svelte`). The Atlaskit replacements carry scoped CSS on the `--ds-*` token
variables; `test/atlaskit-imports.test.ts` fails when `src/lib` or `src/routes` imports an
`@atlaskit/*` package other than the framework-free `@atlaskit/pragmatic-drag-and-drop`. The props
are the TypeScript props of each file.

- `Button`: `appearance` (`default`, `primary`, `subtle`, `danger`), `spacing`, `isLoading`,
  `isDisabled`, `isSelected`, `href` (renders an anchor), `type`, `onclick`, `aria-label`,
  `aria-labelledby`; other attributes pass through; slot `children`.
- `Lozenge`: `appearance` (`default`, `success`, `moved`, `new`, `removed`, `inprogress`); slot
  `children`.
- `EmptyState`: `header`, `description`; slot `primaryAction`.
- `Textfield`: `id`, `value` (bindable), `placeholder`, `type`, `min`, `autoFocus`, `isDisabled`,
  `isInvalid`, `oninput`, `onchange`.
- `Icon`: `name` (the typed `IconName`), `size`, `label`. `iconNames` in
  `icons.ts` is the complete list: the plain icons, the seven `issue-type-*` and six `priority-*`
  variants, and the `pipeline-*` and `star-filled` variants.
- `IssueTypeIcon`: `name`, `size`, `icon`, `id`, `decorative`. `PriorityIcon`: `name`, `size`, `id`.
- `Modal`: `title`, `onClose`, `width`, `returnFocus` (default `true`: focus goes back to the element
  that had it when the dialog closes; set `false` when the dialog's close moves focus on purpose);
  slots `footer`, `children`. `ConfirmDialog`: `title`,
  `message`, `confirmLabel`, `onConfirm`, `onClose`, `pending`.
- `Avatar`: `user` (`displayName`, `username`, `avatarUrl`), `size`. `ProjectAvatar`: `name`,
  `avatarUrl`, `size`. `LogoMark`: `size`.
- `UserLink`: `username`, `style`; anchor attributes pass through; slot `children`.
- `Module`: `title`, `defaultOpen`; slots `actions`, `children`. `NotFound`: no props.
- `dismiss.ts`: the attachment `{@attach dismiss(() => open, close)}`.

The framework-free helpers are plain TypeScript under `src/lib/`:

- `api.ts`: `api<T>(path, init)`, `ApiError`, `isLoginPath`. This is the JSON `fetch` wrapper for
  REST calls from a page; it sends `X-Requested-With: rvna` and sends a 401 to the sign-in
  page.
- `api-types.ts`: every API response type.
- `dates.ts`, `permission-labels.ts`, `page-title.ts`, `profile-link.ts`, `recent-projects.ts`,
  `recent-boards.ts`, `go-shortcuts.ts`: date and duration formatting, permission names, the page
  title, profile links, the recent project and board lists, and the `g` keyboard shortcuts.

`/sk-kit` renders the components in every state; `test/e2e/sk-kit.spec.ts` guards it.

### Administration kit

The route group `src/routes/(admin)/` draws the administration frame (`+layout.svelte`: the section
navigation and the content column); every administration page lives inside it. `#lib/admin/` holds
the pieces. The Administration menu of the shell and the section navigation read the one list in
`#lib/admin/navigation.ts` (`adminNavigation`, `adminMenu`). A non-administrator gets the 403 page:
`+error.svelte` of the root renders `AdminForbidden`, the one source of that markup, without the
administration frame.

- `AdminPage` (`title`, `description`, `actions`, `breadcrumb`, `children`; sets the tab title
  through `PageTitle`), `AdminNav`, `AdminForbidden`, `FormField` (`label`, `htmlFor`, `hint`,
  `error`, `required`), `ErrorText`, `Banner` (`tone`), `EmptyRow`.
- `ConfigTable` (`columns`), `RowActions` (`label`, `onEdit`, `onDelete`), `SearchField` (`value`,
  `onChange`, `placeholder`, `width`), `MoveButtons` (`index`, `count`, `onMove`, `label`),
  `DeleteDialog` (`entity`, `itemId`, `itemName`, `noun`, `candidates`, `referenceLabel`,
  `migrationHint`, `onClose`; it calls `api()` DELETE and invalidates `app:admin-config`).
- `createSortable(() => rows, (next) => ...)`: `row(index)` attachment, `moveBy`, `dragging`, `over`.
- `styles.ts` (`inputStyle`, `textareaStyle`), `config.ts` (the entity types, `errorMessage`).

Rules for an administration page task:

1. `+page.server.ts` uses `adminLoad` (and `adminAction` for its forms), no exceptions; the layout
   check is only defence in depth.
2. Do not draw the navigation or the outer frame: the group layout owns them. Wrap the content in
   `<AdminPage title="...">`.
3. Import only from `#lib/...` (`#lib/components/*` and `api()`).
4. A page that uses `DeleteDialog` calls `event.depends("app:admin-config")` in its load.
5. Sortable rows: `const sortable = createSortable(() => rows, (next) => (rows = next))`, then
   `<tr {@attach sortable.row(index)}>` with `MoveButtons` for the keyboard.
6. Raw inputs use `style={inputStyle}` or `style={textareaStyle}`; append overrides after it.
7. Keep the global classes `fat-menu-item` and `fat-table`.
8. Add no second `(admin)/+layout.svelte` or `+error.svelte`.

Each address below is a route directory under `src/routes/(admin)/` with `+page.svelte` and
`+page.server.ts` (the group is not part of the address):

- Projects: `secure/project/ViewProjects.jspa`, `plugins/servlet/project-config/[key]/workflows`.
- Issues: `secure/admin/` + `ViewIssueTypes.jspa`, `workflows/ListWorkflows.jspa`,
  `workflows/ViewWorkflowSteps.jspa` (`workflowName`, `mode`), `ViewStatuses.jspa`,
  `ViewResolutions.jspa`, `ViewPriorities.jspa`, `ViewLinkTypes!default.jspa`,
  `ViewCustomFields.jspa`, `ConfigureCustomField!default.jspa` (`id`), `ViewPermissionSchemes.jspa`,
  `ViewPermissionScheme.jspa` (`id`).
- User management: `secure/admin/user/` + `UserBrowser.jspa`, `ViewUser.jspa` (`name`),
  `GroupBrowser.jspa`, `ViewGroup.jspa` (`name`).
- System: `secure/admin/` + `ViewApplicationProperties.jspa`, `ViewGlobalPermissions.jspa`,
  `ViewAuditLog.jspa`, `ViewSystemInfo.jspa`. GitLab (`/plugins/servlet/gitlab`) is in the menu but
  not in the section navigation.

`/sk-admin` shows the frame, the entity table, the dialogs and the sortable rows;
`test/e2e/sk-admin.spec.ts` guards them.

### Project sidebar

`#lib/project/` is the sidebar of the project and service-desk screens, with its frame.
`loadProjectSidebar(actor, key)` (`src/lib/server/projects/sidebar.ts`) loads everything it shows; the
component fetches nothing.

- `ProjectSidebar` (`data: ProjectSidebarData`, `active`, `board?`), `ProjectFrame` (the same plus
  `children`: the shared two-column frame), `SidebarItem`, `ServiceDeskNav`, `BoardSwitcher`,
  `RailItem`, `SidebarGlyph` (internal).
- `ProjectSidebarData`: `project`, `boards`, `canAdminister`, `user: { isAdmin }`, `queues`,
  `portals`. A desk queue the user may not run is an empty list; a project the user may not browse
  is a 404.

Rules for a page task that uses it:

1. In `+page.server.ts`: `pageLoad` returns `{ sidebar: await loadProjectSidebar(actor,
   event.params.key) }` plus the page's own `event.depends(...)`.
2. In `+page.svelte`: `<ProjectFrame data={data.sidebar} active="..." board={...}>` or
   `ProjectSidebar`. `active` is one of `issues`, `settings`, `queues`, `board`, `backlog`,
   `reports`, `releases`.
3. Pass `board` on the board, backlog, releases and reports screens; without it the sidebar uses the
   last recent board of the project (`rvna.recentBoards`), else the first board.
4. `ProjectFrame` supplies only the outer flex and the content column; the page adds its own padding
   inside the snippet.
5. Do not fetch sidebar data in the page component and do not copy the collapse or recent-board
   logic: the sidebar owns `rvna.sidebarCollapsed`.
6. `canAdminister` (the project's `ADMINISTER_PROJECTS`) shows the settings item; `user.isAdmin`
   shows the collapsed settings rail item.
7. The frame assumes the 56 px shell top bar.

`/sk-sidebar` shows it; `test/project-sidebar.test.ts` and `test/e2e/sk-sidebar.spec.ts` guard it.

### Issue form components

`#lib/issue-form/` is the Svelte 5 issue form, the custom-field editors and the issue-meta pieces.
The dialogs fetch their own data through `api()` when they mount; do not move that into a page
`load`.

- `CreateIssueDialog` (`defaults`, `onClose`, `onCreated`), `EditIssueDialog` (`issue`, `onClose`,
  `onSaved`), `IssueFields` (`mode`, `projects`, `project`, `values`, `onChange`, `epics`, `parents`,
  `me`, `excludeKey`, `customFields`, `customFieldErrors`), `ResolutionDialog` (`transition`,
  `pending`, `onConfirm`, `onClose`).
- `FieldValueEditor` (`field`, `value`, `onChange`, `me`, `autoFocus`) with one editor per kind in
  `editors/`; `FieldValueDisplay` (`field`, `value`); `EditableCustomFieldRows` (`issue`, `me`,
  `onSaved`) for the issue view; `UserSelect`, `LabelInput`.
- `StatusLozenge`, `TypeLabel` and `PriorityLabel` for issue meta.
- Helpers: `types.ts` (`CreateDefaults`, `IssueFormValues`, `emptyValues`, `fromIssue`,
  `parseLabels`), `issue-values.ts` (`customFieldBody`, `changedCustomFieldBody`,
  `customFieldProblems`), `custom-field-values.ts`, `api.ts`.

Rules for a page task that uses them:

1. The shell renders `src/lib/shell/CreateIssue.svelte` once, in the top bar: the Create button, the
   dialog, the "Created ..." flag and the `c` shortcut (one handler, through `installShortcut`). A
   page opens the dialog with `openCreateIssue({ projectKey, typeId, parent, epic })` from
   `#lib/shell/CreateIssue.svelte`; it never mounts a second one.
2. `RichTextEditor` is controlled; send `null` when `isEditorEmpty(html)`.
3. After a successful create or edit the dialogs call `invalidateAll()`; a page needs no extra
   refresh.
4. `/secure/CreateIssue!default.jspa` is a Svelte page that opens the dialog on mount. It shows a
   short heading and no issue navigator behind the dialog.

### Issue panels

`#lib/issue/` holds the modules of the issue view that sit under the fields: `AttachmentsModule`,
`LinksModule` (with `LinkDialog`), `SubtasksModule`, `EpicIssuesModule`, `DevelopmentModule` (the
GitLab panel and its dialogs), `SlaPanel` and `ServiceDeskPanel`. `ProgressBar` and `InternalBadge`
are small helpers; `panels-types.ts` and `panels-format.ts` hold the local API types and the SLA
and error formatting.

- `loadIssuePanels(actor, key)` in `src/lib/server/issues/view-panels.ts` returns
  `{ development, request, sla }` in API shapes. It checks browse access itself and returns
  `sla: null` for a user who is not an agent, instead of failing the page on the panel's 403.
- A page passes those three values as the `data` prop of `DevelopmentModule`, `ServiceDeskPanel` and
  `SlaPanel`. Attachments, links, sub-tasks, epic children and `permissions` come from the issue
  that `getIssue` or `loadIssueView` returns.
- A module that writes (`AttachmentsModule`, `LinksModule`, `LinkDialog`) calls the API through
  `api()` and then `invalidate("app:issue:KEY")`; the page's load must `depends("app:issue:KEY")`.
  `LinkDialog` fetches `/api/link-types` when it mounts.
- "Create sub-task" calls `openCreateIssue({ projectKey, parent })`; the shell owns the dialog.

### Editor components

`#lib/editor/` is the Svelte 5 rich-text editor.

- `RichTextEditor.svelte`: `value`, `onChange`, `placeholder`, `minHeight`, `autoFocus`,
  `focusSignal`, `uploadImage`, `readOnly`, `disabled`, `onEditor`. A controlled HTML editor with
  toolbar, mentions, links, images, tables and task lists.
- `MentionList.svelte` (`users`, `active`, `pending`, `left`, `top`, `onPick`; a `role="listbox"`),
  `editor-html.ts` (`isEditorEmpty(html)`), `issue-extensions.ts` (`UnknownBlock`, `Mention`).
- `node-view.ts` (`SvelteNodeViewRenderer(Component, { as, className })`) and
  `node-view-state.svelte.ts`: the adapter that renders a Svelte component as a TipTap node view.
- `wiki/`: `extensions.ts` and `macros.ts` (the schema and the macro catalog), `MacroNodes.ts`, the macro node views and `macro.css`.

Rules for a page task that embeds the editor:

1. Bind the value yourself: `let html = $state(initial)` and
   `<RichTextEditor value={html} onChange={(next) => (html = next)} />`. It is controlled; do not use
   `bind:value`.
2. Submit through the page's form action or the REST endpoint; the editor has no submit shortcut. Use
   `isEditorEmpty(html)` to send `null` for an empty description.
3. The TipTap editor exists only in the browser (it is created in `onMount`). Never create one in
   `load` or at module scope.
4. `readOnly` and `disabled` make the content non-editable. Pass `uploadImage` only when the page has
   an upload endpoint; the image button appears only then.
5. Mentions need no wiring: the component calls `/api/users?query=` through `api()`.
6. Wiki pages build the editor from `schemaExtensions({ macro: MacroNode, inlineMacro:
   InlineMacroNode })` (`wiki/extensions.ts`, `wiki/MacroNodes.ts`) and import `wiki/macro.css`. Wiki
   content is a JSON `WikiDoc`, not HTML.
7. The root layout already loads `src/app.css` (`.fat-editor-content`, `.fat-menu-item`).
8. A macro's Edit control opens an inline parameter panel, not the wiki editor's `MacroDialog`;
   inline-macro click-to-edit and the `view-file` thumbnails are not ported.

`/sk-editor` shows the editors; `test/e2e/sk-editor.spec.ts` guards them.

### Board drag and drop

`#lib/boards/dnd/` is the drag-and-drop layer of the board and the backlog, built on
`@atlaskit/pragmatic-drag-and-drop` (framework-free, so `src/lib` may import it and `vite.config.ts`
bundles it for SSR). The layer never changes page data and never calls the API: it reports the
dragged issue keys and the page moves them.

- `BoardCard` (`issue`, `estimationField`, `cardColourStrategy`, `selected`, `onOpen`,
  `onDragStart`, `onDragEnd`, `onDropBefore(keys)`, optional `dragPreview` and the four keyboard
  callbacks `onKeyboardLift`, `onKeyboardMove(direction)`, `onKeyboardDrop`, `onKeyboardCancel`) and
  `BacklogRow` (the same, plus `dragKeys` and `onClick({ ctrlKey, shiftKey, metaKey })`).
- `DropZone` (`onDrop(keys)`, `children`, `style`, `active`, `label`, `columnId`, `statusId`,
  `kind`, `accept`, `testId`). `EpicLozenge`, `CategoryPills`, `FlagIcon`, `DropIndicator`,
  `DragPreview`.
- `index.ts` exports the helpers (`epicColour`, `estimateLabel`, `cardBackground`, `BOARD_ONLY`,
  `BACKLOG_ACCEPT`) and the attachments (`boardCardDrag`, `boardCardDropTarget`, `backlogRowDrag`,
  `backlogRowDropTarget`, `dropZone`, `keyboardDraggable`, `dropIndicatorMonitor`).

Rules for the page task that ports the board or the backlog:

1. Import from `#lib/boards/dnd/index.ts`.
2. Create the attachment objects once in `<script>` and attach with `{@attach ...}`. Pass getters
   (`getIssue: () => issue`) so reactive data is read at drag time.
3. `onDrop` and `onDropBefore` receive `string[]` issue keys. The page calls
   `api("/api/boards/.../move")` (or changes its `$state`) and invalidates.
4. Keep `testId` stable on every `DropZone`: the insertion monitor finds the target by
   `data-testid`.
5. Pass all four keyboard callbacks to enable the keyboard path (Space lifts and drops, arrows
   move, Enter drops, Escape cancels). Without `onKeyboardLift` the native button keys stay.
6. `dragPreview` is optional; without it the browser draws the drag image.
7. Do not call `claimDrop` yourself: the drop targets already ignore a nested duplicate drop within
   150 ms.

`/sk-dnd` shows the board and the backlog; `test/e2e/sk-dnd.spec.ts` guards it. The real boards are `/boards/<id>/work`, `plan`, `reports` and `releases`.

### Workflow diagram

`#lib/workflow/WorkflowDiagram.svelte` draws a workflow (pan, wheel zoom, fit, hover highlight, the
initial-status marker, the Any-status node, a legend). The workflow types live in
`#lib/workflow/types.ts`.

- `WorkflowDiagram`: `detail` (`statuses`, `transitions`, `initialStatusId` of a `WorkflowDetail`),
  optional `selectedStatusId`, `selectedTransitionId`, `onSelectStatus(id)`, `onSelectTransition(id)`.
- `diagram.ts`: `layoutWorkflow(detail)`, `bezierPoint`, `nodeWidth` and the layout constants.
  `gallery.ts` is invented fixture data for the gallery only.

Rules for a page task that uses it:

1. Import from `#lib/workflow/WorkflowDiagram.svelte`. The component is SSR-safe:
   do not gate it behind `browser` or `onMount`.
2. For a read-only diagram pass only `detail`. For selection pass the `selected*Id` props and the
   callbacks, and clear the other selection in the callback. `__any__` is the id of the Any-status
   node. A click selects only when the pointer moved at most 4 px; a drag pans.
3. Selection is visual only (no persistence, no local-storage key) and has no keyboard path; add
   external controls where a page needs one.
4. Put it in a block layout: the frame height is `max(420px, calc(100vh - 300px))`.

`/sk-workflow` shows the diagram; `test/workflow-diagram.test.ts` and `test/e2e/sk-workflow.spec.ts`
guard it.

### JQL components

`#lib/jql/` holds the search input and the basic-mode form of the issue navigator. They use only
`api()`; the suggestion requests keep the original 120 ms debounce, cancellation and limits.

- `JqlInput`: `value`, `customFields` (`CustomFieldColumn[]`), `placeholder`, `rejected`;
  `onChange(value)`, `onSubmit()`.
- `BasicMode`: `query` (`BasicQuery`), `projects` (`ProjectSummary[]`); `onChange(query)`,
  `onRun(query)`.
- `context.ts`: `jqlContext`, `jqlErrorText`, the suggestion helpers and `OPERATORS`. `suggest.ts`:
  `suggestJqlValues(field, prefix, limit)`. `Picker`, `RangePicker`, `MoreMenu` and
  `ExtraCriterion` are internal to `BasicMode`.

Rules for a page task that uses them:

1. `JqlInput` is controlled: keep `value` in page state, update it in `onChange`, run the search from
   `onSubmit`. Pass `customFields` from `/api/fields` and set `rejected` when the server refused the
   query.
2. Validate with `jqlErrorText(jql)` before submitting; show the message in a `role="alert"` element
   and clear it on a successful submit.
3. `BasicMode` builds no JQL: use `basicToJql(query, orderBy)` and keep `orderBy` from the parsed
   applied query. Advanced to Basic: switch only when `jqlToBasic(parseJql(jql))` is `ok`, otherwise
   disable the Basic control. Basic to Advanced: keep the JQL already built from the basic choices.
4. `BasicMode` reads `query` once, at mount. Remount it when the applied query changes
   (`{#key appliedJql}`).
5. Pass `projects` from `GET /api/projects`; the component fetches type, status, assignee and extra
   values itself through `/api/jql/suggest`.
6. Keep the suggestion list `role="listbox"`, the options `role="option"` with `fat-menu-item`, and
   the aria labels. These components use no local-storage keys.
7. The page owns the Basic/Advanced switch and the server-error text; neither component contains
   the other or the switch.

`/sk-jql` shows both; `test/e2e/sk-jql.spec.ts` guards them.

### Wiki editor pages

`#lib/wiki/editor/` is the page editor and the page operations: `EditorPage` (create, edit, resume a
draft), `CopyPageForm`, `MovePageScreen`, remove, trash and space creation. `editor-page-data.ts` in
`src/lib/server/wiki-edit/` builds the data the screens load (`editorPageData`,
`draftEditorPageData`).

1. A route page that renders one of these screens wraps it in `{#key page.id}`. SvelteKit keeps the
   page component when only the query changes, and the screens copy their props into state once on
   purpose (`untrack(() => ...)`).
2. A `load` never writes. SvelteKit runs a `load` when a link is hovered or tapped
   (`data-sveltekit-preload-data="hover"` on `<body>`), so a draft created there would exist for a
   page nobody opened. `/pages/createpage.action` loads only its query; the page submits its own
   form action once it is mounted, and that action creates or reuses the draft.
   `test/e2e/wiki-editor-preload.spec.ts` guards it.
3. `export const actions` stays in `+page.server.ts`, never `export { actions }`. The route
   inventory reads the actions from the built routes, so any spelling is seen, and a test proves it.

### Traps found

- `BODY_SIZE_LIMIT` defaults to 512K in adapter-node. The Helm chart sets both
  `MAX_UPLOAD_REQUEST_MB` and `BODY_SIZE_LIMIT` from one value (default `250M`); Docker, Compose,
  `npm start` and Playwright do the same.
- Behind the Gateway set `ORIGIN` to `APP_URL`; with `trustProxy: true` the Helm chart also sets
  `PROTOCOL_HEADER=x-forwarded-proto`, `HOST_HEADER=x-forwarded-host`,
  `ADDRESS_HEADER=x-forwarded-for`, `XFF_DEPTH=1`. With `ADDRESS_HEADER` set, a request without that header
  that needs the client address (sign-in) is a 500: reach the pod only through the Gateway.
- Absolute addresses built by moved routes (the Jira `self` links, redirects of old addresses) come from
  `event.url.origin`. They are right only when `ORIGIN` or the forwarded headers are set, as the Helm
  chart does.
- Theme CSS is a generated asset, `src/theme.css`, imported by the root layout and cached by the
  browser. `app.html` carries the dark `data-color-mode`/`data-theme` attributes, so the first
  paint has the right tokens and `token()` works during SSR.
- Tests import the built `Server` class from `build/server` and send a `Request` in-process. Server
  modules are externalized (`#lib/server`) so Node, Vite and Vitest share one copy: the in-memory
  mail transport, queues and `vi.mock` in `test/gitlab-webhook.test.ts` see the same module as the
  request. `test/server.ts` supplies `inject` and `close` for them.
- TypeScript: SvelteKit 3 needs TypeScript 6 and `svelte-check` 4.7.8 declares `^5 || ^6`. The
  repo keeps TypeScript 7 native as `typescript-native` for `tsc`, and installs `typescript@6` for
  SvelteKit and `svelte-check`. `npm run check` runs Biome, native `tsc`, then `svelte-check`.
  Biome checks `.ts`; `.svelte` is excluded from Biome and checked by `svelte-check`.
- In `npm run dev` SvelteKit runs on `:6460` with hot reload; editing a file under
  `src/lib/server` triggers Vite's SSR page reload and the next request uses the new code.

## Identity

RVNA has two ways to sign in, and either works alone: native local accounts with a password,
and single sign-on through an OpenID Connect provider (for example Authentik). Local accounts
exist so an administrator can still log in when the provider is down. SSO is optional: the server
starts with no `OIDC_*` values and shows only the username and password form.

### Local accounts

The login page is `/login.jsp` (`/login` works too). Unauthenticated visits are redirected there with
`?returnTo=`. Users type their username or their email address and a password. Passwords are hashed
with Argon2id (a per-user salt, the parameters stored inside the hash; hashes are upgraded at the next
login when the parameters are raised in `src/lib/server/passwords.ts`). A password needs at least 12
characters; there are no composition rules, but it must not be the username or a very common password.

Administrators create accounts, set and reset passwords on the Users administration screen. A password
set by an administrator ends that user's sessions and removes their API tokens. A user can change their
own password on the profile page (`?selectedTab=password`); that signs every other session out and
removes their API tokens as well. A user marked "must change password" sees only a "Change your
password" screen until they choose a new one; every data request except `GET /api/me`,
`POST /api/me/password` and logout answers `403 Password change required` meanwhile, every other
page request redirects to that screen, and its other actions answer the same 403. The gate applies
to API tokens (bearer) too: they get that 403 for every request but the two API exceptions.

An account that only signs in with SSO has no password. A local account is never taken over by SSO:
an IdP user whose username matches an account with a local password is refused (`403`, ask an
administrator to link it) unless that account was imported from Jira and the IdP vouches for the same
email (`email_verified`). Accounts without a password attach by username or verified email as before.

### The first administrator

Either create one on the command line (runs the migrations first, reads the password from stdin or
asks for it twice without echo, never from an argument):

```sh
npm run user:create -- --username admin --admin --name "Admin" --email admin@example.com
printf '%s\n' "$PASSWORD" | npm run user:create -- --username admin --admin --password-stdin
```

`--must-change` forces a new password at the next login. Running it again for an existing username
sets a new password (and, with `--admin`, makes the account a local administrator).

Or set `BOOTSTRAP_ADMIN_USERNAME` and `BOOTSTRAP_ADMIN_PASSWORD` for the first start: when no
administrator exists yet, the server creates that account with "must change password" set and logs
`bootstrap administrator created: <username>`. When an administrator already exists it does nothing.
Remove the password from the environment afterwards.

### Lockout

Failed logins are counted per account and client IP pair (an identifier that matches no account uses
its normalised text), and per client IP, in the database.
From 5 failures for a username from one address the next attempt from that address must wait 2, 4,
8, 16, then 32 seconds; at 10 failures that pair is locked for 15 minutes, while a correct password
from another address still works. The IP counter has five times the thresholds (25 and 50), so an
office behind one NAT does not lock itself out. A delayed or locked request is answered `429` with
`Retry-After` and the password is not checked. A successful login clears only that account's counter
at that address; the address counter is never cleared by a success and forgets its failures after
15 minutes without a new failure. An expired lock or an hour without failures resets a name counter.
Wrong, unknown, inactive and password-less accounts all give the same `401` answer. Known limit: an
attacker with many addresses gets ten guesses per address for a name; the password rules carry that.
Logins, failures and lockouts are written to the audit log. Behind a reverse proxy set
`ADDRESS_HEADER=x-forwarded-for` and `XFF_DEPTH=1` (the Helm chart does when `trustProxy` is on):
the client IP is then the address the proxy appended, which a client cannot forge. Without them
every user shares the proxy's address. The application never parses forwarding headers itself; it
asks SvelteKit for `event.getClientAddress()`.

### Single sign-on

Register a confidential client with the redirect URI `<APP_URL>/auth/callback` and set `OIDC_ISSUER`,
`OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET` together. The login page then also shows "Log in with SSO".
The app's permissions work without SSO: local users, in-app administrators, in-app groups, project roles
and permission schemes. SSO groups are an additional source. A user's effective groups are the claim
groups of the last login (the `groups` claim), the groups imported from Jira and Confluence, and the
memberships an administrator added in the app (source `local`); every permission decision reads that one
union. Each SSO login that carries the groups claim replaces only the user's claim memberships; a token
without the claim leaves them as they are. Imported and local memberships stay, and a claim that names a
local group does not join it. A user is an administrator when an administrator marked the account as a
local administrator, when an effective membership is `ADMIN_GROUP`, or when the user or one of the user's
effective groups holds the imported global ADMINISTER permission.

Set `SSO_AUTO_REDIRECT=true` to send `/login.jsp` straight to SSO. `/login.jsp?local=1` always shows the
local form, so a bookmark to it is the way in when the provider is down.

The first SSO login links the provider subject to an existing user with the same username (ignoring
case) or, when the provider says the email is verified, the same email, subject to the rules above. A
user with neither match gets a new account.

The username match trusts the provider: a person who can choose their own username at the provider
can attach to an imported account that nobody has signed in to yet. Keep self-service username change
and open sign-up off at the provider. Each attach writes an `account.link` entry to the audit log.

For local work without a provider set `DEV_LOGIN_USER`; `GET /auth/login` then signs that username in
as an administrator, and `/login.jsp` redirects there unless `?local=1`. The server refuses to start
with `DEV_LOGIN_USER` when `NODE_ENV=production`.

## Environment variables

| Variable                   | Purpose                                                              |
| -------------------------- | -------------------------------------------------------------------- |
| `DATABASE_URL`             | PostgreSQL connection string, required                               |
| `PORT`                     | HTTP port of `node build`, defaults to 3000                          |
| `NODE_ENV`                 | `development`, `test` or `production`                                |
| `APP_URL`                  | Public base URL, defaults to `http://localhost:3000`                 |
| `ORIGIN`                   | Public origin for adapter-node/CSRF; set it for every `node build`   |
| `BODY_SIZE_LIMIT`          | adapter-node body limit; set to `MAX_UPLOAD_REQUEST_MB` + `M`        |
| `MAX_UPLOAD_REQUEST_MB`    | Upload cap in MB, default 250; keep the two values equal             |
| `MAX_ATTACHMENT_MB`        | Largest single attachment in MB, default 100                         |
| `OIDC_ISSUER`              | OpenID Connect issuer URL                                            |
| `OIDC_CLIENT_ID`           | OpenID Connect client ID                                             |
| `OIDC_CLIENT_SECRET`       | OpenID Connect client secret                                         |
| `OIDC_SCOPES`              | Requested scopes, defaults to `openid profile email`                 |
| `OIDC_GROUPS_CLAIM`        | Claim holding group names, defaults to `groups`                      |
| `ADMIN_GROUP`              | Group whose members are administrators, default `rvna-admins`        |
| `SESSION_TTL_DAYS`         | Session lifetime in days, defaults to 14                             |
| `APP_TIME_ZONE`            | IANA time zone for dates when the browser sends none, default UTC    |
| `DEV_LOGIN_USER`           | Username to sign in without a provider, development only             |
| `JIRA_URL`                 | Jira base URL, used by the importer                                  |
| `JIRA_PAT`                 | Jira personal access token, sent as a bearer token                   |
| `ATTACHMENTS_DIR`          | Attachment storage, defaults to `./data/attachments`                 |
| `AVATARS_DIR`              | Avatar images, defaults to `./data/avatars`                          |
| `SMTP_URL`                 | SMTP server URL for notification email, unset disables email         |
| `MAIL_FROM`                | From address, defaults to `rvna <rvna@localhost>`                    |
| `MAIL_REDIRECT_TO`         | Send every message to this address, for non-production instances     |
| `SECRETS_KEY`              | Key for secrets at rest (GitLab webhook secret and access token)     |
| `SSO_AUTO_REDIRECT`        | `true` sends the login page to SSO unless `?local=1`, default false  |
| `BOOTSTRAP_ADMIN_USERNAME` | First administrator, created only while none exists                  |
| `BOOTSTRAP_ADMIN_PASSWORD` | Its initial password; it must be changed at the first login          |
| `ADDRESS_HEADER`           | adapter-node: header with the client address, e.g. `x-forwarded-for` |
| `XFF_DEPTH`                | adapter-node: trusted proxies in front of the server, e.g. `1`       |
| `PROTOCOL_HEADER`          | adapter-node: header with the protocol, e.g. `x-forwarded-proto`     |
| `HOST_HEADER`              | adapter-node: header with the host, e.g. `x-forwarded-host`          |
| `SHUTDOWN_TIMEOUT`         | adapter-node: seconds to wait for requests on shutdown, default 30   |
| `APP_VERSION`              | Version shown on the System info page, optional                      |
| `CONFLUENCE_URL`           | Confluence base URL, not read yet                                    |
| `CONFLUENCE_PAT`           | Confluence personal access token, not read yet                       |

The server reads `.env` when it exists (`npm start` passes it to `node build`); Vitest does the same. The three `OIDC_*` values are optional
but must be set together; with none of them only local accounts can sign in. The bootstrap pair must
also be set together. The importer reads the Jira variables; Confluence is not read yet.

## Administration

Administrators (`is_admin`) see the Administration gear in the top bar. The screens live under
`/secure/admin/...` and `/secure/project/ViewProjects.jspa`, like Jira's: projects (create from a template,
archive, delete, key changes keep the old key working), issue types, workflows (text and diagram view,
draft then publish, status mapping), statuses, resolutions, priorities, issue linking, custom fields,
users, groups (SSO groups are read-only, local groups are managed by hand), general configuration, the
audit log and system info. Every route is `/api/admin/...` behind one shared guard (401 for anonymous, 403
JSON for non-admins; the page URLs answer 403 too). Every admin action writes an `audit_log` row.

## Notifications

Issues notify their reporter, assignee, watchers and mentioned users. The bell in the top bar polls
every 60 seconds and on window focus; opening a notification marks it read. Creating, commenting on
or being assigned an issue makes you a watcher, unless autowatch is turned off on
`/secure/ViewProfile.jspa?selectedTab=notifications`, which also holds the email switch, the
"notify me of my own changes" switch and the HTML or plain-text email format.

With `SMTP_URL` set, the same events also go out by email through `pg-boss`: the job lives in
Postgres, retries with backoff, and batches events on one issue for one recipient within 60 seconds
into a single message. Without `SMTP_URL` the server logs that email is disabled and sends nothing.
`MAIL_FROM` defaults to `rvna <rvna@localhost>`. `MAIL_REDIRECT_TO` is the safety
switch for a non-production instance that holds real addresses: when set, every message goes only
to that address, the original recipients are named in the first line of the body and in the
`X-Original-To` header, and no real recipient is contacted.

## Import from Jira

The importer copies users, project metadata, issues, comments, worklogs, watchers, links,
attachments and history from Jira Server into the database. It only sends GET requests, retries
429 and 5xx responses, and keeps four requests in flight. Every imported table is upserted by
Jira's id, so running it again updates changed rows and leaves the rest untouched.

The importer sends the access token only to the origin of `JIRA_URL` (or `CONFLUENCE_URL`): an
attachment address on another host stops the import with an error. Set the URL to the address the
server itself uses in its links. An id from the server is used as a file name only when it holds
letters, digits, `_` and `-`.

Workflow transitions keep their screen: the importer reads the tabs and fields of every distinct
transition screen once and sets `asks_resolution` when the screen contains the `resolution` field.
The other screen fields, such as assignee and linked issues, are not imported.

```sh
npm run import -- jira
npm run import -- jira --project DEMO --project WEB
npm run import -- jira --skip-attachments
npm run import -- jira --overwrite-local
npm run import -- jira --private-apis
npm run import -- jira-permissions
```

### Non-public Atlassian APIs

Some optional parts of the import read Atlassian REST resources that are not documented as
public APIs: the agile board configuration and closed-sprint reports (`/rest/greenhopper/1.0`),
the service desk settings and SLA metrics (`/rest/servicedesk/1`), SLA calendars
(`/rest/workinghours/1`), automation rules (`/rest/cb-automation/latest`), dashboards
(`/rest/dashboards/1.0`), the workflow layout (`/rest/workflowDesigner/1.0`), and Confluence
watchers (`/json/listwatchers.action`) and page likes (`/rest/likes/1.0`). These are not public
APIs. Your agreement with Atlassian may restrict their use; turn them on at your own
responsibility.

`/rest/experimental/content/{id}/version` (page and attachment version history) is used without the
flag because Atlassian documents it, marked experimental.

They only run with `--private-apis`. Without it the importer does not send those requests, prints
one line for each skipped part, and leaves the rows an earlier run imported untouched. With the flag
the importer behaves as before.

A re-import never overwrites, moves or deletes a record that was changed in RVNA. Issues,
comments and work logs carry a `locally_changed_at` marker that the database sets on an
application update; the import skips a marked issue completely (fields, comments, work logs,
links, rank, sprint membership, epic and parent), lists it as `kept local changes` with its id, and
never deletes rows created in the application (they have a `local:` source id).
`--overwrite-local` is the deliberate reset: it overwrites marked rows and clears the marker.
A new comment or file does not mark its issue; a changed field does (a work log too, as it changes
the time totals), and so does an edit or removal of something that came from Jira. Migration `0024` marks what a database already held
before the marker existed: pages with a local version and issues with local history.
Not protected yet: boards and their configuration, sprints, dashboards, filters and shares, spaces,
projects, components, versions, service desk settings and avatars follow the source on every
import, and an issue or page deleted in RVNA returns on the next import.

It needs `DATABASE_URL`, `JIRA_URL` and `JIRA_PAT`; attachments go to `ATTACHMENTS_DIR`
(`./data/attachments` by default), stored under their sha256 and skipped when already present.
The command prints per-table inserted, updated and unchanged counts. Jira's search endpoint returns
issue timestamps with second precision, so `issues.created`, `updated` and `resolved` keep exactly
what Jira sends; comments, worklogs and history are read from the issue sub-resources and keep their
milliseconds. The importer does not truncate dates. The `jira` import runs the
permissions step after users and projects; `jira-permissions` imports only groups, project roles,
permission schemes and global ADMINISTER holders. Jira has no REST call for the holders of its global
permissions, so the global ADMINISTER holders are the users Jira's permission search reports.

Confluence group memberships come with the `confluence` import, or alone:

```sh
npm run import -- confluence-groups
```

Only the groups that space permissions or page restrictions name are fetched (`GET /rest/api/group` and
`GET /rest/api/group/{name}/member`); their members are stored with the source `confluence`.

Service desk projects are imported too: the desk and portal text, request type groups, request
types and their customer fields, queues with Jira's reported issue counts, SLA metrics, goals and
calendars, and automation rules. For every request the importer also reads the SLA cycles Jira
reports and the request channel. The service desk settings, SLA metrics, calendars and automation
rules need `--private-apis`; the rest imports without it.

Built-in issue type and priority icons are Atlassian artwork and are never copied: RVNA draws its
own icon from the type or priority name. A custom icon uploaded by an administrator is imported.
A re-import removes a built-in icon that an earlier version stored.

## Import from Confluence

```sh
npm run import -- confluence
npm run import -- confluence --space KEY --space OTHER
npm run import -- confluence --overwrite-local
npm run import -- confluence --private-apis
```

Page and space watchers and page likes come from non-public APIs and are imported only with
`--private-apis`; see the warning under "Import from Jira". Without the flag neither request is
sent and rows an earlier run imported stay unchanged.

The import copies spaces, pages, blog posts, versions, comments, attachments, labels and page
restrictions; with `--private-apis` it also copies page and space watchers and page likes, then runs
the Confluence group step.
A page with a local version, a local move, rename or restore, or locally changed labels or
restrictions keeps its current content, title, parent, position, version number, labels and
restrictions. New Confluence versions are still added as history when their number is free, but
never become the current content. `--overwrite-local` resets a page to the Confluence state. The
command prints per-table counts, one line with the number of space permission entries it skipped per
`targetType:operationKey`, and one line with the watcher and like users it could not resolve.

With `--private-apis`, watchers cost one GET request per content item:
`GET /json/listwatchers.action?pageId=` returns both the page and the space watchers. One more
request, `GET /rest/likes/1.0/content/<id>/likes`, returns the likes. The space watcher list repeats
on every page; the importer stores each space watcher once.
Rows imported from Confluence carry a `confluence:` source id, so a re-import removes the ones that
are gone in Confluence and leaves rows added in the application alone. A watcher or like whose user
is not in the local directory is skipped and counted.

Confluence splits a space permission into a target type and an operation; the app has one flat
permission set. The import maps them like this:

| Confluence permission | App permission |
| --------------------- | -------------- |
| `space:read`          | `read`         |
| `space:delete_own`    | `delete_own`   |
| `space:restrict`      | `restrict`     |
| `space:export`        | `export`       |
| `space:delete_mail`   | `delete_mail`  |
| `space:administer`    | `administer`   |
| `page:create`         | `create`       |
| `page:delete`         | `delete`       |

The `blogpost:*`, `comment:*` and `attachment:*` create and delete entries are not imported: the app
has no separate right for them. A page editor creates comments and attachments, and deleting someone
else's comment or attachment needs the space's `delete` permission. A user who holds only
`comment:create` in Confluence gets nothing in the app: no page edit and no separate comment right.
The other Confluence target types have no app permission and are skipped and counted in that line.

A re-import removes the space permission rows it imported earlier when the source no longer has the
entry, including rows the old flattened mapping created. Rows an administrator added in the app
(`fat:` source ids) are never deleted.

## Dashboards, gadgets and saved filters

Dashboards come from their own step, because Jira serves them from the dashboard API rather than
from the issue import:

```sh
npm run import -- jira-dashboards --private-apis
```

It reads `/rest/api/2/dashboard` and `/rest/dashboards/1.0/{id}` (`/rest/api/2/dashboard/{id}/gadget`
does not exist on Jira 11.3), maps every gadget and its preferences, and imports the saved filters
the gadgets use together with the ones Jira lists as favourites or on the Manage Filters pages.
Jira does not report who owns a dashboard or who it is shared with, so an imported dashboard is
shared and owned by the Jira user the token belongs to. The step is idempotent like the others.

## Jira URLs

Bookmarks and scripts that point at Jira keep working: `/browse/KEY-1`, `/browse/KEY`,
`/projects/KEY/summary`, `/projects/KEY/issues/KEY-1`, `/issues/?jql=`, `/issues/?filter=<id>`,
`/secure/IssueNavigator.jspa`, `/secure/QuickSearch.jspa`, `/secure/ViewProfile.jspa?name=`,
`/secure/attachment/<id>/<file>`, `/secure/CreateIssue!default.jspa`, `/secure/ManageFilters.jspa`,
`/secure/BrowseProjects.jspa`, `/secure/Dashboard.jspa`, `/secure/ConfigurePortalPages!default.jspa`,
`/plugins/servlet/project-config/KEY/summary`, `/login.jsp` and `/secure/Logout!default.jspa`.
`src/lib/server/legacy.ts` holds that table. The read-only `/rest/api/2/issue/KEY` and
`/rest/api/2/search?jql=` endpoints answer Jira's JSON shape for scripts; they authenticate with an
RVNA API token as a bearer token, which the profile page creates.

## SLA

`src/lib/shared/sla` holds the pure working-time and cycle engine: working minutes over a calendar with
timezones, holidays and daylight saving, and cycles from an issue's history and comments. The
server builds those events and writes `sla_cycles`; it is computed state, so rebuild it after an
import or whenever history, comments or SLA configuration change:

```sh
npm run sla:rebuild
```

It recomputes every service desk issue and prints the number of issues and cycles.

## Import boards and sprints

The Jira import keeps each issue's Sprint value. Parse it into boards and sprints without
contacting Jira:

```sh
npm run import -- jira-agile-local
npm run import -- jira-agile --private-apis
```

It creates one board per distinct `rapidViewId` found in the Sprint values, with columns derived from the
project's workflow status categories, and marks those boards `config_imported = false`. A later
board import overwrites them by `source_id`, which is the Jira rapid view id. The remote board
import reads its board configuration and closed-sprint reports from a non-public API, so it runs
only with `--private-apis`; see the warning under "Import from Jira".

## GitLab

The GitLab integration shows branches, commits, merge requests and pipelines on an issue's
Development panel, and can turn GitLab activity into issue changes.

An administrator configures it at `/plugins/servlet/gitlab`, reachable from the Administration
gear. The page generates the webhook secret (shown once) and stores it, together with an optional
access token, encrypted with AES-256-GCM under `SECRETS_KEY`. Without `SECRETS_KEY` the page still
loads, but secrets cannot be saved. The token is used for back-fill and link unfurling and is never
returned by the API.

Create a webhook in GitLab with these settings:

- URL: `<APP_URL>/api/integrations/gitlab/webhook`
- Secret token: the value generated on the configuration page
- Triggers: Push events, Tag push events, Merge request events, Pipeline events, Comments
- SSL verification: on

The webhook authenticates only with `X-Gitlab-Token`, answers 202 and processes the delivery in a
`pg-boss` job, so GitLab's 10 second timeout is never at risk. Deliveries are idempotent on
`Idempotency-Key` (or `X-Gitlab-Event-UUID`). Project settings decide which repositories are linked,
which one is the default for "Create branch", and whether smart commits and merge request triggers
are on.

```sh
npm run gitlab:backfill -- --project group/project [--days 90]
```

The back-fill command reads the project, branches, the last 90 days of commits and merge requests
through GitLab's REST API with the saved token. It only links issues; smart commits and triggers are
left to live webhook deliveries.

## Messenger

One Matrix bot connects the team's chat to RVNA. An administrator configures it at
`/plugins/servlet/messenger`, next to the GitLab integration: the homeserver URL, the bot's access
token (stored encrypted under `SECRETS_KEY` and never returned), the service desk and request type
chat requests use, and whether the worker is enabled. The homeserver URL must use HTTPS; plain HTTP
is accepted only for a loopback address, where the token cannot leave the machine. "Test connection" calls `whoami` and shows the
bot's Matrix id. Changes are written to the audit log without the token.

Messenger is off after an install. No homeserver address and no token come from the environment or
the chart. The worker makes no network request until an administrator saves an address and a token
and enables it.

People invite the bot to a room or start an unencrypted direct chat and send:

- `!ticket <summary>` — opens a request. The first line is the summary, further lines become the
  description. The answer is a threaded reply with the key and the portal link.
- `!status KEY-123` — status, assignee and link, when the sender may see the request.
- `!link CODE` — connects the Matrix id to the RVNA account that generated the one-time code
  under "Messenger" on `/secure/ViewProfile.jspa`.
- `!help` — the command list.

A Matrix id `@name:server` is the active RVNA user `name` when `server` is the bot's server;
a linked id on the profile wins over that rule. The rule trusts the homeserver, so use it only
when strangers cannot register Matrix names there; otherwise people connect with `!link`. Five wrong
`!link` codes lock one sender for ten minutes. Requests created in chat carry the `chat` request
channel, use the same portal creation path (required fields, SLA, notifications, history and
permissions), and are limited to five per sender in ten minutes. The bot cannot read encrypted
rooms; it says so once per room. When a request's status changes or an agent adds a public comment,
the bot posts a short notice into the request's thread. A reply in that thread becomes a public
comment by the sender and gets a check-mark reaction. Files must be attached in the portal. A
message is handled at most once: if creating the request or the comment fails, the bot says so in
the thread, asks the sender to send it again, and shows the error as "Last error" on the admin page.

**Stop the old external `@ticket-bot` before enabling this worker on the same bot account.** Two
readers of one Matrix account both answer: the external bot would create its Jira request while
RVNA creates its own.

## Wiki documents

Wiki pages are edited as a ProseMirror document (`body_doc`); `src/lib/shared/wiki` converts it to
and from Confluence storage format (`body_storage`) and to the display HTML (`body_html`).
Pages and versions imported from Confluence have no document until you convert them:

```sh
npm run wiki:convert
```

It fills `body_doc` for every page and version that has storage format, and prints the number
converted plus the names (never the content) of any element or macro it does not know.

## Container

```sh
docker compose --profile app up -d --build   # app on :3000, talks to the db service
```

Attachments and avatars live on the named `app-data` volume at `/data/attachments` and
`/data/avatars`, so recreating the container keeps them.

## Deploying

`chart/` is a Helm chart for Kubernetes. CI publishes the image to `ghcr.io/warrdoge/rvna` and the
chart to `oci://ghcr.io/warrdoge/charts/rvna`, both with the same version:

```sh
helm install rvna oci://ghcr.io/warrdoge/charts/rvna --version <version> --values values.yaml
```

The chart expects two Secrets in the release namespace and a Gateway to attach the `HTTPRoute` to:

```sh
kubectl create secret generic rvna-database --from-literal=url=postgres://...
kubectl create secret generic rvna-oidc --from-literal=client-secret=...
```

The OIDC secret is only needed with single sign-on. Without `oidc.issuer` the chart renders no OIDC
variables and only local accounts can sign in. To create the first administrator, make a Secret and name
it in `bootstrapAdmin.existingSecret` (the values file never holds the password):

```sh
kubectl create secret generic rvna-bootstrap --from-literal=username=admin --from-literal=password=...
```

The chart reads `DATABASE_URL` from `rvna-database`/`url`, `OIDC_CLIENT_SECRET` from
`rvna-oidc`/`client-secret` and optionally `SECRETS_KEY` from
`secretsKey.existingSecret`/`secretsKey.secretKey` (default key `secrets-key`); `database.secretKey`
and `oidc.secretKey` change the other keys. Notification email is off until `mail.existingSecret`
names a Secret with the SMTP URL (default key `smtp-url`); `mail.from` sets `MAIL_FROM` and
`mail.redirectTo` sets the non-production safety switch. Nothing under `mail` renders while
`mail.existingSecret` is empty. The chart renders no ConfigMap or Secret of its own, so it adds no
`checksum/...` pod annotation: changing a referenced Secret does not restart the pod by itself. A Flux
`HelmRelease` carries the rest (`oidc` is optional; `trustProxy: true` is right behind the Gateway;
`localLogin.ssoAutoRedirect: true` skips the local form):

```yaml
values:
  image:
    repository: ghcr.io/warrdoge/rvna
  route:
    parentRefs:
      - name: gateway
        namespace: flux-system
    hostname: rvna.example.com
  database:
    existingSecret: rvna-database
  oidc:
    issuer: https://auth.example.com/application/o/rvna/
    clientId: rvna
    existingSecret: rvna-oidc
  trustProxy: true
  localLogin:
    ssoAutoRedirect: false
  bootstrapAdmin:
    existingSecret: rvna-bootstrap
```

`APP_URL` follows `route.hostname`, so the redirect URI to register with the provider is
`https://<route.hostname>/auth/callback`.

Set `appTimeZone` in the chart values (it becomes `APP_TIME_ZONE`); otherwise dates are shown and
day boundaries in searches are computed in UTC.

The chart's liveness probe calls `/api/health/live`, which does not touch PostgreSQL;
`readinessProbe` and `startupProbe` keep `/api/health`, which checks the database. A database
outage therefore stops new traffic through readiness but does not restart otherwise healthy pods.

Attachments live in the `attachments.mountPath` directory (`/data/attachments`, exported as
`ATTACHMENTS_DIR`), on the `<fullname>-attachments` PersistentVolumeClaim sized by
`attachments.size` on `attachments.storageClass` (empty means the cluster default), or on
`attachments.existingClaim` when set; the pod runs as uid 1000 with `podSecurityContext.fsGroup`
1000 so the volume is writable, and the claim outlives the release. Avatars are written under
`avatars.path`, which defaults to `<attachments.mountPath>/avatars` (so `/data/attachments/avatars`
on the same writable claim) and is exported as `AVATARS_DIR`; an `extraEnv` entry named
`AVATARS_DIR` replaces the chart's entry instead of duplicating it. Setting
`attachments.enabled: false` mounts an `emptyDir` instead, which loses attachments with the pod.
`maxUploadRequestMb` is the adapter-node request cap and `maxAttachmentMb` the largest single
attachment; the second must not exceed the first. `terminationGracePeriodSeconds` defaults to 120
and `shutdownTimeoutSeconds` to 110, which sets adapter-node's `SHUTDOWN_TIMEOUT` a little below
the pod grace period so an in-flight upload can finish during a roll-out; `sveltekit:shutdown` then
closes the mail queue, the GitLab queue, the SMTP transport and the database pool. `extraEnv` and `extraEnvFrom` append
environment variables and ConfigMap/Secret sources to the container, and
`startupProbe.failureThreshold`, `startupProbe.periodSeconds` and `progressDeadlineSeconds` tune
slow first starts (30 attempts 10s apart, 600s rollout deadline by default).

## QA tools

The scripts in `qa/` drive a running app with Playwright. They are not part of `npm test`. They
write to `qa/out/`, which Git ignores. `qa/addresses.ts` lists the screens (106 of them) and
resolves their addresses against the database.

`qa/compare.ts` opens the screens of two instances (`QA_OLD_URL`, `QA_NEW_URL`) and
compares them. `--only`, `--user` and `--label` select screens, account and output name; an
ordinary user needs `QA_USER_PASSWORD`.

### Crawl

`qa/crawl.ts` opens each screen of one instance, clicks every control, checks the links, the
console, failed requests and overflow, and runs 15 scripted flows. Start the app with
`DEV_LOGIN_USER=<administrator>` and a database you can change, then:

```sh
node qa/crawl.ts --base http://127.0.0.1:<port> --label admin --workers 8 --screen-timeout 60
QA_USER_PASSWORD=... node qa/crawl.ts --base http://127.0.0.1:<port> --user <ordinary-user> --label user
node qa/crawl.ts --base http://127.0.0.1:<port> --label narrow --viewport 1024x768 --no-flows
```

`--only <screen ids>` runs some screens, `--no-flows` skips the flows, `--flow <names>` runs some
flows, `--workers` sets the parallel pages (default 8, at most 16) and `--screen-timeout` the
seconds per screen (default 90). The ordinary user needs a local password: create the account
with `npm run user:create`. The result is `qa/out/crawl-<label>.json` and `.md`. A full
administrator run takes about eight minutes. It creates and changes data, so never run it
against a database that holds real work.

## Parity check

`npm run parity -- all` compares the imported database with Jira and Confluence without
writing to either system. It checks counts, per-issue and per-page details, page and space
watchers, page likes, attachment files, and the old URL paths the app has to answer. The
watcher and like checks use the same two requests per content item as the import. `--json`
prints one machine-readable object, `--skip-hash` skips the attachment sha256 pass, and `--app-url` with
`--app-token` requests every old URL against a running app. Exit codes are 0 for all
checks OK or skipped, 1 for a mismatch, and 2 for an error.

```sh
node --env-file=/path/to/.env src/importer/main.ts parity all
node --env-file=/path/to/.env src/importer/main.ts parity jira --json
```
