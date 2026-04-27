import { type ChangeEvent, type RefObject } from "react";

type TemplateImportExportActionsProps = {
  onDownload: () => void;
  onOpenImport: () => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onImportChange: (event: ChangeEvent<HTMLInputElement>) => void;
};

export default function TemplateImportExportActions({
  onDownload,
  onOpenImport,
  fileInputRef,
  onImportChange,
}: TemplateImportExportActionsProps) {
  return (
    <>
      <button
        type="button"
        onClick={onDownload}
        className="rounded border border-[#2f4d9c] bg-white px-4 py-2 text-sm font-semibold text-[#2f4d9c] hover:bg-[#eef3ff]"
      >
        Download Template
      </button>
      <button
        type="button"
        onClick={onOpenImport}
        className="rounded bg-[#2f4d9c] px-4 py-2 text-sm font-semibold text-white hover:bg-[#264183]"
      >
        Import Template
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={onImportChange}
      />
    </>
  );
}
