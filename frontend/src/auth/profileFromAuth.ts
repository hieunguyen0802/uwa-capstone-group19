import type { ProfileModalUser } from "../components/common/ProfileModalFieldGrid";
import type { AuthProfile } from "../api/auth";

/**
 * Map the auth profile from /api/auth/me/ into the shape the existing
 * ProfileModalFieldGrid expects. Centralised so every dashboard page can
 * use a one-liner instead of re-deriving fields per page.
 */
export function profileFromAuth(profile: AuthProfile | null): ProfileModalUser {
  if (!profile) {
    return { employeeId: "", firstName: "", surname: "", department: "", title: "" };
  }
  const [firstName = "", ...rest] = (profile.full_name ?? "").split(" ");
  const surname = rest.join(" ");
  return {
    employeeId: profile.staff_number,
    firstName,
    surname,
    department: profile.department ?? "",
    title: profile.title ?? "",
    email: profile.email,
  };
}
