import { type ReactNode } from "react";

type FilterFormField = {
  key: string;
  label: string;
  input: ReactNode;
};

type FilterFormRowProps = {
  fields: FilterFormField[];
  action?: ReactNode;
  gridClassName?: string;
};

export default function FilterFormRow({
  fields,
  action,
  gridClassName = "grid grid-cols-1 gap-4 md:grid-cols-[1fr_1fr_1fr_auto]",
}: FilterFormRowProps) {
  return (
    <div className={gridClassName}>
      {fields.map((field) => (
        <div key={field.key} className="flex flex-col gap-1">
          <div className="w-fit rounded bg-[#2f4d9c] px-3 py-1 text-xs font-bold text-white">{field.label}</div>
          {field.input}
        </div>
      ))}
      {action ? <div className="flex items-end justify-end">{action}</div> : null}
    </div>
  );
}
