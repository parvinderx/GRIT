import { AppHeader } from "./AppHeader";

/** Student app shell: slim header, then a single reading column that widens on desktop.
 *  `.student` scopes the student type, colours and focus ring (staff screens are untouched). */
export function StudentShell({
  miles,
  initials,
  children,
}: {
  miles: number;
  initials: string;
  children: React.ReactNode;
}) {
  return (
    <div className="student min-h-dvh">
      <AppHeader miles={miles} initials={initials} />
      <main id="main" className="mx-auto max-w-[1120px] px-4 pb-20 pt-6 sm:px-6 lg:px-8 lg:pt-8">
        {children}
      </main>
    </div>
  );
}
