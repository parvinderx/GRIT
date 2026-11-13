"use client";

import { useEffect } from "react";
import { HeroFrame } from "@/components/student/ui/Hero";
import { ButtonLink, btnClass } from "@/components/student/ui/Button";

export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <HeroFrame
      headingId="error-title"
      status={{ tone: "quiet", icon: "Info", text: "Page didn't load" }}
      headline="This page didn't load"
      note={<p>It&apos;s usually temporary. Try again, or go back to your home page.</p>}
      actions={
        <>
          <button type="button" onClick={() => retry()} className={btnClass("outline")}>
            Try again
          </button>
          <ButtonLink kind="link" href="/home">
            Go to your home page
          </ButtonLink>
        </>
      }
    />
  );
}
