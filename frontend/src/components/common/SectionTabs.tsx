type TabItem = {
  key: string;
  label: string;
};

type SectionTabsProps = {
  tabs: TabItem[];
  activeKey: string;
  onChange: (key: string) => void;
};

export default function SectionTabs({ tabs, activeKey, onChange }: SectionTabsProps) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-slate-200 pb-3">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => onChange(tab.key)}
          className={`rounded-md px-4 py-2 text-sm font-semibold ${
            activeKey === tab.key ? "bg-[#2f4d9c] text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
