type ReportingFilterIntroProps = {
  title: string;
  description: string;
};

export default function ReportingFilterIntro({ title, description }: ReportingFilterIntroProps) {
  return (
    <>
      <div className="text-2xl font-semibold text-[#2f4d9c]">{title}</div>
      <div className="mt-2 text-base text-[#2f4d9c]">{description}</div>
    </>
  );
}
