import type { ProfileModalUser } from "../components/common/ProfileModalFieldGrid";

/**
 * Canonical mock “logged-in staff” identity for dashboards until `/me` (or equivalent) supplies real data.
 * Keep in sync wherever profile + outbound messages rely on these fields (e.g. Contact School of Operations).
 */
export const MOCK_DASHBOARD_USER: ProfileModalUser = {
  surname: "Sam",
  firstName: "Yaka",
  employeeId: "2345678",
  title: "Professor",
  department: "Computer Science",
  email: "yaka.sam@uwa.edu.au",
};
