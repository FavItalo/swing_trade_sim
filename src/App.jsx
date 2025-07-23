import { useEffect, useState, useRef, useMemo } from "react";
import { Line, Chart as ChartComponent } from "react-chartjs-2";
import {
  Chart as ChartJS,
  LineElement,
  CategoryScale,
  LinearScale,
  PointElement,
  Tooltip,
  Legend,
  TimeScale,
  TimeSeriesScale,
} from "chart.js";
import {
  CandlestickController,
  CandlestickElement,
} from "chartjs-chart-financial/dist/chartjs-chart-financial.esm.js";
import "./App.css";

/* ---------------- ChartJS registration ---------------- */
ChartJS.register(
  LineElement,
  CategoryScale,
  LinearScale,
  PointElement,
  Tooltip,
  Legend,
  CandlestickController,
  CandlestickElement,
  TimeScale,
  TimeSeriesScale
);

/* ----------------------- Helpers ----------------------- */
function generatePrice(prev, mu, sigma) {
  const dt = 1;
  const epsilon = Math.random() * 2 - 1; // ~U(-1,1)
  return prev * Math.exp((mu - 0.5 * sigma ** 2) * dt + sigma * Math.sqrt(dt) * epsilon);
}

function generateInitialPrices(len, start, mu, sigma) {
  const arr = [start];
  for (let i = 1; i < len; i++) arr.push(generatePrice(arr[i - 1], mu, sigma));
  return arr;
}

// SMA & EMA
function sma(data, window) {
  if (data.length < window) return [];
  const out = [];
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i];
    if (i >= window) sum -= data[i - window];
    if (i >= window - 1) out.push(sum / window);
  }
  return out;
}
function ema(data, window) {
  if (!data.length) return [];
  const k = 2 / (window + 1);
  const out = [data[0]];
  for (let i = 1; i < data.length; i++) out.push(data[i] * k + out[i - 1] * (1 - k));
  return out;
}

// Build candles grouping N ticks
function buildCandles(prices, group = 5) {
  const candles = [];
  for (let i = 0; i < prices.length; i += group) {
    const slice = prices.slice(i, i + group);
    if (!slice.length) break;
    const o = slice[0];
    const c = slice[slice.length - 1];
    const h = Math.max(...slice);
    const l = Math.min(...slice);
    candles.push({ x: i, o, h, l, c });
  }
  return candles;
}

/* ----------------------- Store items ----------------------- */
const THEMES = {
  "dark-default": {
    id: "dark-default",
    label: "Dark Mode",
    bg: "#000000",
    fg: "#ffffff",
    isDark: true,
    iconStyle: { background: "linear-gradient(135deg, #000 50%, #fff 50%)" },
    price: 0,
    type: "theme",
  },
  "dark-purple": {
    id: "dark-purple",
    label: "Purple Dark",
    bg: "#000000",
    fg: "#8b5cf6",
    isDark: true,
    iconStyle: { background: "linear-gradient(135deg, #000 50%, #8b5cf6 50%)" },
    price: 5,
    type: "theme",
  },
  "dark-green": {
    id: "dark-green",
    label: "Green Dark",
    bg: "#000000",
    fg: "#10b981",
    isDark: true,
    iconStyle: { background: "linear-gradient(135deg, #000 50%, #10b981 50%)" },
    price: 5,
    type: "theme",
  },
  "light-moss": {
    id: "light-moss",
    label: "Moss Light",
    bg: "#ffffff",
    fg: "#6b8e23",
    isDark: false,
    iconStyle: { background: "linear-gradient(135deg, #fff 50%, #6b8e23 50%)" },
    price: 5,
    type: "theme",
  },
};

const CHART_MODELS = {
  line:   { id: "line",   label: "Line",   price: 0,  type: "chart", iconStyle: { background: "linear-gradient(135deg, #fff 50%, #000 50%)" } },
  candle: { id: "candle", label: "Candle", price: 25, type: "chart", iconStyle: { background: "linear-gradient(135deg, #16a34a 50%, #ef4444 50%)" } },
};

const STATS_ITEMS = {
  sma_short: { id: "sma_short", label: "SMA Short", price: 5, type: "stat" },
  ema_mid:   { id: "ema_mid",   label: "EMA",       price: 5, type: "stat" },
  sma_long:  { id: "sma_long",  label: "SMA Long",  price: 5, type: "stat" },
};

const SHOP_ITEMS = [
  ...Object.values(THEMES).filter(t => t.price > 0),
  ...Object.values(CHART_MODELS).filter(c => c.price > 0),
  ...Object.values(STATS_ITEMS),
];

/* ----------------------- App ----------------------- */
export default function App() {
  // Initial lengths depending on chart type
  const LINE_INIT = 10;
  const CANDLE_INIT = 50; // 5x more

  // Game state
  const [prices, setPrices] = useState(() => generateInitialPrices(LINE_INIT, 100, 0.001, 0.01));
  const [balance, setBalance] = useState(100);
  const [portfolio, setPortfolio] = useState(0);
  const [timeLeft, setTimeLeft] = useState(60);
  const [mu, setMu] = useState(0.001);
  const [sigma, setSigma] = useState(0.1);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const [initialClick, setInitialClick] = useState(false);

  // UI / effects
  const [floatingTexts, setFloatingTexts] = useState([]);
  const [purchasePercent, setPurchasePercent] = useState(50);

  // Popups
  const [showSettings, setShowSettings] = useState(false);
  const [showShop, setShowShop] = useState(false);

  // Economy / unlockables
  const [savedCoins, setSavedCoins] = useState(0);
  const [unlockedThemes, setUnlockedThemes] = useState(["dark-default"]);
  const [selectedThemeId, setSelectedThemeId] = useState("dark-default");

  const [unlockedCharts, setUnlockedCharts] = useState(["line"]);
  const [selectedChart, setSelectedChart] = useState("line");

  const [unlockedStats, setUnlockedStats] = useState([]);
  const [enabledStats, setEnabledStats] = useState([]);

  const containerRef = useRef(null);

  const selectedTheme = THEMES[selectedThemeId];
  const isDark = selectedTheme.isDark;

  /* --------- Price updates / drift / volatility --------- */
  useEffect(() => {
    const tickMs    = selectedChart === "candle" ? 333 : 1000; // 3x faster for candles
    const maxPoints = selectedChart === "candle" ? 300 : 100;  // 3x more points

    const interval = setInterval(() => {
      setPrices(prev => {
        const next = generatePrice(prev[prev.length - 1], mu, sigma);
        const updated = [...prev, next];
        return updated.slice(-maxPoints);
      });
      // momentum & heteroskedasticity
      setMu(m => m + (Math.random() - 0.5) / 500);
      if (Math.random() < 0.3) setSigma(Math.random() / 25);
    }, tickMs);

    return () => clearInterval(interval);
  }, [mu, sigma, selectedChart]);

  // Ensure initial data size increases when switching to candle
  useEffect(() => {
    if (selectedChart === "candle" && prices.length < CANDLE_INIT) {
      setPrices(prev => {
        let p = [...prev];
        while (p.length < CANDLE_INIT) {
          p.push(generatePrice(p[p.length - 1], mu, sigma));
        }
        return p;
      });
    }
  }, [selectedChart, prices.length, mu, sigma]);

  /* ------------------------ Timer --------------------------- */
  // Interval-only timer to avoid being cancelled by fast renders
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setTimeLeft(t => (t > 0 ? t - 1 : 0));
    }, 1000);
    return () => clearInterval(id);
  }, [running]);

  // When timer hits 0, finish the game
  useEffect(() => {
    if (!running || timeLeft > 0) return;
    const finalPrice = prices[prices.length - 1];
    const earned = portfolio * finalPrice;
    const newBalance = balance + earned;
    const profitPct = (newBalance - 100) / 100;
    if (profitPct > 0) setSavedCoins(c => c + profitPct * 100);

    setBalance(newBalance);
    setPortfolio(0);
    setRunning(false);
    setFinished(true);
  }, [running, timeLeft, prices, portfolio, balance]);

  /* -------------------- Derived data ------------------------- */
  const candles = useMemo(() => buildCandles(prices, 5), [prices]);
  const smaShortArr = useMemo(() => sma(prices, 5), [prices]);
  const smaLongArr  = useMemo(() => sma(prices, 20), [prices]);
  const emaArr      = useMemo(() => ema(prices, 12), [prices]);

  /* -------------------- Interactions ------------------------- */
  const handleClick = (e) => {
    if (showSettings || showShop || finished) return; // Block when popup or finished

    const bounds = containerRef.current.getBoundingClientRect();
    const clickX = e.clientX - bounds.left;
    const width = bounds.width;
    const price = prices[prices.length - 1];
    const x = e.clientX;
    const y = e.clientY;

    // First right-click starts the game
    if (!initialClick && clickX > width / 2) {
      setInitialClick(true);
      setRunning(true);
      setTimeLeft(60);
      return;
    }
    if (!running || !initialClick) return;

    // Right = buy
    if (clickX > width / 2) {
      if (balance >= 10) {
        const amount = (balance * (purchasePercent / 100)) / price;
        const spent = amount * price;
        setBalance(b => b - spent);
        setPortfolio(p => p + amount);
        createFloatingText(x, y, `-$${spent.toFixed(2)}`, "red");
      }
    } else {
      // Left = sell all
      if (portfolio > 0) {
        const earned = portfolio * price;
        setBalance(b => b + earned);
        setPortfolio(0);
        createFloatingText(x, y, `+$${earned.toFixed(2)}`, "green");
      }
    }
  };

  const createFloatingText = (x, y, text, color) => {
    const id = Date.now();
    setFloatingTexts(prev => [...prev, { id, x, y, text, color }]);
    setTimeout(() => setFloatingTexts(prev => prev.filter(t => t.id !== id)), 1000);
  };

  const resetToHome = () => {
    setBalance(100);
    setPortfolio(0);
    setTimeLeft(60);
    setMu(0.001);
    setSigma(0.01);
    setRunning(false);
    setFinished(false);
    setInitialClick(false);
    const initLen = selectedChart === "candle" ? CANDLE_INIT : LINE_INIT;
    setPrices(generateInitialPrices(initLen, 100, 0.001, 0.01));
  };

  /* --------------------- Shop logic ------------------------------- */
  const handlePurchase = (item) => {
    if (item.type === "theme") {
      if (unlockedThemes.includes(item.id)) return;
      if (savedCoins >= item.price) {
        setSavedCoins(c => c - item.price);
        setUnlockedThemes(arr => [...arr, item.id]);
      }
    } else if (item.type === "chart") {
      if (unlockedCharts.includes(item.id)) return;
      if (savedCoins >= item.price) {
        setSavedCoins(c => c - item.price);
        setUnlockedCharts(arr => [...arr, item.id]);
      }
    } else if (item.type === "stat") {
      if (unlockedStats.includes(item.id)) return;
      if (savedCoins >= item.price) {
        setSavedCoins(c => c - item.price);
        setUnlockedStats(arr => [...arr, item.id]);
      }
    }
  };

  const applyTheme = (id) => {
    if (!unlockedThemes.includes(id)) return;
    setSelectedThemeId(id);
  };

  const toggleStat = (id) => {
    if (!unlockedStats.includes(id)) return;
    setEnabledStats(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);
  };

  /* ------------------- Chart config ------------------------- */
  const commonOptions = {
    scales: {
      x: { display: false, type: "linear" },
      y: {
        display: true,
        ticks: { color: selectedTheme.fg },
        grid: { color: '#444' },
      },
    },
    animation: false,
    plugins: { legend: { display: false } },
    responsive: true,
    maintainAspectRatio: false,
  };

  const lineDatasets = useMemo(() => {
    const sets = [{
      data: prices,
      borderColor: selectedTheme.fg,
      borderWidth: 2,
      pointRadius: 0,
    }];
    if (enabledStats.includes('sma_short') && smaShortArr.length) {
      sets.push({
        data: Array(prices.length - smaShortArr.length).fill(null).concat(smaShortArr),
        borderColor: '#3b82f6',
        borderWidth: 1.5,
        pointRadius: 0,
      });
    }
    if (enabledStats.includes('ema_mid') && emaArr.length) {
      sets.push({
        data: emaArr,
        borderColor: '#f59e0b',
        borderWidth: 1.5,
        pointRadius: 0,
      });
    }
    if (enabledStats.includes('sma_long') && smaLongArr.length) {
      sets.push({
        data: Array(prices.length - smaLongArr.length).fill(null).concat(smaLongArr),
        borderColor: '#10b981',
        borderWidth: 1.5,
        pointRadius: 0,
      });
    }
    return sets;
  }, [prices, smaShortArr, emaArr, smaLongArr, enabledStats, selectedTheme.fg]);

  /* ------------------- Render ------------------------- */
  const finalValue = balance + portfolio * prices[prices.length - 1];
  const returnPct = ((finalValue - 100) / 100) * 100;

  return (
    <div
      ref={containerRef}
      className={`container ${isDark ? "dark-mode" : "light-mode"}`}
      style={{ backgroundColor: selectedTheme.bg, color: selectedTheme.fg }}
      onClick={handleClick}
    >
      {/* Top buttons */}
      <div className="top-buttons">
        <button className="home-button" onClick={(e)=>{e.stopPropagation(); resetToHome();}}>🏠</button>
        <button className="reset-button" onClick={(e)=>{e.stopPropagation(); resetToHome();}}>↻</button>
        <button className="settings-button" onClick={(e)=>{e.stopPropagation(); setShowSettings(true);}}>⚙️</button>
        <button className="shop-button" onClick={(e)=>{e.stopPropagation(); setShowShop(true);}}>🛒</button>
      </div>

      <h1 className="title">Minimalist Stock Sim</h1>

      <div className="chart-wrapper">
        {selectedChart === 'line' && (
          <Line
            key="line"
            data={{ labels: prices.map((_, i) => i), datasets: lineDatasets }}
            options={commonOptions}
            redraw
          />
        )}
        {selectedChart === 'candle' && (
          <ChartComponent
            key="candle"
            type="candlestick"
            data={{
              datasets: [{
                label: 'Price',
                data: candles,
                borderColor: selectedTheme.fg,
                color: {
                  up: '#16a34a',
                  down: '#ef4444',
                  unchanged: selectedTheme.fg,
                },
                parsing: false,
              }],
            }}
            options={{
              ...commonOptions,
              parsing: false,
              scales: {
                ...commonOptions.scales,
                x: { ...commonOptions.scales.x, type: 'linear' },
              },
            }}
            redraw
          />
        )}
        <div className={`timer ${isDark ? 'dark' : 'light'} ${timeLeft <= 10 ? 'warning' : ''}`}>{timeLeft}s</div>
      </div>

      <div className="info">
        💰 Balance: ${balance.toFixed(2)}<br />
        📦 Shares: {portfolio.toFixed(2)}<br />
        🪙 Coins: ${savedCoins.toFixed(2)}
      </div>

      {!initialClick && (
        <div className="hint">Tap on the right side to start the game</div>
      )}

      {finished && (
        <div className="popup" onClick={(e)=>e.stopPropagation()}>
          <div className="popup-content" onClick={(e)=>e.stopPropagation()}>
            <h2>🏁 Game Over!</h2>
            <p>Return: <strong>{returnPct.toFixed(2)}%</strong></p>
            <p>🪙 Total coins: ${savedCoins.toFixed(2)}</p>
            <div className="popup-buttons">
              <button onClick={(e)=>{e.stopPropagation(); resetToHome();}}>Back to Home</button>
            </div>
          </div>
        </div>
      )}

      {/* SETTINGS POPUP */}
      {showSettings && (
        <div className="popup" onClick={(e)=>e.stopPropagation()}>
          <div className="popup-content" onClick={(e)=>e.stopPropagation()}>
            <h3>Settings</h3>

            <label style={{ display: 'block', margin: '10px 0' }}>
              Buy percentage: {purchasePercent}%
              <input
                type="range"
                min="10"
                max="100"
                step="10"
                value={purchasePercent}
                onChange={(e) => setPurchasePercent(Number(e.target.value))}
              />
            </label>

            {/* Chart type */}
            <div style={{ marginTop: '16px', textAlign: 'left' }}>
              <strong>Chart Type</strong>
              <div className="shop-grid" style={{ marginTop: '10px' }}>
                {unlockedCharts.map((id) => {
                  const cm = CHART_MODELS[id];
                  return (
                    <button
                      key={id}
                      className="shop-icon-btn"
                      style={cm.iconStyle}
                      onClick={() => setSelectedChart(id)}
                      title={cm.label}
                    />
                  );
                })}
              </div>
            </div>

            {/* Colors */}
            <div style={{ marginTop: '16px', textAlign: 'left' }}>
              <strong>Colors</strong>
              <div className="shop-grid" style={{ marginTop: '10px' }}>
                {unlockedThemes.map((id) => {
                  const th = THEMES[id];
                  return (
                    <button
                      key={id}
                      className="shop-icon-btn"
                      style={th.iconStyle}
                      onClick={() => applyTheme(id)}
                      title={th.label}
                    />
                  );
                })}
              </div>
            </div>

            {/* Indicators */}
            <div style={{ marginTop: '16px', textAlign: 'left' }}>
              <strong>Indicators</strong>
              {Object.values(STATS_ITEMS).map((st) => (
                <div key={st.id} style={{ opacity: unlockedStats.includes(st.id) ? 1 : 0.4 }}>
                  <label>
                    <input
                      type="checkbox"
                      disabled={!unlockedStats.includes(st.id)}
                      checked={enabledStats.includes(st.id)}
                      onChange={() => toggleStat(st.id)}
                    /> {st.label}
                  </label>
                </div>
              ))}
            </div>

            <div className="popup-buttons">
              <button onClick={(e)=>{e.stopPropagation(); setShowSettings(false);}}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* SHOP POPUP */}
      {showShop && (
        <div className="popup" onClick={(e)=>e.stopPropagation()}>
          <div className="popup-content" onClick={(e)=>e.stopPropagation()}>
            <h3>Shop</h3>
            <p>🪙 Coins: ${savedCoins.toFixed(2)}</p>
            <div className="shop-grid">
              {SHOP_ITEMS.map((item) => {
                const owned =
                  (item.type === 'theme' && unlockedThemes.includes(item.id)) ||
                  (item.type === 'chart' && unlockedCharts.includes(item.id)) ||
                  (item.type === 'stat' && unlockedStats.includes(item.id));
                const canBuy = savedCoins >= item.price;
                return (
                  <div key={item.id} className={`shop-item ${owned ? 'owned' : ''} ${canBuy ? 'can-buy' : 'disabled'}`}>
                    <div style={{ position: 'relative' }}>
                      <button
                        className="shop-icon-btn"
                        disabled={!owned && !canBuy}
                        onClick={() => owned
                          ? (item.type === 'theme' ? applyTheme(item.id) : null)
                          : handlePurchase(item)}
                        style={item.iconStyle}
                        title={item.label}
                      />
                      {owned && <span className="owned-check">✓</span>}
                    </div>
                    <div className="price">{item.price}🪙</div>
                    <div className="label">{item.label}</div>
                  </div>
                );
              })}
            </div>
            <div className="popup-buttons">
              <button onClick={(e)=>{e.stopPropagation(); setShowShop(false);}}>Close</button>
            </div>
          </div>
        </div>
      )}

      {floatingTexts.map(t => (
        <div
          key={t.id}
          className={`floating-text ${t.color}`}
          style={{ left: t.x, top: t.y }}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
