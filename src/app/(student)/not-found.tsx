import { HeroFrame } from "@/components/student/ui/Hero";
import { ButtonLink } from "@/components/student/ui/Button";

export default function NotFound() {
  return (
    <HeroFrame
      headingId="nf-title"
      status={{ tone: "quiet", icon: "Info", text: "Not found" }}
      headline="We couldn't find that page"
      note={<p>The booking or interview may have been removed, or the link is wrong or belongs to someone else.</p>}
      actions={
        <ButtonLink kind="outline" href="/home">
          Go to your home page
        </ButtonLink>
      }
    />
  );
}
