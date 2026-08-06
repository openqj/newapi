import { ArcElement, CategoryScale, Chart as ChartJS, Filler, Legend, LineElement, LinearScale, PointElement, Tooltip } from "chart.js";
import { Doughnut, Line } from "react-chartjs-2";

ChartJS.register(ArcElement, CategoryScale, Filler, Legend, LineElement, LinearScale, PointElement, Tooltip);

type DashboardModel = { model: string; requests: number; tokens: number; cost: number };
type DashboardTrend = { label: string; tokens: number };

type DashboardChartsProps = {
  models: DashboardModel[];
  trend: DashboardTrend[];
  granularity: "day" | "hour";
  formatNumber: (value?: number) => string;
};

const colors = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"];
const formatMoney = (value?: number) => value == null ? "-" : `${value.toFixed(4)} 额度`;

export function DashboardCharts({ models, trend, granularity, formatNumber }: DashboardChartsProps) {
  return <section className="sub2-dashboard-chart-grid">
    <article className="sub2-panel sub2-dashboard-chart-card"><div className="sub2-panel-heading"><div><h2>模型用量</h2><p>所选时间范围内的模型分布</p></div></div><div className="sub2-dashboard-distribution">{models.length ? <div className="sub2-dashboard-doughnut"><Doughnut data={{ labels: models.map((item) => item.model), datasets: [{ data: models.map((item) => item.tokens), backgroundColor: colors, borderWidth: 0 }] }} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }} /></div> : <div className="sub2-dashboard-no-chart">暂无可用数据</div>}<div className="sub2-dashboard-model-table"><table><thead><tr><th>模型</th><th>请求</th><th>Tokens</th><th>实际费用</th></tr></thead><tbody>{models.map((item, index) => <tr key={item.model}><td><i style={{ background: colors[index] }} />{item.model}</td><td>{formatNumber(item.requests)}</td><td>{formatNumber(item.tokens)}</td><td>{formatMoney(item.cost)}</td></tr>)}{!models.length && <tr><td colSpan={4}>暂无使用记录</td></tr>}</tbody></table></div></div></article>
    <article className="sub2-panel sub2-dashboard-chart-card"><div className="sub2-panel-heading"><div><h2>Token 使用趋势</h2><p>{granularity === "day" ? "按天" : "按小时"}汇总</p></div></div><div className="sub2-dashboard-line">{trend.length ? <Line data={{ labels: trend.map((item) => item.label), datasets: [{ data: trend.map((item) => item.tokens), fill: true, borderColor: "#2563eb", backgroundColor: "rgba(37, 99, 235, .10)", pointRadius: 2, tension: .35 }] }} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 6 } }, y: { beginAtZero: true, ticks: { callback: (value) => formatNumber(Number(value)) } } } }} /> : <div className="sub2-dashboard-no-chart">暂无可用数据</div>}</div></article>
  </section>;
}
