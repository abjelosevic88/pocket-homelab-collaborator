# How review time is measured

The point of tracking review time is to know whether a document was actually read, by whom, and how carefully. So the numbers have to resist the obvious ways of being wrong: a tab left open overnight, five tabs open at once, a phone in a pocket.

## The clock lives on the server

Every open document holds one WebSocket (`/api/v1/reviews/{id}/live`). The browser only reports facts:

- which page is most in view,
- whether the tab is visible,
- whether there was any input since the last report (scroll, wheel, mouse move, key, touch, zoom).

It reports every 5 seconds and whenever the page or visibility changes. It never sends a duration.

Every `TICK_INTERVAL` (5 s) the server looks at each person on each review and credits time only if **at least one of their tabs is visible and had input within `IDLE_AFTER`** (2 min). The credit is the time since that person's last credit, capped at two ticks, so a stalled connection cannot bank time. With several tabs open, the most recently used one counts and the others count nothing. A connection that goes quiet for 45 s is closed.

So:

| Situation | Counts? |
|---|---|
| Reading, scrolling, commenting | yes |
| Reading one long page without touching anything | yes, for up to `IDLE_AFTER` |
| Tab open in the background, or the window minimised | no |
| Tab visible but nobody touched anything for `IDLE_AFTER` | no |
| Two tabs or two devices at once | once |
| Laptop asleep, connection gone | no |

## Where the time goes

Each credit goes to:

- **the page in view** on that revision (`page_time`), which gives coverage and the heatmap;
- **the person's current reading session** (`reading_sessions`). A pause longer than `SESSION_GAP` (10 min) starts a new session, and the start is logged ("Started a reading session on v2, page 1").

## What the report derives

- **Time**: sum of a person's sessions, all revisions.
- **Coverage**: pages of the chosen revision that the person had in view for at least **5 seconds**, divided by the page count. Average coverage on the summary is over approvers and reviewers.
- **Pages nobody read**: pages where everyone's total is under 5 seconds.
- **Pace**: seconds per read page on that revision.
- **Pages per hour** (inspection rate): pages read by everyone ÷ hours spent on that revision.
- **Issues per page** (defect density): issues ÷ page count.
- **Elapsed**: from *Start review* to the decision (or now).

The heatmap uses a single-hue ramp with square-root scaling so that short visits still show; the table view next to it has the exact seconds.

## Limits

This is measured attention, not proof of understanding. Someone can scroll through without reading; the heatmap shows that as a fast, even pass. And someone reading on paper does not show up at all.
