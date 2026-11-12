# Curation guide

## Levels

- **Indexed.** Found by ingestion. Either waiting in the editor queue (not public), or published automatically from a source set to publish automatically (public, labelled "not reviewed by an editor").
- **Curated.** An editor reviewed it, wrote why it belongs, and published it. This is the public collection.
- **Featured.** A small set of curated resources eligible for the home page. Aim for 8 to 12.

Curation is a decision, not a score. Signal has no quality number. Editor priority (normal, raised, high) only nudges ranking and is separate from what kind of evidence a resource is.

## Automatic publishing

Reviewing every item does not scale, so a source you trust can publish on its own. You decide per source; it is off by default and needs the source to be verified and enabled.

An item from such a source goes public only if it passes every check:

1. The title mentions AI (or a close term) and is not a stub.
2. It is not a flagged duplicate.
3. Optional: if `TRIAGE_MODEL` is set, a model reads only the title, publisher and source name and returns tags (audience, collections, resource type, topics). It must be confident (`TRIAGE_MIN_CONFIDENCE`). If the model fails or is unsure, the item stays in the queue. It never writes the reason, summary, dates or author.

Items that fail a check are marked "needs review" once and appear under **Needs attention**. What automatic items get in return for being unreviewed:

- A visible label on the card and in the dialog, and a small ranking penalty.
- Never featured, never in reading paths or "Start here", and a "Reviewed by an editor only" filter hides them.
- If their link breaks, they are pulled back to the queue automatically (**Held back**).
- Queued items from automatic sources that nobody touches are rejected after `QUEUE_EXPIRE_DAYS` (30).

Your part is a few minutes now and then: open **Review**. The default view shows only items needing attention. **Spot check** lists a few automatic items to glance at; **Looks fine** clears one, **Make curated** adds your reason and promotes it, **Return to queue** takes it down. If a source keeps producing poor items, press **Stop auto-publishing** on it.

## Fields to fill in

- **Why included.** One direct sentence on why you selected it. Not a summary of the article. Example: "Use this to ask what evidence supports a proposed feedback tool."
- **Best for.** A concrete reader and use. Example: "District teams revising responsible-use language."
- **Read with this.** One or more resources that belong beside it, with the relationship: companion, practical example, research, policy context, newer resource, background or critical perspective. Choose a relationship only if you read both and it is true. Do not mark two resources as opposed unless their content shows it.
- **Resource type.** What it is: research study, research summary, survey or data report, guidance, framework, policy or template, classroom example, lesson or activity, student perspective, commentary, news.
- **Collections.** Any that apply: Start here, AI literacy, Learning and thinking, Inside the classroom, Assessment and academic integrity, For families, Student perspectives, School and district leadership, Privacy and security, Policy and governance, Professional learning, Equity and access, Media literacy and misinformation, Elementary education, Research and evidence, Questions, concerns, and critical perspectives.
- **Audience, grade band, subjects, topics.** Topics are free text. A tag equal to a topic slug (for example `writing`, `ai-detection`) puts the resource on that topic page.

## Dates

- **Original publication date** is when the original was published. Enter it only if you saw it on the original. `YYYY` or `YYYY-MM` is fine when that is all it shows. Leave it blank otherwise. Do not take it from the URL.
- **Added to Signal** is set when you publish.

## Verification

- **Not checked:** metadata is as it arrived.
- **Checked:** you opened the original and confirmed the title and publisher.
- **Verified:** the other details shown (date, author, reading time) match the original.

Author and reading time are shown only if you fill them in, so fill them in only when verified.

## Summaries

Write one only if it will help. A summary is public, searchable and embedded only after you tick **Approved for use**. Tick **AI-generated** if a model wrote it; the site then labels it. Editing the text clears the approval. Do not paste copyrighted text. Excerpts are stored only when a source allows it.

## Sources

Add a source only after confirming the feed URL on the publisher's own site and reading their terms of use. Mark it verified, then switch it on, then check the first run's results in the queue. Once a source has behaved well for a few runs, you can switch on **Publish automatically**. Items from a feed arrive with metadata only. Check the original before publishing.

## Duplicates

A warning means a record may repeat one already in Signal: same DOI, same title, or a very similar title. Open both. If it is a copy, reject the new one. If it is a different resource, choose **Not a duplicate**. Signal never merges records for you.

## Broken links

Link checks run daily. A link that returns 404 or 410 is marked broken and shown to readers as not working. A site that refuses automated checks (401, 403, 429) is marked blocked, which says nothing about whether it works for people. Open it yourself.

## Balance

Keep deliberate coverage of elementary and secondary education, multilingual learners, special education and accessibility, families, student perspectives, school leadership, technology and privacy, assessment, research, and skeptical or critical perspectives. The editor header counts show what is waiting; the grid filters show what is thin.
