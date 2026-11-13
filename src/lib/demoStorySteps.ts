/**
 * Demo stories: user cases for the whole interview workflow, each a fixed list of
 * steps. Shared by the server (src/services/demoStory.ts) and the panel UI.
 * Every story starts from a clean slate ("reset"): Ravi Teja, ready to book his
 * AI Product Mastery Novice interview, on Mon 23 Nov at noon.
 */
export type StoryAction =
  | "reset"
  | "book"
  | "wait"
  | "joinRight"
  | "interviewer"
  | "recordPass"
  | "recordFail"
  | "recordRetake"
  | "recordFaceMismatch"
  | "recordPlatform"
  | "recordUnfair"
  | "editToPass"
  | "publish"
  | "checkHeld"
  | "seeResult"
  | "cooldown"
  | "noshow"
  | "reportAbsent"
  | "absentTimeout"
  | "reschedule"
  | "cancel"
  | "toUnder12h"
  | "reportEmergency"
  | "openApprovals"
  | "openCase"
  | "adminDismiss"
  | "adminConfirm"
  | "failThreeTimes"
  | "pastDeadline";

export type StoryPersona = "student" | "interviewer" | "admin";

export interface StoryStep {
  action: StoryAction;
  title: string;
  /** What happens, in one sentence. */
  body: string;
  as: StoryPersona;
}

export interface Scenario {
  id: string;
  group: "Core outcomes" | "Joining" | "Integrity" | "Called off and changes" | "Limits";
  title: string;
  /** One line: who and what. */
  summary: string;
  steps: StoryStep[];
}

const START: StoryStep = { action: "reset", title: "Ravi is ready to book", body: "All skills cleared for AI Product Mastery Novice. The clock goes back to Mon 23 Nov, noon.", as: "student" };
const BOOK: StoryStep = { action: "book", title: "Ravi books an interview", body: "He picks the first open time a day or more away. The system assigns an interviewer.", as: "student" };
const WAIT: StoryStep = { action: "wait", title: "The day arrives", body: "Two hours before. Ravi's home page counts down live.", as: "student" };
const JOIN: StoryStep = { action: "joinRight", title: "Ravi joins", body: "Join opens 10 minutes before. He ticks the readiness checks and joins; his booking code is shown so he can read it out.", as: "student" };
const IV_JOIN: StoryStep = { action: "interviewer", title: "The interviewer joins the room", body: "Their Today page shows the live interview. The room shows the code was verified at join.", as: "interviewer" };
const PUBLISH: StoryStep = { action: "publish", title: "Ravi gets his result", body: "Results publish 15 minutes after they're recorded.", as: "student" };

export const SCENARIOS: Scenario[] = [
  {
    id: "badge",
    group: "Core outcomes",
    title: "Earns the badge",
    summary: "Books, joins with his code, passes, gets the badge and Miles.",
    steps: [START, BOOK, WAIT, JOIN, IV_JOIN, { action: "recordPass", title: "The interviewer records a Pass", body: "Face matches, every skill scored, result Pass.", as: "interviewer" }, PUBLISH],
  },
  {
    id: "retry",
    group: "Core outcomes",
    title: "Not cleared, tries again",
    summary: "Fails with feedback, waits 14 days, books again.",
    steps: [
      START, BOOK, WAIT, JOIN, IV_JOIN,
      { action: "recordFail", title: "The interviewer records a Fail", body: "With written feedback and two focus areas for the student.", as: "interviewer" },
      { ...PUBLISH, body: "He sees 'Not cleared', the feedback, and when he can try again. One attempt is used." },
      { action: "cooldown", title: "The wait is over", body: "Time jumps 14 days. Booking opens again.", as: "student" },
      { ...BOOK, title: "Ravi books his second attempt" },
    ],
  },
  {
    id: "retake",
    group: "Core outcomes",
    title: "Retake later",
    summary: "The interviewer asks for a retake: no attempt used, 3-day wait.",
    steps: [
      START, BOOK, WAIT, JOIN, IV_JOIN,
      { action: "recordRetake", title: "The interviewer asks for a retake", body: "The connection dropped; the interviewer picks Retake later with feedback.", as: "interviewer" },
      { ...PUBLISH, body: "He sees 'Retake later'. It doesn't use an attempt." },
      { action: "cooldown", title: "Three days later", body: "Booking opens again.", as: "student" },
    ],
  },
  {
    id: "missed",
    group: "Core outcomes",
    title: "Misses the interview",
    summary: "Never joins. The attendance check counts it as a missed attempt.",
    steps: [
      START, BOOK, WAIT,
      { action: "noshow", title: "Ravi never joins", body: "Time passes 15 minutes beyond the start. The attendance check marks it missed: 1 attempt used, 7-day wait.", as: "student" },
      { action: "cooldown", title: "A week later", body: "Booking opens again.", as: "student" },
    ],
  },
  {
    id: "no-interviewer",
    group: "Joining",
    title: "The interviewer doesn't turn up",
    summary: "Ravi reports it; we try a swap, and at 15 minutes past it's called off with priority rebooking.",
    steps: [
      START, BOOK, WAIT, JOIN,
      { action: "reportAbsent", title: "Ravi reports the interviewer is missing", body: "Five minutes after the start he presses 'My interviewer hasn't joined'. The team is alerted and someone free at the same time is swapped in if possible.", as: "student" },
      { action: "absentTimeout", title: "Nobody joins by 15 minutes past", body: "The attendance check calls the interview off. No attempt is used and Ravi gets priority rebooking.", as: "student" },
      { action: "seeResult", title: "Ravi can rebook first", body: "His home page explains it wasn't his fault and offers priority booking.", as: "student" },
    ],
  },
  {
    id: "face-dismissed",
    group: "Integrity",
    title: "Face doesn't match, case dismissed",
    summary: "The result is held, the team checks, it was him: the Pass is released.",
    steps: [
      START, BOOK, WAIT, JOIN, IV_JOIN,
      { action: "recordFaceMismatch", title: "Face doesn't match", body: "The interviewer records a Pass but answers 'Doesn't match' on the face check. It still submits.", as: "interviewer" },
      { action: "checkHeld", title: "Ravi sees 'Result pending'", body: "Even after the 15 minutes, the result is held. It isn't published.", as: "student" },
      { action: "openCase", title: "The interview team opens the case", body: "A case was opened automatically, with the reason and the held result.", as: "admin" },
      { action: "adminDismiss", title: "The team dismisses it", body: "It was the right person. The held Pass is released at once.", as: "admin" },
      { action: "seeResult", title: "Ravi gets his badge", body: "The Pass publishes as normal.", as: "student" },
    ],
  },
  {
    id: "face-confirmed",
    group: "Integrity",
    title: "Face doesn't match, case confirmed",
    summary: "The team confirms it wasn't him: the interview counts as not cleared.",
    steps: [
      START, BOOK, WAIT, JOIN, IV_JOIN,
      { action: "recordFaceMismatch", title: "Face doesn't match", body: "The interviewer records a Pass but answers 'Doesn't match' on the face check.", as: "interviewer" },
      { action: "checkHeld", title: "Ravi sees 'Result pending'", body: "The result is held.", as: "student" },
      { action: "openCase", title: "The interview team opens the case", body: "The reason and the held Pass are on the case page.", as: "admin" },
      { action: "adminConfirm", title: "The team confirms it", body: "Not the right person. The interview counts as Not cleared: 1 attempt, 14-day wait.", as: "admin" },
      { action: "seeResult", title: "Ravi sees 'Not cleared'", body: "With a neutral note pointing to the rules.", as: "student" },
    ],
  },
  {
    id: "platform",
    group: "Called off and changes",
    title: "Couldn't finish fairly",
    summary: "The call breaks down mid-interview: no attempt used, priority rebooking.",
    steps: [
      START, BOOK, WAIT, JOIN, IV_JOIN,
      { action: "recordUnfair", title: "The interviewer stops the interview", body: "It couldn't finish fairly. No attempt is used.", as: "interviewer" },
      { action: "seeResult", title: "Ravi rebooks with priority", body: "His home page explains and offers priority booking.", as: "student" },
    ],
  },
  {
    id: "changes",
    group: "Called off and changes",
    title: "Reschedules, then cancels",
    summary: "Uses both free changes, then books fresh.",
    steps: [
      START, BOOK,
      { action: "reschedule", title: "Ravi moves his interview", body: "He picks a later day. One of his two free changes is used.", as: "student" },
      { action: "cancel", title: "Ravi cancels", body: "The second free change. Cancelling doesn't count as an attempt.", as: "student" },
      { ...BOOK, title: "He books again", body: "A new booking comes with two fresh free changes." },
    ],
  },
  {
    id: "emergency",
    group: "Called off and changes",
    title: "Emergency on the day",
    summary: "Inside 12 hours changes are closed; he reports an emergency instead.",
    steps: [
      START, BOOK,
      { action: "toUnder12h", title: "Six hours before", body: "Changes are closed now.", as: "student" },
      { action: "reportEmergency", title: "Ravi reports an emergency", body: "With a short reason. It goes to the interview team.", as: "student" },
      { action: "openApprovals", title: "The team sees it in Approvals", body: "An emergency waiver request is waiting for a decision.", as: "admin" },
    ],
  },
  {
    id: "edit",
    group: "Core outcomes",
    title: "Interviewer corrects an outcome",
    summary: "Records a Fail, changes it to Pass inside the 15-minute window.",
    steps: [
      START, BOOK, WAIT, JOIN, IV_JOIN,
      { action: "recordFail", title: "The interviewer records a Fail", body: "By mistake.", as: "interviewer" },
      { action: "editToPass", title: "They change it to Pass", body: "Inside the 15-minute edit window. The publish time doesn't move.", as: "interviewer" },
      { ...PUBLISH, body: "The corrected Pass is what Ravi sees." },
    ],
  },
  {
    id: "limit",
    group: "Limits",
    title: "Runs out of attempts",
    summary: "Three interviews not cleared: booking closes for this badge.",
    steps: [
      START,
      { action: "failThreeTimes", title: "Three attempts, none cleared", body: "Book, join, Fail, wait; three times over. The third result closes booking.", as: "student" },
    ],
  },
  {
    id: "deadline",
    group: "Limits",
    title: "Misses the season deadline",
    summary: "Never books before 31 Dec: booking closes.",
    steps: [
      START,
      { action: "pastDeadline", title: "The deadline passes", body: "Time jumps past 31 Dec. Without a badge, booking closes for the season.", as: "student" },
    ],
  },
];

export interface StoryFacts {
  clockIso: string;
  journeyState: string;
  interviewerName: string | null;
  bookingId: string | null;
}
