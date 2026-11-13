import { redirect } from "next/navigation";

// Confirm is now inline on the booking screen (single-screen flow); keep this
// route as a redirect so any old link still lands somewhere sensible.
export default async function ConfirmRedirect({ params }: { params: Promise<{ journeyId: string }> }) {
  const { journeyId } = await params;
  redirect(`/book/${journeyId}`);
}
