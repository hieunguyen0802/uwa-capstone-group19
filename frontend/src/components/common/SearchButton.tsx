type SearchButtonProps = {
  onClick: () => void;
};

export default function SearchButton({ onClick }: SearchButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center justify-center gap-2 rounded bg-[#2f4d9c] px-4 py-2 text-sm font-semibold text-white hover:bg-[#264183]"
    >
      <span aria-hidden="true">🔍</span>
      Search
    </button>
  );
}
