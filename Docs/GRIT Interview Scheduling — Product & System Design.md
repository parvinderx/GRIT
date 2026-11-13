# GRIT Interview Scheduling — Product & System Design

Nov 11, 2026 · @Parvinder Singh

## Overview

Once a student clears every skill a Track Badge needs, they book a 30-minute live Level Clearance Interview from their GRIT dashboard. The system gives each slot to exactly one student, records Pass, Fail or Retake later, and can nullify a badge if malpractice is confirmed later. Sections 1–3 are the 2-page submission write-up. Sections 4–9 are the supporting design for the prototype phase.

**What GRIT already defines** ([How GRIT Works](https://www.grit.niatindia.com/how-grit-works), [Terms & Conditions](https://www.grit.niatindia.com/terms-and-conditions), [Tracks & Badges sheet](https://docs.google.com/spreadsheets/d/1lcCz7iozkMeUakJOfRtKsxeAWhu5hhHcBtrB4iFdeUM/edit?usp=sharing)):

- The 2026–27 programme runs Feb 2026 to Feb 2027 for NIAT batches 2023, 2024 and 2025.
- There are 4 tracks: AI Product, AI Systems, AI Models and AI Robotics Mastery. Badges go Novice → Specialist → Expert → Master → Grand Master and must be earned in order. Only Novice (150 Miles) and Specialist (250 Miles) are open today.
- A badge needs certain skills at certain levels (L1–L4), then a Level Clearance Interview. AI Robotics needs a project before the interview.
- **Hard deadline:** a student must earn at least 1 badge by **31 Dec 2026** or be disqualified automatically (T&C 3.6, 5.3.5). Interview demand will therefore spike in Nov–Dec.
- Leaderboard ties are broken by **timestamp of progress**, so the time a badge is stamped has to be fair.
- Cheating, plagiarism, impersonation and collusion lead to disqualification (T&C 7.4). Personal data falls under India's DPDP Act 2023.

**Design goals**

1. No double-bookings, even during the December rush.
2. Every state shows the student one status, one reason and one next action.
3. The interview team sees, by day and by track, which eligible students have not booked.
4. No result leaks, no outcome tampering, and every change is audited.

**Scope.** In scope: eligibility to book, interviewer availability, booking and rescheduling, outcome recording, student status, the team tracker and badge nullification. Out of scope: the interview question bank, the video platform (we use generated Meet or Zoom links) and contest scoring, which feeds us skill levels.

**Method.** The public GRIT pages were researched first. Four specialist agents then designed in parallel against a shared state contract: a business analyst, a feature designer, a UI/UX designer and a backend designer. Two reviewer agents checked and rechecked the result (Section 9).

## 1. Interview journey states

A journey is one student working toward one badge, for example Ravi × AI Product Mastery · Novice. It is always in one of 11 stored states. A student can hold only **one upcoming booking** across all their journeys. "Interview live now" is not stored: it is worked out as BOOKED and within 10 minutes of the start.

| State | Student sees | Moves in when | Moves out → next state |
| --- | --- | --- | --- |
| LOCKED | Locked — clear remaining skills | Journey created, or a required skill, project or earlier badge is missing or revoked | Every requirement cleared → ELIGIBLE |
| ELIGIBLE | Ready to book | Requirements met, cooldown over, early cancel, or we voided the booking (priority rebook) | Books a time → BOOKED · skill revoked → LOCKED · no badge at the 31 Dec sweep → CLOSED |
| BOOKED | Interview scheduled → Interview live now (from T−10 min) | Booking confirmed. A reschedule stays BOOKED, with at most 2 changes | Both join (per the video provider) → AWAITING\_RESULT · student absent at +10 min → NO\_SHOW · cancels ≥12 h before → ELIGIBLE · interviewer or platform fault → ELIGIBLE + priority |
| AWAITING\_RESULT | Result pending | Interview held | Outcome publishes 15 min after the interviewer submits → PASSED / FAILED / RETAKE\_LATER |
| PASSED | Badge earned | PASS published. Badge dated to the interview start; Miles credited | Integrity hold confirmed → ON\_HOLD (badge under review, Miles frozen) |
| FAILED | Not cleared — reattempt from {date} | FAIL published. Counts as an attempt | 14 days from the interview start → ELIGIBLE · 3rd attempt used → CLOSED |
| RETAKE\_LATER | Retake allowed from {date} | Close but not yet, or a student-side drop (1 per journey). **Not** an attempt | 3 days → ELIGIBLE. A 3rd Retake later in a row needs admin approval |
| NO\_SHOW | Missed interview — rebook from {date} | No provider join by +10 min, or an emergency claim is rejected. Counts as an attempt | 7 days → ELIGIBLE · dispute upheld within 48 h → ELIGIBLE · 3rd attempt → CLOSED |
| ON\_HOLD | Under review — booking paused | From any state, once a Program Admin confirms an integrity flag (within 24 h of triage) | Dismissed → previous state · confirmed, had badge → NULLIFIED · confirmed, no badge → CLOSED |
| NULLIFIED | Badge nullified | Malpractice confirmed by two Program Admins. Miles reversed; higher badges in the track cascade | Terminal for the season. Reopen only with two-person approval → LOCKED |
| CLOSED | Booking closed — {reason} | Attempt limit reached, no badge after 31 Dec, disqualified, or season end (14 Feb 2027) | Attempt limit only: +1 attempt with two-person approval → ELIGIBLE |

&#91;embedded content: Interview journey · 11 states and the main transitions\]

The main path runs straight down to a badge. Each non-pass loops back to Ready to book after its cooldown, and only Fail and No-show count toward the 3-attempt limit.

**Rules that hold across states**

- The badge date and every cooldown count from the **interview start time**, not from when the result was recorded. A slow interviewer can't cost a student leaderboard rank or the deadline.
- An interview held on or before **31 Dec 2026, 11:59 PM IST** counts toward the deadline, even if its result is recorded on 1 Jan.
- Anything that isn't the student's fault (interviewer cancels or no-shows, platform outage, a dismissed hold) never uses an attempt and gives priority rebooking.
- The server enforces every transition in the command handler and again with a database trigger. Each change bumps a version number and writes an audit event. Any transition not listed returns 409.

## 2. Edge cases, assumptions and open questions

The analysts listed 72 edge cases. The 18 below are the ones that shaped the design. Most come from three pressures: a December rush toward a hard deadline, a small team of interviewers, and a badge that has to stay trustworthy.

| Area | Case | How it's handled |
| --- | --- | --- |
| Booking | Two students tap the same time at the same moment | One atomic claim wins. The other sees "That time was just taken" plus the 3 nearest open times. |
| Booking | Double-tap, or a retry on a flaky network | The request repeats the same idempotency key, so the server returns the original booking instead of creating a second one. |
| Booking | One student books two badges in two tabs | A database rule allows one upcoming booking per student. The second request gets "You already have an interview on {date}". |
| Booking | An interviewer removes hours while a booking lands | One transaction cancels the open slots first, then lists any booked ones so the team can reassign them. Nothing is left orphaned. |
| Time | A slot frees up 13 h before the interview | It can be rebooked until 3 h before the start. Free changes close earlier, at 12 h. |
| Time | A student can't make it, inside 12 h | Self-cancel is off. "Report an emergency" goes to the team, who void it (no attempt) or mark a no-show. One approved emergency per season without documents. |
| Deadline | A first Fail after 16 Dec | A retry would land after 31 Dec. From 1 Dec the slot picker warns "Book by 16 Dec to keep a retry before the deadline". |
| Deadline | Interview at 11:00 PM on 31 Dec, result recorded 1 Jan | It counts. The deadline sweep waits for pending results. |
| Deadline | Interviewer no-show or a platform outage on 30–31 Dec | Priority rebook, plus deadline protection to 10 Jan 2027. This needs sign-off because T&C 5.3.5 is strict. |
| Capacity | December demand exceeds the slots available | From 1 Dec, 70% of daily slots go to students with no badge yet and 20% are held for priority rebooks. The tracker shows the shortfall daily. |
| Interview day | The student taps Join, then leaves | Attendance comes only from the video provider's join events. A tap on Join is not proof of attendance, so it can't block a no-show. |
| Interview day | The student waits in the lobby but isn't admitted | The provider logs them as present, so the interviewer can't mark a no-show. The team decides. |
| Interview day | The interviewer hasn't joined by +5 min | The student taps "Interviewer hasn't joined". The team swaps in someone free at the same time. Otherwise the booking is voided at +15 min with priority rebook. |
| Interview day | The student's connection drops mid-interview | Rejoin is allowed until 15 min after the scheduled end. If it can't resume, the first case is a free Retake later. Later ones count if at least 15 min were assessed. |
| Outcome | The interviewer forgets to record a result | Reminders go out at +2 h and +12 h, then it escalates to the team at +24 h. The badge date doesn't move. |
| Outcome | Wrong result, or recorded against the wrong student | An admin proposes an amendment. A Program Admin approves it, and that person can be neither the proposer nor the interviewer. The student is told. |
| Integrity | A flag is raised after the badge was awarded | The badge goes under review and its Miles are frozen but stay visible. If confirmed, it is nullified, its Miles reversed, the leaderboard recomputed, and higher badges in the track cascade. |
| Integrity | A flag is raised to sabotage a rival near the deadline | Triage withholds only that one result. A wider hold needs a Program Admin (not the flagger) within 24 h. If the flag is dismissed after the deadline, the student gets grace. |

**Assumptions**

1. An interview is a 30-min 1:1 live video call. Slots sit on a 40-min grid, from 9:00 AM to 9:00 PM IST.
2. Students pick a time, not an interviewer. The server assigns the interviewer at random among those qualified and free, weighted by load.
3. Skill levels come from the contest system through signed, sequenced events, with a nightly reconcile.
4. Badges are earned in order within a track only.
5. Attempts: Fail (14-day cooldown) and No-show (7-day cooldown) count, up to 3 per badge per season. Retake later doesn't count (3-day cooldown).
6. Badge Miles (Novice 150, Specialist 250) are credited with the interview start time as their timestamp.
7. Interviews are recorded under a separate, versioned consent. Recordings are kept 90 days, and longer only while a case is open.
8. Students see written feedback and up to 3 focus areas. They never see rubric scores or the interviewer's internal notes.
9. The last interview day is 14 Feb 2027, and the season ends 28 Feb 2027.
10. About 3,000 students will need a first-badge interview before 31 Dec. This is an estimate; replace it with real contest data.

**Open questions for the GRIT team (decide before 1 Dec 2026)**

1. Do students get deadline grace when a miss is caused by us (an interviewer, the platform, or a dismissed hold)?
2. How many interviewer-hours are available each week in December, and can a Novice interview run 20 min? At 30 min, the base team covers about 28% of demand.
3. Can a single badge be nullified, or is every confirmed case a full disqualification (T&C 7.4)?
4. Is the 70% December reserve for students with no badge approved?
5. Is the recording policy approved under the DPDP Act, including retention and who can view recordings?
6. Does a badge under review keep its leaderboard position until a decision?

## 3. Data model and double-booking prevention

The database is PostgreSQL 16. Times are stored in UTC and shown in IST. The database is the final judge: even if the application code has a bug, the constraints below still stop two students landing on one slot.

| Table | Key fields | What it guarantees |
| --- | --- | --- |
| users, user\_roles | sso\_subject, role (STUDENT, INTERVIEWER, INTERVIEW\_ADMIN, PROGRAM\_ADMIN) | Staff roles come from identity-provider groups and require MFA. A student can never hold a staff role. |
| students | user\_id, grit\_id, batch, section, programme\_status, photo\_key | The photo is served only through a 5-min signed URL. |
| tracks, badges, badge\_skill\_requirements | badge: track\_id, level, miles, prerequisite\_badge\_id, requires\_project · requirement: skill\_id, min\_level, version | `UNIQUE(track_id, level)`. Requirements are versioned, so a mid-season change doesn't break existing bookings. |
| student\_skill\_levels | (student\_id, skill\_id), level, source\_seq | Written only by the contest-sync consumer. An update applies only if its sequence number is higher. |
| interviewers, interviewer\_tracks, interviewer\_conflicts | max\_per\_day = 8, last\_assigned\_at · track\_id, max\_badge\_level · student\_id, reason | Only qualified, calibrated, active interviewers get slots. Conflicts of interest are excluded when interviewers are assigned. |
| availability\_rules, availability\_overrides | weekday, start\_local, end\_local, tz = Asia/Kolkata · date, ADD or REMOVE | Turned into slots on the 9:00 AM IST grid, 14 days ahead. One-off additions go live only at the next 8:00 PM IST release. |
| interview\_slots | interviewer\_id, start\_at, buffer\_end\_at, status (OPEN, BOOKED, BLOCKED, CANCELLED), audience (ANY, DEADLINE, PRIORITY), bookable\_from, version | No interviewer can hold two overlapping slots (the `EXCLUDE` constraint below). |
| interview\_journeys | student\_id, badge\_id, season\_id, state, state\_reason, attempt\_count, max\_attempts = 3, consecutive\_retake\_later, changes\_count, cooldown\_until, priority\_rebook, hold\_prev\_state, deadline\_protected\_until, version | `UNIQUE(student, badge, season)`. A trigger allows only the transitions in Section 1, and every write must bump `version`. |
| bookings | journey\_id, student\_id, slot\_id, interviewer\_id, start\_at, status, void\_reason, booking\_code, student\_joined\_at and interviewer\_joined\_at (from provider events), review\_required | The three partial unique indexes below. |
| interview\_outcomes | booking\_id, result (PASS, FAIL, RETAKE\_LATER), rubric, feedback\_to\_student, focus\_areas, internal\_notes (encrypted), recorded\_by, publish\_at, locked\_at, review\_status, amended\_from | One current outcome per booking. `publish_at` is fixed at first submit + 15 min, then the row locks. The reviewer can't be the recorder. |
| student\_badges | student\_id, badge\_id, outcome\_id, awarded\_at (= interview start), status (ACTIVE, UNDER\_REVIEW, NULLIFIED), case\_id | One active badge per student and badge. Rows are never deleted; nullification is a status change. |
| integrity\_cases, approvals | subject\_type (STUDENT or INTERVIEWER), status (TRIAGE, OPEN, DISMISSED, CONFIRMED), opened\_by, decided\_by, cosigned\_by · action, requested\_by, approved\_by | The decider can't be the opener, and a confirmation needs a co-signer. Every override needs an approver who isn't the requester. |
| journey\_events, audit\_log, outbox, idempotency\_keys | append-only, hash-chained · dedupe\_key · (user\_id, idem\_key) | No UPDATE or DELETE grants. Side effects (meetings, messages, Miles) run exactly once. |

**How two students are kept off the same slot.** There are four layers, and each one catches what the layer above would miss.

1. **Atomic claim.** One transaction locks the student's journey row. It then claims one free interviewer slot at the chosen time with `FOR UPDATE SKIP LOCKED` and `UPDATE … SET status = 'BOOKED' WHERE status = 'OPEN'`. If zero rows are updated, the request returns 409 SLOT\_TAKEN with the 3 nearest open times.
2. **Partial unique indexes and an exclusion constraint.** These are the database's backstop:

```sql
CREATE UNIQUE INDEX uq_bookings_slot_live ON bookings (slot_id)
  WHERE status IN ('CONFIRMED','IN_PROGRESS','COMPLETED','NO_SHOW');   -- one live booking per slot
CREATE UNIQUE INDEX uq_bookings_student_upcoming ON bookings (student_id)
  WHERE status = 'CONFIRMED';                                         -- one upcoming interview per student
CREATE UNIQUE INDEX uq_bookings_journey_live ON bookings (journey_id)
  WHERE status IN ('CONFIRMED','IN_PROGRESS');                        -- one live booking per badge journey
ALTER TABLE interview_slots ADD CONSTRAINT no_interviewer_overlap
  EXCLUDE USING gist (interviewer_id WITH =, tstzrange(start_at, buffer_end_at, '[)') WITH &&)
  WHERE (status <> 'CANCELLED');                                      -- needs btree_gist
```

3. **Idempotency key.** Every booking request carries one. A retry or double-tap gets the original response back instead of creating a second booking.
4. **Per-interviewer lock on availability writes.** This makes a clash between two overlapping slot writes fail with a clean "overlaps" error instead of a database deadlock.

**Verified on a real database.** The QA agent ran this schema and transaction on PostgreSQL 16.15 with 50 concurrent requests per test, and 11 of 11 checks passed in all 4 runs:

- 50 students on one slot gave exactly 1 booking and 49 "slot taken" responses.
- One student sending 50 attempts across 4 badges gave exactly 1 booking.
- 50 overlapping slot inserts for one interviewer left exactly 1 row.

Two defects found in testing are fixed above. A booking withdrawn before its start now gets the status `CANCELLED_LATE`, which is outside the live index, so its slot can be resold. Availability writes are serialised per interviewer to avoid deadlocks.

## 4. The three most important student messages

These three cover the moments where students are most likely to drop off. Each one is written exactly as it appears on screen, filled in for a sample student, Ravi: AI Product Mastery · Novice, interview on Sat 28 Nov 2026 at 7:00 PM IST. Anything in {braces} is filled in by the system.

**M1 · Ready to book** (dashboard hero card and badge page). This is where most students get stuck. Every "not booked" row on the team tracker is a student this message didn't move, and with the 31 Dec deadline that can cost them GRIT.

> **Ready to book**
>
> **All skills cleared! Book your interview**
>
> You've cleared every skill for AI Product Mastery · Novice. One step left: a 30-min live Level Clearance Interview. Clear it to earn the badge and +150 Miles.
>
> Earn your first Track Badge by 31 Dec 2026 · 38 days left. Book early so there's room for a retake.
>
> &#91; Book interview slot \] · What to expect

**M2 · Interview confirmed** (confirmation screen; the same facts go by email and WhatsApp, without a meeting link). This is the one place the student checks for their appointment. Every line is there to prevent a no-show, which costs an attempt and a 7-day wait.

> **You're booked!**
>
> AI Product Mastery · Novice — Level Clearance Interview
>
> Sat, 28 Nov 2026 · 7:00–7:30 PM IST
>
> Join from your GRIT dashboard. The Join button opens at 6:50 PM IST, 10 minutes before the start.
>
> Keep ready: camera and mic, stable internet, your college ID card.
>
> Free to reschedule or cancel until Sat, 28 Nov, 7:00 AM IST · 2 changes left. After that, changes are closed. For a real emergency, use "Report an emergency" on your dashboard.
>
> If you haven't joined by 7:10 PM IST, it counts as a missed interview and uses 1 of your 3 attempts.
>
> &#91; Add to calendar \] · Reschedule · Cancel booking

**M3 · Not cleared** (result screen and dashboard hero card). This is the most emotional moment in the flow, and it decides whether the student comes back. So it carries feedback, a dated next step and where they stand against the deadline.

> **Not cleared — reattempt from 12 Dec**
>
> **Not cleared this time**
>
> Your AI Product Mastery · Novice interview on 28 Nov didn't clear the bar yet. One interview doesn't define your GRIT. Here's what to work on.
>
> **Feedback from your interviewer:** "{feedback\_to\_student}"
>
> **Focus areas:** CS Fundamentals · UI Engineering
>
> Next attempt opens Sat, 12 Dec 2026 · 2 of 3 attempts left. That leaves 19 days before the 31 Dec deadline.
>
> &#91; Remind me on 12 Dec \] · Practise CS Fundamentals

**Notifications never reveal the result.** Every outcome (Pass, Fail, Retake later or No-show) sends the same push and WhatsApp text: "Your GRIT interview result is ready. Open your dashboard to see it." If only passes were announced, a silent phone would give away a fail on the lock screen. The celebration happens in the app.

## 5. UI/UX design

The design has 14 screens: 7 for students (designed for a 360 px phone first), 3 for interviewers and 4 for the interview team (both desktop-first). Every card shows one status and one next action. All times are absolute and in IST. The UI only offers actions the server says are allowed.

**Design principles**

1. **One card, one status, one next action.** Anything else is a secondary link.
2. **Absolute time, always IST,** for example "Sat, 28 Nov 2026 · 7:00 PM IST". Countdowns run on server time, not the phone's clock.
3. **Fault-aware, blame-free copy.** If something wasn't the student's fault, say so first and make the fix free. Red is never used for a student's result.
4. **Always a dated way forward.** Every non-final state shows the date the next action unlocks, the attempts left and the days to 31 Dec.
5. **Server decides, UI reflects.** Buttons come from the server's `allowed_actions`. A result, a note or an identity is never shown before it is published and permitted for that role.

**Screen inventory**

| ID | Screen | Who | Purpose |
| --- | --- | --- | --- |
| S1 | Student home | Student | One "Your interview" hero card, track cards with badge chips, deadline strip, rank snippet |
| S2 | Badge detail | Student | Skill checklist, then the Level Clearance Interview step, attempt history, what to expect |
| S3 | Slot picker and confirm | Student | 14-day date strip, times grouped Morning / Afternoon / Evening, one-step confirm with no hold timer |
| S4 | Booking confirmed | Student | Message M2, add to calendar, change policy |
| S5 | My interview | Student | Countdown, setup checklist, reschedule or cancel (≥12 h), Report an emergency (<12 h), Join from T−10 min, "Interviewer hasn't joined" |
| S6 | Result | Student | Outcome, feedback and focus areas, next date, attempts left |
| S7 | Leaderboard and profile | Student | Qualiflyer tab and badge shelf, where a Pass shows up publicly |
| I1 | Availability | Interviewer | Weekly hours, date overrides, a preview of the exact slots they create; daily cap is read-only |
| I2 | Daily schedule | Interviewer | Today's interviews, outcomes due with a 24 h countdown, start and join |
| I3 | Outcome form | Interviewer | Identity check, what happened, rubric, result, student feedback vs internal notes, integrity concern |
| A1 | Booking tracker | Interview team | Who is eligible and booked vs not booked, deadline risk, reminders |
| A2 | Capacity | Interview team | Demand vs open slots for 14 days, heatmap, interviewer load |
| A3 | Integrity case | Opener / Program Admin | Evidence, effects, decision with co-sign and impact preview |
| A4 | Approvals queue | Program Admin | Amendments, reopens, cooldown overrides and emergency waivers awaiting a second person |

**S1 Student home, before and after a Pass** (the main before/after pair; the full matrix follows below)

```text
BEFORE · Result pending                    AFTER · Pass
+--------------------------------------+   +--------------------------------------+
| GRIT                     1,240 Miles |   | GRIT                     1,390 Miles |
| (!) 33 days to earn your first Track |   |                                      |
|     Badge · Deadline 31 Dec 2026     |   |     (deadline strip removed)         |
+--------------------------------------+   +--------------------------------------+
| YOUR INTERVIEW                       |   | YOUR INTERVIEW                       |
| [Result pending]                     |   | [Badge earned]                       |
| AI Product Mastery · Novice          |   | AI Product Mastery · Novice          |
| Your interview on Sat 28 Nov is done.|   | +150 Miles · Earned on 28 Nov 2026   |
| Results usually arrive within 24 h.  |   | You're a Qualiflyer!                 |
| Your badge date will be 28 Nov.      |   | [         See your rank          ]   |
|                                      |   | What's next: Specialist >            |
+--------------------------------------+   +--------------------------------------+
| YOUR TRACKS                          |   | YOUR TRACKS                          |
| AI Product Mastery                   |   | AI Product Mastery                   |
|   Novice       [Result pending]      |   |   Novice       [Badge earned]        |
|   Specialist   [Locked · 1/4 skills] |   |   Specialist   [Locked · 1/4 skills] |
| AI Systems Mastery                   |   | AI Systems Mastery                   |
|   Novice       [Ready to book]       |   |   Novice       [Ready to book]       |
+--------------------------------------+   +--------------------------------------+
| Pre-Qualiflyer · #212                |   | Qualiflyer · #87                     |
+--------------------------------------+   +--------------------------------------+
```

**S3 Slot picker** (students pick a time; the server assigns the interviewer)

```text
+--------------------------------------+
| < Book interview                     |
| AI Product Mastery · Novice · 30 min |
| All times in IST                     |
| Earliest open: Thu 26 Nov, 6:20 PM   |
| [Thu 26] [Fri 27] [Sat 28] [Sun 29]  |
|  6 open   Full    4 open   9 open    |
| TIMES ON SAT 28 NOV                  |
| Morning    [9:00] [9:40] [10:20]     |
| Afternoon  [1:00] [3:40 · Few left]  |
| Evening    [6:20] [(o) 7:00] [7:40]  |
+--------------------------------------+
| Sat 28 Nov · 7:00 PM IST             |
| [             Continue             ] |
+--------------------------------------+
```

- Each time chip stands for every open interviewer slot at that start time. No interviewer names appear anywhere before T−10 min.
- New days open at 8:00 PM IST. A time disappears 3 h before it starts (2 h for priority rebooks).
- From 1 Dec, a student with no badge sees: "Heads-up: if this attempt isn't cleared, your next one opens after 31 Dec. Book by {book\_by} to keep a retry."
- The confirm sheet is one step with no hold timer. It shows the date and time, the change policy and a required tick: "I'll join on time with my camera on and college ID ready." Then \[ Confirm booking \].
- If the time is taken mid-confirm: "7:00 PM just got booked. Pick another time", with the 3 nearest times shown inline.

**I2 Interviewer daily schedule**

```text
Sat, 28 Nov 2026                     6 interviews · 2 done · 1 outcome due   All times IST
OUTCOMES DUE
  6:20 PM  Karthik M. · AI Product · Novice   due by Sun 29 Nov, 6:20 PM   [Record outcome]
SCHEDULE
  6:20 PM  [Ended · outcome due]  Karthik M. · AI Product · Novice        [Record outcome]
  7:00 PM  [Live now]   Ravi T. · AI Product · Novice · code 7KQ4PZ
                        Student in lobby (from video provider)
                        [Start interview]   Student didn't join (from 7:10 PM)
  7:40 PM  [Booked]     Meera P. · AI Systems · Novice
  8:20 PM  [Open slot]  Not booked
  9:00 PM  [Cancelled]  Cancelled by the interview team
```

- The brief for each interview shows only the first name and last initial, registered photo, track and badge, required skills, and the booking code. It is visible from 24 h before to 24 h after the interview.
- The brief never shows the attempt number, earlier results or notes, so the interviewer isn't anchored by them. It also never shows a GRIT ID, batch, section, campus or contact details.
- "I can't take this interview" is allowed only until 24 h before. After that it goes to the team, who try a same-time swap first.

**I3 Outcome form** (one screen, top to bottom)

1. **Identity check.** "I matched the student to their registered photo and college ID" plus "Booking code 7KQ4PZ matched". Both are required to start.
2. **What happened?** Completed · Student didn't join (available from +10 min, and blocked if the provider shows the student present) · Couldn't happen: my side or the platform · Started but couldn't finish fairly.
3. **Rubric.** One row per badge skill plus Communication, scored 1 Not yet · 2 Developing · 3 Meets bar · 4 Strong. The form shows a suggested result.
4. **Result:** Pass · Retake later · Fail. A result that differs from the suggestion needs an internal justification. A Pass against the suggestion goes to second review before it publishes.
5. **Feedback for the student** (the student sees this). 80–600 characters and 1–3 focus areas, required for Fail and Retake later. A "Preview as student" link shows how it will look.
6. **Internal notes**, on a grey background with a lock label: "Interview team only, never shown to the student."
7. **Integrity concern** (optional). Category and observation. This withholds only this result while it's reviewed.

The submit dialog reads: "Submit outcome: **Pass** for Ravi T.? The student sees this at 7:52 PM IST. You can edit until then." For a Fail it adds "This uses 1 of their 3 attempts."

**A1 Booking tracker** (answers "who has booked and who hasn't")

- **Tiles:** Eligible · Booked · Not booked · No badge and not booked · Result pending · Outcomes overdue.
- **Filters:** track, badge, campus, batch, section, state, days since eligible (0–2, 3–7, 8–14, >14). Toggles: "Not booked" and "Deadline risk".
- **Columns:** student, track · badge, state, eligible since, booking (IST), interviewer, attempts used, changes used, badge date, deadline risk, last reminder.
- **Deadline risk:**
  - Critical: no badge and the next possible interview is too late for a retry.
  - High: no badge, not booked and eligible more than 7 days.
  - Watch: no badge, in a cooldown.
  - OK: everyone else.
  - Shown as text and an icon, not colour alone.
- **Bulk "Send booking reminder":** templates only, at most 1 per student every 72 h.
- **Export:** filtered columns only, never contact details, watermarked and logged. Contact details are masked, and only a Program Admin can reveal them, under logged break-glass access.

**Before and after the result: student screens.** "Before" means Interview scheduled, then Result pending. Sample data: Ravi, 1,240 Miles, Pre-Qualiflyer #212, interview on Sat 28 Nov. For Nullified, "before" is the earned badge.

| Screen · element | Before | After Pass | After Fail | After Retake later | After Nullified |
| --- | --- | --- | --- | --- | --- |
| S1 Miles in header | 1,240 | 1,390 | 1,240 | 1,240 | 1,240 (150 removed) |
| S1 deadline strip | "33 days to earn your first Track Badge" | Removed | Stays | Stays | Returns if no badge is left |
| S1 hero chip | Interview scheduled → Result pending | Badge earned | Not cleared — reattempt from 12 Dec | Retake allowed from 1 Dec | Badge nullified |
| S1 hero button | View details → none | See your rank | Remind me on 12 Dec | Remind me on 1 Dec → Book retake | Contact GRIT support |
| S1 Specialist row | Locked · "Earn Novice first" | "Earn Novice first" removed. Ready to book if its skills are already cleared | Unchanged | Unchanged | "Earn Novice first" returns. An earned Specialist is nullified by cascade |
| S1 other tracks' Book buttons | Disabled while scheduled, enabled once the result is pending | Enabled | Enabled | Enabled | Enabled unless the student is on hold |
| S2 badge art and interview step | Unlit · "Scheduled: Sat 28 Nov, 7:00 PM IST" | Gold · "Cleared · 28 Nov 2026" | Unlit · "Not cleared · reattempt from 12 Dec" | Unlit · "Retake from 1 Dec" | Greyscale with slash · "Nullified · 16 Dec 2026" |
| S2 attempts counter | 0 of 3 used | Hidden | 1 of 3 used | 0 of 3 used, not counted | Hidden |
| S6 result screen | "Your badge date will be 28 Nov, your interview date" | "Badge earned! +150 Miles · Earned on Sat, 28 Nov 2026" | Message M3 | "Not counted as an attempt", with feedback and focus areas | "−150 Miles · decision on 16 Dec 2026 under GRIT T&C 7.4" |
| S7 leaderboard | Pre-Qualiflyers #212, no badge icon | Qualiflyers #87, Novice icon. Tie-break time 28 Nov, 7:00 PM IST | Unchanged | Unchanged | Back in Pre-Qualiflyers, icon removed. "Nullified" is never shown publicly |
| S7 profile badge shelf | "Interview on 28 Nov" | "Earned 28 Nov 2026" | "Reattempt from 12 Dec" | "Retake from 1 Dec" | Visible only to the student: "Badge nullified · 16 Dec 2026" |

**Before and after the result: staff screens**

| Screen · element | Before | After Pass | After Fail | After Retake later | After Nullified |
| --- | --- | --- | --- | --- | --- |
| A1 state | Interview scheduled → Result pending (red "Overdue" after 24 h) | Badge earned | Not cleared — from 12 Dec | Retake from 1 Dec | Badge nullified · case IC-0412 |
| A1 attempts used | 0/3 | 0/3 | 1/3 | 0/3 | 0/3 |
| A1 deadline risk | High if no badge | Cleared | Watch | Watch | High if no badge is left |
| A1 tile it counts in | Booked → Result pending | Leaves Eligible | Not booked from 12 Dec | Not booked from 1 Dec | Back in Eligible or Closed, by decision |
| I2 schedule row | Live now → Ended · outcome due | Recorded · edit until 7:52 PM → Published | Same | Same | No change on the interviewer's past row |
| A2 capacity | Booked seat | None | +1 demand on 12 Dec | +1 demand on 1 Dec | None |

**Copy for every other state** (dashboard hero card: title, body, button)

| State | Title | Body | Button |
| --- | --- | --- | --- |
| Locked | {n} skills to go | Clear {skill\_list} to unlock your {badge} interview. | View contests |
| Ready, another interview booked | Ready to book | You can hold one interview at a time. Book this one after your {other\_badge} interview on {date}. | View my interview |
| Ready, after we cancelled | Your interview was called off. Not your fault. | {Your interviewer couldn't make it / We had a technical problem} on {date}. This doesn't count as an attempt, and you get priority rebooking. | Rebook now |
| Scheduled, under 12 h | Your interview is in {h} h {m} min | Changes are closed. The Join button opens at {time} IST. Can't make it because of an emergency? Tell us. | Test my setup · Report an emergency |
| Interview live now | Your interview starts at 7:00 PM IST | Join now and settle in. Your interviewer is Priya. Your code is 7KQ4PZ. Keep your college ID ready. | Join interview |
| Waiting for interviewer | Waiting for your interviewer | Stay on the call. If they haven't joined by 7:05 PM, tap below and we'll alert the team. If they still aren't here at 7:15 PM, this interview is cancelled and won't count against you. | Interviewer hasn't joined |
| Missed interview | Missed interview | You didn't join your interview on Sat 28 Nov at 7:00 PM IST. This used 1 of your 3 attempts. You can rebook from Sat 5 Dec. | Remind me on 5 Dec · Problem on our side? Report it (48 h) |
| Under review | Under review — booking paused | Your interview journey is being reviewed under GRIT rules. New bookings are paused until the review is done. An interview you've already booked still goes ahead, and its result will appear after the review. | Read GRIT rules |
| Review closed | Review closed — no action taken | Everything is back as it was. Any result we held is now on your dashboard. | Back to dashboard |
| Attempt limit | Attempt limit reached | You've used all 3 attempts for {badge}. The interview team reviews every case within 5 working days and will let you know. | Explore other tracks |
| Deadline passed | Booking closed | GRIT needed a Track Badge by 31 Dec 2026, so interview booking is closed for this season. | Read GRIT rules |
| Nullified | Badge nullified | After a review under GRIT T&C 7.4, your {badge} badge has been nullified and its {miles} Miles removed. | Contact GRIT support |

**Accessibility and UI hygiene**

- **WCAG 2.2 AA.** Text contrast is at least 4.5:1, and every status pairs an icon with text. Time chips form a labelled radio group, for example "Saturday 28 November, 7:00 PM IST, few left". Focus moves to the heading when a result loads. Reduced-motion settings are respected. Touch targets are at least 24 × 24 px. There is no booking timer to beat.
- **Low bandwidth.** Skeleton loading states, and a cached offline view where Book and Join are disabled and the reason is shown.
- **Never shown to students:** other students' names, the interviewer's identity before T−10 min, rubric scores, internal notes, unpublished results, allegation details, or the raw meeting URL. Join always goes through the dashboard.
- **No double submits.** The button is disabled once tapped. Each distinct request gets a fresh idempotency key. The confirmation is a separate page loaded after the booking (post-redirect-get), so refreshing it never books twice.

## 6. System design

Scheduling is a module inside the existing GRIT dashboard backend. It runs on one PostgreSQL primary with one read replica, Redis, and a few background workers. The December bottleneck is interviewer hours, not compute, so the design favours correctness and simple operations over scale-out.

&#91;embedded content: Architecture · who calls whom\]

Requests pass the gateway checks before they reach the scheduling service. That service writes to PostgreSQL in single transactions. Side effects are queued in an outbox, and workers carry them out exactly once.

**Components**

| Component | What it does |
| --- | --- |
| Dashboard apps | The student and interviewer web apps share one origin. The admin console runs on a separate host behind MFA and an IP allow-list. |
| CDN and WAF | Bot rules, rate caps and TLS 1.2+. A challenge appears at the 8:00 PM slot release if traffic looks automated. |
| BFF / API gateway | GRIT SSO session (OIDC), CSRF protection, Redis rate limits, request IDs, and a route-to-role check. |
| Scheduling service | Command handlers for journeys, bookings, outcomes and integrity cases. Each one checks object-level access and the state machine. Slot lists are read from the replica through a 5-second Redis cache. |
| PostgreSQL | The source of truth. Holds the constraints and transition trigger, with point-in-time recovery for 35 days. |
| Eligibility consumer | Takes signed, sequenced skill-level events from the contest system, ignores duplicates and out-of-order events, and reconciles nightly. |
| Video provider integration | One meeting per booking with a waiting room, per-participant single-use join tokens and a room capped at 2 people. Participant join and leave webhooks are the only proof of attendance. |
| Outbox and notification worker | Sends email, WhatsApp, SMS, push and in-app messages from approved templates. Every side effect is written to an outbox in the same transaction, so it runs exactly once. |
| Job scheduler | Runs the timed jobs below through the same command handlers as the API. |
| GRIT core | Keeps the Miles ledger and leaderboards. Receives badge-awarded and badge-nullified events in order, signed, with a daily reconciliation. |
| Audit store, object storage and KMS | A hash-chained audit log, anchored daily to write-once storage. Photos, evidence and recordings sit in private buckets behind signed URLs. Notes, phone numbers and meeting URLs are encrypted with envelope keys. |

**Key APIs** (base `/api/v1`)

Every mutation needs an `Idempotency-Key`. Requesting an object you don't own returns 404, so its existence isn't revealed. Every response carries `server_time`.

| Endpoint | Who | Key checks |
| --- | --- | --- |
| `GET /me/interviews` | Student | Own journeys only. Returns state, `allowed_actions` and the `book_by` date. |
| `GET /journeys/{id}/available-times` | Student | Own eligible journey. Returns times only, never interviewers. Seat counts are capped at "5+". |
| `POST /bookings` {journey\_id, start\_at} | Student | Runs every guard in Section 3. Errors: 409 SLOT\_TAKEN or ALREADY\_BOOKED, 423 ON\_HOLD, 422 COOLDOWN, OUTSIDE\_WINDOW or AFTER\_DEADLINE. |
| `POST /bookings/{id}/reschedule` and `/cancel` | Student | At least 12 h before the start, fewer than 2 changes so far, and a one-time code inside 72 h. |
| `POST /bookings/{id}/emergency` | Student | Under 12 h before the start. At most 1 open and 2 per season. |
| `POST /bookings/{id}/join` | Student | First join from T−10 to T+10 min, rejoin until end+15. Returns a single-use token and the interviewer's first name. |
| `POST /bookings/{id}/interviewer-absent` | Student | From T+5 min, once per booking. |
| `GET /journeys/{id}/result` | Student | Published results only. Never rubric scores or notes. |
| `PUT /interviewer/availability` | Interviewer | Own rules only. Serialised per interviewer. Booked slots are listed for reassignment, never silently deleted. |
| `GET /interviewer/schedule` | Interviewer | Assigned bookings only. Minimal brief from T−24 h to T+24 h. |
| `POST /interviewer/bookings/{id}/start` and `/no-show` | Interviewer | Assigned only. Start needs the provider to show the student joined. No-show needs +10 min and no provider join. |
| `PUT /interviewer/bookings/{id}/outcome` | Interviewer | Assigned only, after start, and before `publish_at`. |
| `GET /admin/board`, `/admin/capacity` | Interview team | The tracker and capacity views, with contacts masked. |
| `POST /admin/bookings`, `/reassign` | Interview team | Books by time, and the server assigns. On a reassign the admin can exclude an interviewer, never choose one. |
| `POST /admin/bookings/{id}/void` | Interview team | Fault must be PLATFORM or INTERVIEWER, and no outcome may exist yet. |
| `POST /admin/cases/*`, `/approvals/*/approve` | Program Admin | Decider ≠ opener. Confirmation needs a co-signer. Approver ≠ requester and ≠ interviewer. |
| `/internal/contest-events`, `/internal/video-webhooks` | System | Private network, mTLS or HMAC signatures, replay protection. |

**Background jobs**

| Job | When | What it does |
| --- | --- | --- |
| Slot materialiser | On every availability change, plus nightly | Builds slots on the 9:00 AM grid, 14 days ahead. The next day's slots go on sale at 8:00 PM IST. |
| Pool release | Every minute | Opens unclaimed DEADLINE and PRIORITY seats to everyone at T−24 h. |
| Reminders | T−24 h, T−1 h, T−10 min | Skips any booking that was cancelled or moved. |
| Attendance check | T+15 min | Interviewer absent: try a swap, otherwise void with priority rebook. Student absent per the provider: mark a no-show. Unclear evidence goes to the team queue. |
| Outcome publisher | Every minute | At `publish_at`, if review allows: publish, award the badge, send Miles to GRIT core. |
| Outcome SLA | +2 h, +12 h, +24 h | Reminds the interviewer twice, then escalates to the team. |
| Cooldown expiry | Every 5 min | Moves journeys to Ready to book. Booking also checks this on the spot, so a late job never blocks a student. |
| Triage SLA | 12 h and 24 h | Escalates an unconfirmed flag at 12 h and releases it automatically at 24 h. |
| Deadline sweep | 1 Jan 2027 at 00:05 IST, then hourly | Closes journeys with no counted badge. Skips pending results, open cases and protected students. |
| Capacity forecast | Daily at 7:00 AM IST | Compares demand with open slots for the next 14 days and the run to 31 Dec. |
| Audit sealer and retention | Every minute and daily | Extends the hash chain. Deletes recordings after 90 days unless a case is open. |

**Load at peak.** At the 8:00 PM release, about 3,000 students refreshing every 15 s produce about 200 slot-list reads per second. The 5-second cache cuts this to about 24 queries per second on the replica. Bookings peak at about 25 per second, and each holds 2 row locks for about 5 ms. SKIP LOCKED sends losers straight to alternative times instead of making them queue.

The real constraint is people. The analysts' two estimates (3,000 and 6,600 students needing a first badge) both exceed what a small team can interview by 31 Dec. The forecast and the tracker make that gap visible from day one.

## 7. Flows as each user sees them

There are five flows, and each runs end to end as that person experiences it. ◆ marks a decision point. Each flow touches only the screens in Section 5 and the endpoints in Section 6.

**Student: from eligible to result**

1. Ravi clears UI Engineering L2 at a campus contest. Within an hour his journey becomes Ready to book, and he gets message M1 in the app, by email and on WhatsApp.
2. Home shows the hero card. He has no badge yet, so it also shows the deadline strip. He taps **Book interview slot**.
3. In the slot picker he chooses Sat 28 Nov, then 7:00 PM, then Continue. On the confirm sheet he ticks the join promise and taps **Confirm booking**.
   - ◆ If the time was just taken, the sheet shows the 3 nearest times inline. One tap retries.
4. Confirmation screen (M2). He adds the interview to his calendar and runs "Test my setup". Reminders arrive at T−24 h, T−1 h and T−10 min.
5. At 6:50 PM the Join button appears. The card now shows his interviewer's first name and his booking code. He enters the lobby. The interviewer checks his face against his registered photo and college ID, confirms the code, and starts.
   - ◆ If the interviewer isn't in by 7:05 PM, he taps "Interviewer hasn't joined". The team swaps someone in, or the booking is voided at 7:15 PM with priority rebook.
6. The 30-min interview runs. His card then shows Result pending: "Your badge date will be 28 Nov."
7. The interviewer submits at 7:37 PM, and the result publishes at 7:52 PM. Every outcome sends the same neutral notification.
   - ◆ Pass: Badge earned, +150 Miles, Qualiflyer #87. If he has cleared the skills, Specialist becomes Ready to book.
   - ◆ Fail, Retake later or No-show: see the next flow.

**Student: change, miss or retry**

1. More than 12 h before the interview: **Reschedule** opens the picker with his current time pinned. The new time is claimed before the old one is released, so he is never left with no booking. After 2 changes, Reschedule is disabled.
2. Less than 12 h before: the only action is **Report an emergency**. The team decides within 1 working day.
   - ◆ Approved: the booking is voided and no attempt is used.
   - ◆ Rejected: it is recorded as a no-show.
3. Not cleared (M3): he sees feedback, focus areas, the date the next attempt opens and the attempts left. Book is disabled until that date. A countdown and practice links take its place.
4. On the unlock date he gets "You can book again". His next interview goes to a different interviewer, who doesn't see his earlier result.
5. ◆ A third counted attempt closes the journey with "Attempt limit reached". The team reviews it within 5 working days. Granting one extra attempt needs two people.

**Interviewer: weekly setup and interview day**

1. On Friday at 5:00 PM, a reminder arrives if next week has under their target hours. In **Availability** they set weekly hours. The preview shows the exact slots on the 9:00 AM grid. The daily cap (8) is read-only.
   - ◆ If removing hours would hit a booked interview: from 24 h out, the system first reassigns at the same time, otherwise the student gets priority rebook. Inside 24 h, they must ask the interview team.
2. At 7:30 AM on interview days a digest lists today's times. Each brief becomes visible 24 h before its interview.
3. At T−10 min they join. They admit the student, tick the photo, college ID and booking-code checks, and tap **Start**.
   - ◆ If the student isn't in by +10 min and the provider shows no join, they can mark a no-show. If the provider shows the student present, that option is blocked.
4. After the interview they fill in **Record outcome**: what happened, the rubric, the result, feedback for the student, and internal notes.
   - ◆ If the result differs from the suggestion, a justification is needed. A Pass against the suggestion waits for a second review.
   - ◆ For an integrity concern they tick the box, and only this result is withheld.
5. They submit. They can edit for 15 min, then the result locks and publishes. Any later change goes to the team as an amendment.

**Interview team: daily operations**

1. At 8:30 AM a digest arrives: Critical and High deadline-risk counts, overdue outcomes, the review queue and the backlog in days.
2. In the **Tracker** they filter to "No badge · Not booked · Risk ≥ High", sort by days since eligible, and send a templated reminder. The server skips anyone reminded in the last 72 h.
3. In **Capacity** they compare each track's not-booked students with its open slots for the next 7 days.
   - ◆ If the gap is more than 2×, they ask qualified interviewers for hours or bulk-open slots. Those go live at the next 8:00 PM release.
4. They work the queues in this order: interviewer no-shows and releases, emergencies, no-show disputes (within 48 h), overdue outcomes, then second reviews.
5. Anything that changes a result, refunds an attempt or overrides a cooldown goes to **Approvals**, where a different Program Admin signs it off.

**Integrity: from flag to nullification**

1. A flag comes from an interviewer, an admin or the contest system, for example impersonation found at the contest where she cleared an L2 skill. The case opens in **Triage**, and only the related result is withheld.
2. A Program Admin who didn't raise the flag reviews it within 24 h.
   - ◆ If confirmed, the student's journeys go On hold. New bookings are blocked, any held badge goes under review and its Miles are frozen. The student sees only "Under review — booking paused".
   - ◆ If not confirmed, the result is released with its original badge date.
3. Investigation uses the recording, the provider's join log and contest proctoring logs. A statement can be requested from the student with a 72 h window.
4. ◆ **Dismiss:** previous states are restored, held results publish with their original badge dates, and if the hold crossed 31 Dec the student gets 10 days of protection.
5. ◆ **Confirm:** the decider records a finding and a second Program Admin co-signs it. The badge is nullified, its Miles are reversed in GRIT core, the leaderboard is recomputed, and higher badges in the track cascade unless the decision keeps them. The student gets the Nullified message. If no badge is left after 31 Dec, the T&C 5.3.5 disqualification applies.

## 8. Security and integrity

The red-team review found 32 gaps in the first drafts: 1 Critical, 9 High, 15 Medium and 7 Low. This design closes all of them. The booking layer was already sound. The real risks were insiders steering or erasing outcomes, attendance evidence the student could create themselves, and single-person power over irreversible actions.

**Threats and controls**

| Threat | Example | Control |
| --- | --- | --- |
| Interviewer collusion (was Critical) | An interviewer adds a lone slot and tells a friend to book it, then passes them | The interviewer is chosen at random among qualified candidates and re-drawn at T−24 h. Slots added inside the window go live only at the next release. Single-candidate, same-campus or instantly booked pairings are tagged for review. Start requires provider proof the student joined. 10% of Passes, and every tagged Pass, get a second review of the recording. Cases can target an interviewer. |
| Shopping for a lenient interviewer | A student reads the interviewer's name and reschedules to re-roll | The interviewer's identity reaches the student only from T−10 min. This is enforced in the API response, not just hidden in the UI. Swaps are silent. |
| Fake attendance | A student taps Join, leaves, and then claims a technical fault | Only video-provider participant events count as attendance. Student-side drops get 1 free Retake later per journey, then they count. Focus areas are not released for an incomplete interview. |
| Erasing a Fail | An interviewer or admin "voids" a recorded Fail as a tech failure | A void is allowed only while no outcome exists and only with a platform or interviewer fault. After that, any change is an amendment that needs a second approver. |
| Sabotage by flag | A rival's flag cancels someone's 28 Dec booking | A flag starts in Triage, which withholds one result and nothing else. A hold needs a Program Admin (not the flagger) within 24 h. Booked interviews still go ahead. A dismissed hold that crossed the deadline grants grace. A circuit breaker trips at more than 10 system flags per hour. |
| Single-person admin power | One admin nullifies a badge, reopens a journey or overrides a cooldown | An `approvals` table enforces approver ≠ requester ≠ interviewer for nullify, disqualify, result changes, reopen (+1 attempt at most), cooldown overrides, repeat waivers, season rules and role grants. |
| Admin picks the interviewer | An on-behalf booking puts a friend with a chosen interviewer | Admin bookings are by time and the server assigns. Reassign can only exclude an interviewer. |
| Broken object access (IDOR) | `GET /bookings/{someone-else}` | Ownership or assignment is checked inside the SQL query, and a miss returns 404. IDs are random UUIDs. Every route × role × foreign object combination is tested in CI. |
| Eligibility spoofing | The client claims "all skills cleared" | Eligibility is recomputed on the server inside the booking transaction from signed contest data. The client sends only `journey_id` and `start_at`. |
| Bots and slot hoarding | A script grabs December slots at the 8:00 PM release | There are no holds, a student can have one upcoming booking, rate limits apply (5 bookings per minute, 20 per day), a challenge appears on anomalies, and the WAF has bot rules. |
| Meeting link sharing or impersonation | A proxy candidate joins on a forwarded link | Join uses per-participant, single-use tokens that expire at end+15 min. The room is capped at 2 people and locks. There is a photo, college ID and code check, plus a room pan and screen share during technical questions. Two devices joining at once raise an alert. |
| Account takeover | A rival with a leaked password cancels someone's interview | A one-time code is required to cancel or reschedule inside 72 h. Every change sends an "Undo" link valid for 30 min, and new-device logins trigger an alert. Support acts only on requests from inside the app. |
| Result or note leaks | A notification or API response reveals a Fail or internal notes | Students and staff get different response shapes. The student response never includes notes, scores, unpublished results or allegations. Every notification uses the same neutral "result is ready" text. |
| Untrusted events | Contest or Miles events arrive tampered or out of order | Events are HMAC-signed with sequence numbers and deduplicated. Badge events are sent one at a time per badge with a version number. GRIT core reconciles daily. |
| Web basics | CSRF, XSS, CSV injection, phishing | SameSite cookies, CSRF tokens and an Origin check. Request schemas are allow-lists. CSV cells are escaped. Messages use templates only, and every link points to the dashboard. |

**Who can do what**

| Action | Student | Interviewer | Interview team | Program Admin | System |
| --- | --- | --- | --- | --- | --- |
| See journeys and results | Own, published only | Assigned: status only | All (tracker) | All | — |
| Book, reschedule, cancel | Own, with guards | — | On behalf, by time, with reason | — | — |
| Emergency, dispute, "interviewer absent" | Own, capped | — | Decide the first one; second person after that | Approve | — |
| Manage availability | — | Own | All, with reason | — | Build slots |
| View student brief | — | Assigned, minimal, T−24 h to T+24 h | Masked | Break-glass, logged | — |
| Start, no-show, record outcome | — | Assigned, provider-evidence gated | Void for platform or interviewer fault only | — | Attendance check at +15 min |
| Change a published result | — | Request | Propose | Approve (not the proposer or interviewer) | Apply |
| Raise a flag | — | Assigned (opens Triage) | Opens Triage | Open; confirm hold | Contest event (opens Triage) |
| Decide a case | — | — | — | Decider ≠ opener, plus co-signer | Execute |
| Reopen, extra attempt, cooldown override | — | — | Request | Approve, +1 attempt at most | — |
| Contacts and recordings | Own | — | — | Break-glass, 60 min, reason | — |
| Season rules and role grants | — | — | — | Propose; a second Program Admin approves; takes effect after 24 h | — |

**Data protection (DPDP Act 2023)**

- An itemised notice and a separate, versioned consent at first booking. It covers why interviews are recorded, how long recordings are kept (90 days, longer only while a case is open), the student's rights, and a contact for data protection questions.
- Data minimisation:
  - The interviewer sees a first name and last initial, a photo and skills, only from T−24 h to T+24 h.
  - Exports never contain contact details.
  - Nothing about an integrity case is ever shown publicly.
- TLS 1.2+ and encryption at rest. Notes, phone numbers and meeting URLs have envelope encryption. There is a breach runbook, and the video, WhatsApp, SMS and email providers are under processor contracts.

**Audit and monitoring**

- The audit log and journey history are append-only and hash-chained. They are anchored daily to write-once storage and verified weekly.
- Every mutation, PII view, export, break-glass session and on-behalf action is logged with the actor, the reason and the request ID.
- Alerts fire on:
  - outlier interviewers: voids, no-show marks and flags, and their Pass rate on single-candidate slots
  - repeat campus pairings
  - more than 5 admin overrides in a day
  - break-glass use
  - a staff login from a new country
  - an audit-chain mismatch
- Every week a Program Admin who wasn't involved reviews the override report.

**Security parameters (one source of truth).** Every number above lives in one season-rules table: cut-offs, cooldowns, caps, windows and rate limits. The API guards, the database checks and the UI copy all read from it, and a CI test checks that they match. This closes the gap the reviewers found most often: documents disagreeing about the rules.

## 9. Multi-agent review log

Six agents worked from one shared brief and state contract. Four designed in parallel, and two reviewers then checked their work. Where the designers disagreed, the lead made the call, and the reviewers checked the result again. The QA reviewer found 52 contradictions (18 High) and the red team found 32 security gaps. All are resolved in Sections 1–8.

| Agent | What it produced | What it caught |
| --- | --- | --- |
| Business analyst | 41 transitions, 72 edge cases, 20 assumptions, 10 open questions, 46 business rules and a capacity model | Cooldowns should run from the interview start, and booking must close later than changes do. Our December capacity covers only about 28% of demand. Defaults were checked against Microsoft and Google certification retake policies. |
| Feature designer | Stories with acceptance criteria for 4 roles, the slot-assignment model, a matrix of 27 notification events, 6 end-to-end flows and an MVP cut | "Pick a time, not an interviewer." Retakes are blind. Notifications must never reveal the result. |
| UI/UX designer | 14 screen specs, before/after tables, the 3 key messages, copy for every state, WCAG 2.2 notes | One status and one action per card. Absolute IST times. Red is never used for a student's result. A nullified badge is never shown publicly. |
| Backend designer | Full PostgreSQL schema, booking and reschedule SQL, a state-machine trigger, architecture, about 40 endpoints, 18 jobs, a threat model | Four layers against double-booking, and outcomes that lock at publish. December load is people-bound, not compute-bound. |
| QA reviewer | A consistency and coverage audit, plus a live test on PostgreSQL 16.15 | 11 of 11 concurrency checks passed. It found two defects: a late-freed slot couldn't be resold, and availability writes could deadlock. Both are fixed. |
| Security reviewer | 32 findings, 20 race scenarios, a controls checklist and the role matrix | The Critical collusion path, self-made attendance evidence, and single-person power over irreversible actions. |

**Where the agents disagreed, and what was decided**

| Topic | Proposed | Decision | Why |
| --- | --- | --- | --- |
| Slot hold | A 120 s hold vs no hold | No hold. A one-step confirm, with 3 alternatives if the time is taken | Holds invite slot hoarding, and there's no payment step to protect. |
| Booking cut-off | 12 h, 3 h, 2 h or 1 h | Booking closes at 3 h (2 h for priority). Changes close at 12 h | Seats freed late can still be used in December. |
| Late cancel | Self-serve (counts as a no-show) vs emergency only | Only "Report an emergency", and the team decides | Fair for real emergencies, without a free-skip loophole. |
| Interviewer identity | Shown after booking vs at join | Shown from T−10 min only | Stops shopping for interviewers and pre-contact. |
| Interviewer brief | Previous results shown vs blind | Blind and minimal | Prevents anchoring, and it's data minimisation. |
| Result publish | After 30 min vs 15 min | 15 min edit window, then lock | A quick fix window without results flip-flopping. |
| Flag effect on a booking | Void it vs let it go ahead | Triage first, and a booked interview goes ahead with its result withheld | One person can't wreck someone's deadline. |
| Two-person rule | Disqualify only vs every irreversible action | Every irreversible or attempt-granting action | Closes 6 High findings. |
| Interviewer assignment | Deterministic least-loaded vs random | Random among candidates, weighted by load, re-drawn at T−24 h | Closes the Critical collusion finding. |
| December pools | 20% priority vs 70% deadline | From 1 Dec: 70% deadline, 20% priority, 10% open. Released at T−24 h | Students with no badge face disqualification, so they come first. |

## Next phase: working prototype

The prototype will be a clickable web app with seeded data. It switches between three roles and shows the Section 5 screens with real state changes.

| Area | In the prototype | Later |
| --- | --- | --- |
| Student | Home (every state), badge detail, slot picker and confirm, confirmation, my interview (join window), result screen, leaderboard and profile. A before/after toggle for each outcome | Device check, emergency uploads, practice links per focus area |
| Interviewer | Availability with slot preview, daily schedule, outcome form with rubric and the publish countdown | Calendar sync, in-call rubric panel |
| Interview team | Tracker with filters and deadline risk, capacity heatmap, approvals queue, integrity case with co-sign | Outlier analytics, dispute second-review workflow |
| Engine | An in-browser state machine that follows Section 1, atomic slot claims, a simulated clock to jump to T−10, +10, +15 min and 31 Dec | A real API on the Section 3 schema |

## Sources

The GRIT pages were fetched on 11 Nov 2026. The industry references were opened by the agents during design.

- GRIT: [How GRIT Works](https://www.grit.niatindia.com/how-grit-works) · [GRIT 2026–27 home](https://www.grit.niatindia.com/) · [Terms & Conditions](https://www.grit.niatindia.com/terms-and-conditions) · [Tracks & Badges sheet](https://docs.google.com/spreadsheets/d/1lcCz7iozkMeUakJOfRtKsxeAWhu5hhHcBtrB4iFdeUM/edit?usp=sharing)
- Retake policies: [Microsoft exam retake policy](https://learn.microsoft.com/credentials/support/retake-policy) · [Google Cloud certification policies](https://support.google.com/cloud-certification/answer/10220719?hl=en)
- Scheduling patterns: [Cal.com round robin](https://cal.com/docs/enterprise-features/teams/round-robin-scheduling) · [Calendly availability settings](https://calendly.com/help/how-to-fine-tune-your-availability-settings) · [GoodTime interview load limits](https://support.goodtime.io/articles/9633009804-team-interview-limits-load-balancing)
- Database: [PostgreSQL btree\_gist](https://www.postgresql.org/docs/14/btree-gist.html) · [PostgreSQL transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html)
- Security and privacy: [OWASP API Security Top 10 (2023)](https://owasp.org/projects/api-security-project) · [IETF Idempotency-Key header draft](https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-idempotency-key-header) · [DPDP Rules 2025, Rule 7](https://www.dpdpa.com/dpdparules/rule7.html) · [DPDP Rules 2025, Rule 8](https://dpdpa.com/dpdparules/rule8.html)
