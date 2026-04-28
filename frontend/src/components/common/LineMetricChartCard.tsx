import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type LineMetricChartCardProps = {
  title: string;
  data: Array<Record<string, string | number | null>>;
  dataKey: string;
  legendName: string;
  yDomain: [number, number];
  currentSemesterLabel: string;
  color?: string;
};

export default function LineMetricChartCard({
  title,
  data,
  dataKey,
  legendName,
  yDomain,
  currentSemesterLabel,
  color = "#2f4d9c",
}: LineMetricChartCardProps) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <div className="mb-2 text-base font-semibold text-slate-700">{title}</div>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="semester" />
            <YAxis allowDecimals={false} domain={yDomain} />
            <Tooltip />
            <Legend />
            <Line
              type="monotone"
              dataKey={dataKey}
              stroke={color}
              name={legendName}
              dot={(props: any) => {
                const isCurrent = props?.payload?.semester === currentSemesterLabel;
                return (
                  <circle
                    cx={props.cx}
                    cy={props.cy}
                    r={isCurrent ? 5 : 3}
                    fill={isCurrent ? color : "#ffffff"}
                    stroke={color}
                    strokeWidth={isCurrent ? 2 : 1.5}
                  />
                );
              }}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
