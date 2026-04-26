import { type ReactNode } from "react";

type SectionTitleBlockProps = {
  title: string;
  description?: string;
  rightSlot?: ReactNode;
};

export default function SectionTitleBlock({ title, description, rightSlot }: SectionTitleBlockProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className="text-2xl font-semibold text-slate-800">{title}</div>
        {description ? <div className="mt-3 text-sm text-slate-600">{description}</div> : null}
      </div>
      {rightSlot ? <div className="flex items-center gap-3">{rightSlot}</div> : null}
    </div>
  );
}
