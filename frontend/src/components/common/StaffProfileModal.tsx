export type StaffProfileDraft = {
  id: number;
  staffId: string;
  firstName: string;
  lastName: string;
  email: string;
  title: string;
  department: string;
  isActive: "Active" | "Inactive";
};

type StaffProfileModalProps = {
  open: boolean;
  draft: StaffProfileDraft | null;
  departments: string[];
  error: string;
  onClose: () => void;
  onFieldChange: (field: keyof StaffProfileDraft, value: string) => void;
  onUpdate: () => void;
};

export default function StaffProfileModal({
  open,
  draft,
  departments,
  error,
  onClose,
  onFieldChange,
  onUpdate,
}: StaffProfileModalProps) {
  if (!open || !draft) return null;

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-md bg-white shadow-lg">
        <div className="flex items-center justify-between rounded-t-md bg-[#2f4d9c] px-5 py-3 text-white">
          <div className="text-base font-bold">Staff Profile</div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded bg-white/10 text-lg hover:bg-white/20"
          >
            ×
          </button>
        </div>
        <div className="space-y-4 p-5">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <div className="mb-1 text-xs font-semibold uppercase text-slate-500">staff_id</div>
              <input
                value={draft.staffId}
                onChange={(e) => onFieldChange("staffId", e.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <div className="mb-1 text-xs font-semibold uppercase text-slate-500">email</div>
              <input
                value={draft.email}
                onChange={(e) => onFieldChange("email", e.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <div className="mb-1 text-xs font-semibold uppercase text-slate-500">first_name</div>
              <input
                value={draft.firstName}
                onChange={(e) => onFieldChange("firstName", e.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <div className="mb-1 text-xs font-semibold uppercase text-slate-500">last_name</div>
              <input
                value={draft.lastName}
                onChange={(e) => onFieldChange("lastName", e.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <div className="mb-1 text-xs font-semibold uppercase text-slate-500">title</div>
              <input
                value={draft.title}
                onChange={(e) => onFieldChange("title", e.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <div className="mb-1 text-xs font-semibold uppercase text-slate-500">department</div>
              <select
                value={draft.department}
                onChange={(e) => onFieldChange("department", e.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">Select Department</option>
                {departments.map((department) => (
                  <option key={`modal-${department}`} value={department}>
                    {department}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Active Status</div>
              <select
                value={draft.isActive}
                onChange={(e) => onFieldChange("isActive", e.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </div>
          </div>
          {error ? <div className="text-sm font-semibold text-[#dc2626]">{error}</div> : null}
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onUpdate}
              className="rounded bg-[#2f4d9c] px-4 py-2 text-sm font-semibold text-white hover:bg-[#264183]"
            >
              Update
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
