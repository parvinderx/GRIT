/** Cookie that remembers the staff sidebar state. Kept out of the "use client"
 *  sidebar file: a server component importing a value from a client module gets
 *  a client reference, not the string. */
export const SIDEBAR_COOKIE = "grit_sidebar";
