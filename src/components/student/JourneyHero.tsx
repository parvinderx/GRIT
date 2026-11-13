import { VIEW, resolveAction, type JourneyCtx, type ResolvedAction } from "@/lib/journey/statusConfig";
import { STUDENT_STATUS, HERO_ASIDE, heroKind } from "@/lib/journey/studentHero";
import { buildRoute } from "@/lib/journey/route";
import type { ViewState, ActionKey, JourneyState } from "@/lib/state-machine";
import { HeroFrame } from "./ui/Hero";
import { Route } from "./ui/Route";
import { ButtonLink } from "./ui/Button";
import { Achievement } from "./ui/Achievement";
import { LiveCountdown } from "./ui/LiveCountdown";
import { JOIN_OPEN_MINUTES } from "@/lib/rules";

function ActionLink({ a, primary }: { a: ResolvedAction; primary: boolean }) {
  if (!a.href) return null;
  return (
    <ButtonLink kind={primary ? heroKind(a.variant) : "link"} href={a.href} download={a.download}>
      {a.label}
    </ButtonLink>
  );
}

/** The dashboard hero for one journey: one status, one fact, one next action, the route beside it. */
export function JourneyHero({
  state,
  viewState,
  ctx,
  allowed,
  skillsCleared,
  skillsTotal,
  bookingStartIso,
  serverNowIso,
  trackCode,
  badgeLevel,
  as = "h1",
}: {
  state: JourneyState;
  viewState: ViewState;
  ctx: JourneyCtx;
  allowed: ActionKey[];
  skillsCleared: number;
  skillsTotal: number;
  /** Booked states only: drives the live countdown. */
  bookingStartIso?: string | null;
  serverNowIso?: string;
  /** For the earned medal beside a Pass. */
  trackCode?: string;
  badgeLevel?: number;
  as?: "h1" | "h2";
}) {
  const def = VIEW[viewState];
  const primary = def.primary ? resolveAction(def.primary, ctx, allowed) : null;
  const secondary = def.secondary
    .map((k) => resolveAction(k, ctx, allowed))
    .filter((a): a is ResolvedAction => !!a && !!a.href)
    .slice(0, 2);
  const extra =
    viewState === "ELIGIBLE_READY" ? [{ key: "expect", label: "What happens in the interview", href: `/badge/${ctx.journeyId}` }] : [];

  // A live countdown only while an interview is booked and still ahead.
  const booked = viewState === "BOOKED_SCHEDULED" || viewState === "BOOKED_UNDER_12H" || viewState === "BOOKED_LIVE_NOW";
  const countdown =
    booked && bookingStartIso && serverNowIso ? (
      <LiveCountdown
        className="mt-6"
        targetIso={bookingStartIso}
        serverNowIso={serverNowIso}
        alsoRefreshAtIso={new Date(new Date(bookingStartIso).getTime() - JOIN_OPEN_MINUTES * 60_000).toISOString()}
        label="Your interview starts in"
        doneText="Your interview has started. It's on your interview page."
      />
    ) : null;

  const asideKind = HERO_ASIDE[viewState];
  const aside =
    asideKind === "route" ? (
      <Route title={ctx.badgeName} stops={buildRoute({ state, ctx, skillsCleared, skillsTotal })} />
    ) : asideKind === "badge" ? (
      <Achievement
        track={trackCode ?? ""}
        trackName={ctx.badgeName.split("·")[0]?.trim() ?? ""}
        level={badgeLevel ?? 1}
        levelName={ctx.badgeName.split("·")[1]?.trim() ?? ""}
        miles={ctx.miles}
        earnedOn={ctx.interviewDateLongHuman}
        isNew={!!ctx.earnedRecently}
      />
    ) : undefined;

  return (
    <HeroFrame
      as={as}
      headingId="hero-title"
      status={STUDENT_STATUS[viewState](ctx)}
      headline={def.title(ctx)}
      mark={primary?.variant === "saffron" && !!primary.href}
      note={
        <>
          <p>{def.body(ctx)}</p>
          {viewState === "PASSED" && ctx.firstBadge && (
            <p className="mt-2 font-bold text-graphite">You&apos;re now a Qualiflyer.</p>
          )}
          {countdown}
        </>
      }
      actions={
        primary || secondary.length || extra.length || (viewState === "PASSED" && ctx.nextBadgeName) ? (
          <>
            {primary && <ActionLink a={primary} primary />}
            {secondary.map((a) => (
              <ActionLink key={a.key} a={a} primary={false} />
            ))}
            {extra.map((l) => (
              <ButtonLink key={l.key} kind="link" href={l.href}>
                {l.label}
              </ButtonLink>
            ))}
            {viewState === "PASSED" && ctx.nextBadgeName && (
              <ButtonLink kind="link" href={ctx.nextBadgeJourneyId ? `/badge/${ctx.nextBadgeJourneyId}` : "/tracks"}>
                What&apos;s next: {ctx.nextBadgeName}
              </ButtonLink>
            )}
          </>
        ) : undefined
      }
      aside={aside}
    />
  );
}
