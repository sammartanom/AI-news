# Privacy

This describes what the software does. Adapt it to your organization's policies and to the terms of the services you connect.

This site serves Pleasantville UFSD teachers. It never needs student personal information, and the interface tells people not to enter it.

## The district setup: no personal information

As configured in this repository, the site collects and keeps no personal information about anyone:

- **No accounts.** Cloudflare Access is not configured (`ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are empty), so no visitor or editor account is ever created and no email address is ever stored. Editors sign in with the `ADMIN_TOKEN` secret, which identifies no one; the audit log records the actor as `editor`.
- **No logs.** Workers Logs are switched off in `wrangler.jsonc` (`observability.enabled: false`), so Cloudflare keeps no request logs for the site. Leave them off in the dashboard too.
- **No tracking.** No analytics, cookies (other than the editor's own sign-in cookie), third-party scripts, fonts or frames. The donate link from Signal is removed and the content security policy blocks frames and outside connections.
- **Searches** go to Workers AI to be understood and are not stored by the site. An anonymous summary of how a search was read is cached at the edge for up to a week.
- **Saved resources and notes** stay in the browser. If a teacher chooses to sync them, the browser encrypts them first; the server keeps only ciphertext under a random id and cannot read it or tie it to a person.
- **Rate limits** count requests per network address in Cloudflare's memory for a minute. Nothing is written down.

`test/unit/district-privacy.test.mjs` fails the build if Access, logging, the donate link or a third-party frame is switched back on. Turning on Access accounts (below) would store editors' email addresses; do not do it without a district privacy review.

The rest of this page describes what the software can do in other setups.

## What is collected

**Visitors without an account.** Nothing is stored in Signal's database. Searches are not logged by Signal. Saved resources and notes stay in the browser's local storage on that device, and the theme and audience choice too. Clearing site data removes them.

**Accounts.** Sign-in is handled by Cloudflare Access. Signal stores, in D1:

- email address, optional display name, role, and the times of account creation and last visit
- lists the person created, and the resources in them
- membership in lists shared with them, with role (viewer or editor)
- a private note and a read mark per resource, if they write or set one

**Editors.** Editor actions are written to an audit log with the editor's email, the action, the item and the time.

**Operational logs.** Cloudflare can keep request logs for a Worker (Workers Logs, Logpush) under the account's own settings. Signal does not write search text into its own logs. Errors log a message and the path. Whoever runs the deployment decides whether to turn Cloudflare logging on and how long it is kept.

## What is sent to Workers AI

- **Every search:** the search text goes to the embedding model so it can be turned into a vector. The same happens to a question typed into Ask Signal, reading paths and perspectives.
- **Ask Signal, only if enabled:** the question, plus for each retrieved resource its title, publisher, type, date, editor's reason, best-for line and approved summary, goes to the chat model.
- **Never sent:** private notes, read marks, email addresses, list names, or any account data.
- **Automatic triage, only if `TRIAGE_MODEL` is set:** the title, publisher and source name of newly found items from sources set to publish automatically. No user data.
- **At publish time:** the text of a resource's public metadata is embedded (title, publisher, approved summary, editor's note, reason, topics, audiences, grades and subjects). Private notes cannot enter this text; the builder reads a fixed list of fields and a test checks it.

The interface shows this reminder under every search box: "Searches are processed by an AI service. Do not enter student or other confidential information." Ask Signal shows it too.

Workers AI inputs are handled under Cloudflare's terms for that product. Check its current data-use terms before use with a district.

## What is stored in D1

Public catalog data, the account data listed above, ingestion logs, and the audit log. The vector index holds embeddings of public resource text only, keyed by resource id.

Ingestion stores feed metadata: title, link, date, and, only if a source is set to allow it, a short excerpt. It does not store full articles.

## Sharing

A list owner sees the email addresses of people they share with. People a list is shared with see the list name, its resources and the owner's email. They do not see anyone's notes or read marks. `SHARE_ALLOWED_DOMAINS` can limit sharing to specific email domains. Sharing creates an account row for the invited email but sends no email.

## Retention and deletion

- **Account deletion:** `DELETE /api/me` (Account page, "Delete account") removes the user row and, by cascade, the lists they own, their memberships, notes and read marks. Items they added to other people's lists stay in those lists with the "added by" field cleared.
- **Data export:** `GET /api/me/export` (Account page, "Download my data") returns everything above as JSON.
- Deleting an account in Signal does not delete the person's Cloudflare Access identity or Access logs. Those belong to the organization that runs Access.
- Audit log entries naming an editor are kept. Remove them by SQL if your policy requires it.
- There is no automatic expiry of accounts or notes. Add a scheduled job if you need one.
- Vectors for rejected or unpublished resources are deleted, and a nightly job retries any deletion that failed.

## Third parties

Cloudflare (hosting, D1, Vectorize, Workers AI, Access). The browser loads nothing from other origins: the font and all scripts are served by Signal, and the content security policy blocks anything else. Links to original resources open the publisher's site, which has its own privacy practices.
