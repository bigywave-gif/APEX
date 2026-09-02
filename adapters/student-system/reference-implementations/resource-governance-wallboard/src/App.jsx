import { useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts";

const directionRows = [
  ["法律", "未分类", 3],
  ["法律", "金山晓法-法律咨询", 3],
  ["平台", "瀚海平台", 4],
  ["平台", "KClaw", 4],
  ["平台", "用户记忆", 4],
  ["游戏", "模型算法", 5],
  ["游戏", "渲染引擎", 5],
  ["游戏", "资源管理", 6],
  ["平台", "调度平台", 7],
  ["法律", "合规审查", 8],
];

const personnelRows = [
  ["test", 2],
  ["caotingjin", 3],
  ["chenjinfeng2", 3],
  ["duzhihao", 3],
  ["hanhai_admin", 3],
  ["haozhaojun", 4],
  ["htf", 5],
  ["jiangwensen", 6],
  ["待接入", 6],
  ["待接入", 7],
];

const businesses = [
  { name: "法律", used: "3,105h", retained: "8,101h", priority: "高", tone: "critical" },
  { name: "游戏", used: "905h", retained: "1,312h", priority: "中", tone: "warning" },
  { name: "平台", used: "4,579h", retained: "6,138h", priority: "中", tone: "warning" },
];

function useScaleToFit() {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const update = () => setScale(Math.min(window.innerWidth / 1920, window.innerHeight / 1080));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return scale;
}

function AllocationChart() {
  const chartRef = useRef(null);

  useEffect(() => {
    if (!chartRef.current) return undefined;
    const chart = echarts.init(chartRef.current, null, { renderer: "canvas" });
    chart.setOption({
      animationDuration: 1500,
      animationEasing: "cubicOut",
      series: [
        {
          type: "gauge",
          startAngle: 220,
          endAngle: -40,
          center: ["50%", "52%"],
          radius: "92%",
          min: 0,
          max: 100,
          pointer: { show: false },
          progress: { show: false },
          axisLine: {
            roundCap: false,
            lineStyle: {
              width: 86,
              color: [
                [0.54, "#3269c8"],
                [1, "#d84b47"],
              ],
              shadowBlur: 12,
              shadowColor: "rgba(42, 91, 176, .18)",
            },
          },
          splitLine: { show: false },
          axisTick: { show: false },
          axisLabel: { show: false },
          anchor: { show: false },
          detail: { show: false },
          title: { show: false },
          data: [{ value: 100 }],
        },
        {
          type: "gauge",
          startAngle: 220,
          endAngle: -40,
          center: ["50%", "52%"],
          radius: "92%",
          min: 0,
          max: 100,
          pointer: { show: false },
          progress: {
            show: true,
            width: 3,
            itemStyle: { color: "#dbe9ff", shadowBlur: 16, shadowColor: "#ffffff" },
          },
          axisLine: { lineStyle: { width: 0, color: [[1, "transparent"]] } },
          splitLine: { show: false },
          axisTick: { show: false },
          axisLabel: { show: false },
          detail: { show: false },
          data: [{ value: 54 }],
        },
      ],
    });
    const resize = () => chart.resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      chart.dispose();
    };
  }, []);

  return (
    <section className="allocation" aria-label="总卡时 16,252 小时，其中业务使用 8,778 小时，业务闲置 7,474 小时">
      <div ref={chartRef} className="allocation-chart" />
      <div className="allocation-center">
        <strong data-count="16252">16,252h</strong>
        <span>总卡时</span>
      </div>
      <div className="allocation-label used-label">
        <strong>8,778h</strong><span>业务使用</span><b>54.0%</b>
      </div>
      <div className="allocation-label idle-label">
        <strong>7,474h</strong><span>业务闲置</span><b>46.0%</b>
      </div>
      <div className="utilization-pair">
        <div className="utilization warning-util"><strong>14%</strong><span>显卡利用率</span><em>偏低</em></div>
        <div className="utilization"><strong>60%</strong><span>显存利用率</span></div>
      </div>
    </section>
  );
}

function RankMarker({ rank }) {
  return <span className={`rank-marker rank-${rank}`}>{rank}</span>;
}

function DirectionTable({ activeIndex }) {
  return (
    <section className="ranking ranking-direction" aria-labelledby="direction-title">
      <header className="ranking-title">
        <h2 id="direction-title">重点治理方向 <span>TOP10</span></h2>
      </header>
      <div className="ranking-head direction-grid"><span>排名</span><span>业务线 / 方向</span><span>治理评分</span><span>变化</span></div>
      <ol>
        {directionRows.map(([business, name, score], index) => (
          <li key={`${business}-${name}`} className={`direction-grid ${activeIndex === index ? "is-changing" : ""}`}>
            <RankMarker rank={index + 1} />
            <strong>{business}<i>/</i>{name}</strong>
            <b>{score}分</b>
            <span className={`delta ${activeIndex === index ? (index % 2 ? "down" : "up") : ""}`}>{activeIndex === index ? (index % 2 ? "↓1" : "↑1") : "–"}</span>
          </li>
        ))}
      </ol>
      <div className="incoming-row" aria-hidden="true"><span>11</span><span>下一条治理方向</span><span>滚动接入</span></div>
    </section>
  );
}

function PersonnelTable({ activeIndex }) {
  return (
    <section className="ranking ranking-personnel" aria-labelledby="personnel-title">
      <header className="ranking-title">
        <h2 id="personnel-title">重点治理人员 <span>TOP10</span></h2>
      </header>
      <div className="ranking-head personnel-grid"><span>排名</span><span>人员</span><span>治理评分</span><span>变化</span></div>
      <ol>
        {personnelRows.map(([name, score], index) => (
          <li key={`${name}-${index}`} className={`personnel-grid ${activeIndex === index ? "is-changing" : ""}`}>
            <RankMarker rank={index + 1} />
            <strong>{name}</strong>
            <b>{score}分</b>
            <span className={`delta ${activeIndex === index ? (index % 2 ? "down" : "up") : ""}`}>{activeIndex === index ? (index % 2 ? "↓1" : "↑1") : "–"}</span>
          </li>
        ))}
      </ol>
      <div className="incoming-row" aria-hidden="true"><span>11</span><span>下一位治理人员</span><span>滚动接入</span></div>
    </section>
  );
}

export function App() {
  const scale = useScaleToFit();
  const [countdown, setCountdown] = useState(9 * 60 + 43);
  const [activeIndex, setActiveIndex] = useState(6);
  const countdownLabel = useMemo(() => `${Math.floor(countdown / 60)}:${String(countdown % 60).padStart(2, "0")}`, [countdown]);

  useEffect(() => {
    const timer = window.setInterval(() => setCountdown((value) => (value <= 0 ? 9 * 60 + 43 : value - 1)), 1000);
    const rankingTimer = window.setInterval(() => setActiveIndex((value) => (value + 1) % 10), 4200);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(rankingTimer);
    };
  }, []);

  return (
    <div className="viewport-shell">
      <main className="wallboard" style={{ transform: `translate(-50%, -50%) scale(${scale})` }}>
        <header className="topbar">
          <div className="title-block">
            <h1>资源治理晾晒大屏</h1>
            <div className="period"><i className="live-dot" /> <strong>本周</strong><span>2026-07-13 00:00:00 ~ 2026-07-13 21:00:00</span><span>下次刷新&nbsp; {countdownLabel}</span></div>
          </div>
          <p>V1.0 评分 · 效率分 × 治理分 · 总分封顶100</p>
        </header>

        <section className="evidence-grid">
          <article className="governance-conclusion">
            <p className="alert-copy"><span>!</span>低效占用，需要优先治理</p>
            <strong className="idle-number">7,474<small>h</small></strong>
            <h2>业务闲置</h2>
            <p className="conclusion-note">闲置资源未充分利用，<br />导致效率损失</p>
          </article>

          <AllocationChart />

          <section className="business-panel" aria-labelledby="business-title">
            <h2 id="business-title">重点治理业务</h2>
            <div className="business-head"><span>业务线</span><span>使用(卡时)</span><span>保留(卡时)</span><span>优先级</span></div>
            {businesses.map((item) => (
              <article className="business-row" key={item.name}>
                <strong>{item.name}</strong><span>{item.used}</span><span>{item.retained}</span><em className={item.tone}>优先级{item.priority}</em>
              </article>
            ))}
          </section>
        </section>

        <div className="live-scroll"><i />实时滚动<i /></div>
        <section className="rankings-grid">
          <DirectionTable activeIndex={activeIndex} />
          <PersonnelTable activeIndex={(activeIndex + 1) % 10} />
        </section>
      </main>
    </div>
  );
}
