import InfoField from "./InfoField";

export type ProfileModalUser = {
  employeeId: string;
  firstName: string;
  surname: string;
  department: string;
  title: string;
  email?: string;
};

type ProfileModalFieldGridProps = {
  user: ProfileModalUser;
};

/**
 * Canonical profile identity grid shared by all dashboard Profile modals.
 */
export default function ProfileModalFieldGrid({ user }: ProfileModalFieldGridProps) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <InfoField label="Staff ID" value={user.employeeId} />
      <InfoField label="Department" value={user.department} />
      <InfoField label="First name" value={user.firstName} />
      <InfoField label="Last name" value={user.surname} />
      <InfoField label="Title" value={user.title} />
      <InfoField label="Email" value={user.email ?? ""} />
    </div>
  );
}
