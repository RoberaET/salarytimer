import { useState, useEffect, useMemo } from 'react';
import './index.css';
import { EthDateTime } from 'ethiopian-calendar-date-converter';

type SalaryType = 'hourly' | 'monthly';

function formatCountdown(totalSeconds: number): string {
  if (totalSeconds <= 0) return 'Payment Day! 🎉';
  const d = Math.floor(totalSeconds / 86400);
  const h = Math.floor((totalSeconds % 86400) / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  if (d > 0) return `${d}d ${h}h ${m}m ${s}s`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

function localDateStr(date: Date): string {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().split('T')[0];
}

// "HH:MM" → total minutes from midnight
function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Sum only seconds inside the daily work window [clockInMin, effectiveOutMin],
 * walking day by day from cycleStartMs to nowMs.
 * effectiveOutMin already accounts for lunch (clockOut - 60 min).
 */
function calcWorkedSeconds(
  cycleStartMs: number,
  nowMs: number,
  clockInMin: number,
  effectiveOutMin: number  // already lunch-adjusted
): number {
  if (effectiveOutMin <= clockInMin || nowMs <= cycleStartMs) return 0;

  const d0 = new Date(cycleStartMs);
  let dayMidnight = new Date(
    d0.getFullYear(), d0.getMonth(), d0.getDate(), 0, 0, 0, 0
  ).getTime();

  const ONE_DAY = 86_400_000;
  let total = 0;
  const startMidnight = dayMidnight;

  while (dayMidnight <= nowMs) {
    const workStart = dayMidnight + clockInMin      * 60_000;
    const workEnd   = dayMidnight + effectiveOutMin * 60_000;

    const from = Math.max(workStart, cycleStartMs);
    const to   = Math.min(workEnd,   nowMs);

    if (to > from) total += (to - from) / 1000;

    dayMidnight += ONE_DAY;
    if (dayMidnight - startMidnight > 32 * ONE_DAY) break;
  }

  return Math.max(0, total);
}

const LUNCH_HOURS = 1; // 1 hour always deducted for lunch

const ETH_MONTHS = [
  'Meskerem (መስከረም)', 'Tikimt (ጥቅምት)', 'Hidar (ኅዳር)', 'Tahsas (ታኅሣሥ)', 
  'Tir (ጥር)', 'Yakatit (የካቲት)', 'Maggabit (መጋቢት)', 'Miyazya (ሚያዝያ)', 
  'Ginbot (ግንቦት)', 'Sene (ሰኔ)', 'Hamle (ሐምሌ)', 'Nehase (ነሐሴ)', 'Pagume (ጳጉሜ)'
];

function EthiopianConverterCard() {
  const initial = useMemo(() => {
    try {
      return EthDateTime.fromEuropeanDate(new Date());
    } catch {
      return { year: 2017, month: 1, date: 1 };
    }
  }, []);

  const [ethYear, setEthYear] = useState<number>(initial.year);
  const [ethMonth, setEthMonth] = useState<number>(initial.month);
  const [ethDay, setEthDay] = useState<number>(initial.date);

  const gregorianDateStr = useMemo(() => {
    try {
      const eth = new EthDateTime(ethYear, ethMonth, ethDay);
      const eu = eth.toEuropeanDate();
      const localEpoch = new Date(eu.getTime() - (eu.getTimezoneOffset() * 60000));
      return localEpoch.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    } catch {
      return "Invalid Ethiopian Date";
    }
  }, [ethYear, ethMonth, ethDay]);

  return (
    <div className="bento-card">
      <div className="card-label">Converter: Ethio → Western</div>
      
      <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem', marginBottom: '1rem' }}>
        <select className="input-field" style={{ padding: '0.5rem', fontSize: '0.9rem', flex: 2 }} value={ethMonth} onChange={e => setEthMonth(Number(e.target.value))}>
          {ETH_MONTHS.map((m, i) => <option key={i+1} value={i+1}>{m.split(' ')[0]}</option>)}
        </select>
        <select className="input-field" style={{ padding: '0.5rem', fontSize: '0.9rem', flex: 1 }} value={ethDay} onChange={e => setEthDay(Number(e.target.value))}>
          {Array.from({length: ethMonth === 13 ? 6 : 30}, (_,i) => <option key={i+1} value={i+1}>{i+1}</option>)}
        </select>
        <input type="number" className="input-field" style={{ padding: '0.5rem', fontSize: '0.9rem', width: '80px', flex: 1 }} value={ethYear} onChange={e => setEthYear(Number(e.target.value))} />
      </div>

      <div className="card-subtext">Gregorian Equivalent:</div>
      <div className="card-value" style={{ fontSize: '1.2rem', marginTop: '0.2rem', color: 'var(--success)' }}>
        {gregorianDateStr}
      </div>
    </div>
  );
}

function App() {
  const [salary,     setSalary]     = useState<number | ''>('');
  const [salaryType, setSalaryType] = useState<SalaryType>('monthly');
  const [clockIn,    setClockIn]    = useState<string>('08:30');
  const [clockOut,   setClockOut]   = useState<string>('17:30');



  const [nextPayDateStr, setNextPayDateStr] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return localDateStr(d);
  });

  const [earnedAmount,     setEarnedAmount]     = useState<number>(0);
  const [secondsToPayment, setSecondsToPayment] = useState<number>(0);
  const [progressPct,      setProgressPct]      = useState<number>(0);
  const [isWorkingNow,     setIsWorkingNow]      = useState<boolean>(false);
  
  // UI State
  const [showSettings, setShowSettings] = useState<boolean>(false);

  const [ethioDate, setEthioDate] = useState<any>(null);
  const [ethioTime, setEthioTime] = useState<any>(null);

  useEffect(() => {
    fetch('https://api.ethioall.com/date/api')
      .then(res => res.json())
      .then(data => setEthioDate(data))
      .catch(err => console.error(err));
  }, []);

  useEffect(() => {
    const fetchTime = () => {
      fetch('https://api.ethioall.com/time/api')
        .then(res => res.json())
        .then(data => setEthioTime(data.ethiopian_time))
        .catch(err => console.error(err));
    };
    fetchTime();
    const iv = setInterval(fetchTime, 1000);
    return () => clearInterval(iv);
  }, []);

  // Restore from localStorage
  useEffect(() => {
    const s  = localStorage.getItem('calc_salary');
    const t  = localStorage.getItem('calc_type') as SalaryType;
    const pd = localStorage.getItem('calc_nextPayDate');
    const ci = localStorage.getItem('calc_clockIn');
    const co = localStorage.getItem('calc_clockOut');

    if (s)  setSalary(Number(s));
    if (t)  setSalaryType(t);
    if (pd) setNextPayDateStr(pd);
    if (ci) setClockIn(ci);
    if (co) setClockOut(co);
  }, []);

  /**
   * effectiveHoursPerDay = window hours − 1 hr lunch
   */
  const effectiveHoursPerDay = useMemo(() => {
    const windowHours = (toMinutes(clockOut) - toMinutes(clockIn)) / 60;
    return Math.max(0, windowHours - LUNCH_HOURS);
  }, [clockIn, clockOut]);

  // The effective clock-out minute used for counting (removes lunch from end)
  const effectiveOutMin = useMemo(() => {
    return toMinutes(clockIn) + effectiveHoursPerDay * 60;
  }, [clockIn, effectiveHoursPerDay]);

  // How many effective work-seconds count per day
  const workSecsPerDay = useMemo(() => effectiveHoursPerDay * 3600, [effectiveHoursPerDay]);

  // Daily rate
  const dailyRate = useMemo(() => {
    if (!salary) return 0;
    if (salaryType === 'hourly') return (salary as number) * effectiveHoursPerDay;
    return (salary as number) / 30;
  }, [salary, salaryType, effectiveHoursPerDay]);

  // Hourly rate = dailyRate / effective hours
  const hourlyRate = useMemo(() => {
    if (!effectiveHoursPerDay || !dailyRate) return 0;
    return dailyRate / effectiveHoursPerDay;
  }, [dailyRate, effectiveHoursPerDay]);

  // Per-work-second rate
  const earningsPerWorkSec = useMemo(() => {
    if (!workSecsPerDay || !dailyRate) return 0;
    return dailyRate / workSecsPerDay; 
  }, [dailyRate, workSecsPerDay]);

  // Real-time tick
  useEffect(() => {
    if (!salary || !nextPayDateStr || effectiveHoursPerDay === 0) {
      setEarnedAmount(0); setSecondsToPayment(0); setProgressPct(0);
      return;
    }

    const inMin  = toMinutes(clockIn);

    const tick = () => {
      const nowMs = Date.now();

      const [yr, mo, dy] = nextPayDateStr.split('-').map(Number);
      const payDate    = new Date(yr, mo - 1, dy, 0, 0, 0, 0).getTime();
      const CYCLE_MS   = 30 * 24 * 60 * 60 * 1000;
      const cycleStart = payDate - CYCLE_MS;

      // Only count seconds inside effective work window
      const workedSecs = calcWorkedSeconds(cycleStart, nowMs, inMin, effectiveOutMin);
      const earned     = workedSecs * earningsPerWorkSec;

      const remaining     = Math.max(0, (payDate - nowMs) / 1000);
      const totalWorkSecs = 30 * workSecsPerDay;
      const pct = totalWorkSecs > 0
        ? Math.min(100, (workedSecs / totalWorkSecs) * 100)
        : 0;

      // Status: are we inside the effective work window right now?
      const d         = new Date(nowMs);
      const nowMin    = d.getHours() * 60 + d.getMinutes();
      const working   = nowMin >= inMin && nowMin < effectiveOutMin;

      setEarnedAmount(earned);
      setSecondsToPayment(remaining);
      setProgressPct(pct);
      setIsWorkingNow(working);
    };

    tick();
    const iv = setInterval(tick, 100);
    return () => clearInterval(iv);
  }, [nextPayDateStr, earningsPerWorkSec, salary, clockIn, effectiveOutMin, effectiveHoursPerDay, workSecsPerDay]);

  // Handlers
  const handleSalaryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const num = parseFloat(e.target.value);
    if (e.target.value === '' || isNaN(num) || num < 0) {
      setSalary(''); localStorage.removeItem('calc_salary');
    } else {
      setSalary(num); localStorage.setItem('calc_salary', num.toString());
    }
  };

  const handleTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const t = e.target.value as SalaryType;
    setSalaryType(t); localStorage.setItem('calc_type', t);
  };

  const handlePayDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setNextPayDateStr(val);
    val ? localStorage.setItem('calc_nextPayDate', val) : localStorage.removeItem('calc_nextPayDate');
  };

  const handleClockInChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setClockIn(e.target.value); localStorage.setItem('calc_clockIn', e.target.value);
  };

  const handleClockOutChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setClockOut(e.target.value); localStorage.setItem('calc_clockOut', e.target.value);
  };

  const handleReset = () => {
    setSalary(''); setClockIn('08:30'); setClockOut('17:30');
    const d = new Date(); d.setDate(d.getDate() + 30);
    setNextPayDateStr(localDateStr(d));
    ['calc_salary','calc_nextPayDate','calc_clockIn','calc_clockOut'].forEach(k => localStorage.removeItem(k));
    setShowSettings(false);
  };

  const cycleStartLabel = useMemo(() => {
    if (!nextPayDateStr) return '';
    const [yr, mo, dy] = nextPayDateStr.split('-').map(Number);
    return new Date(yr, mo - 1, dy - 30)
      .toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }, [nextPayDateStr]);

  const nextPayLabel = useMemo(() => {
    if (!nextPayDateStr) return '';
    const [yr, mo, dy] = nextPayDateStr.split('-').map(Number);
    return new Date(yr, mo - 1, dy)
      .toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }, [nextPayDateStr]);

  const mainEarned     = Math.floor(earnedAmount);
  const decimalsEarned = (earnedAmount % 1).toFixed(4).substring(2);

  return (
    <>
      <div className="aurora-bg"></div>

      <header className="app-header">
        <h1 className="brand-title">Time is Money</h1>
        <button className="icon-btn" onClick={() => setShowSettings(true)} aria-label="Settings">
          <svg viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path>
            <circle cx="12" cy="12" r="3"></circle>
          </svg>
        </button>
      </header>

      {salary === '' ? (
        <div className="empty-dashboard">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h2>Welcome to your Tracker</h2>
          <p>Configure your salary and work hours to start seeing real-time earnings.</p>
          <button className="btn-primary" onClick={() => setShowSettings(true)}>Set Up Tracker</button>
        </div>
      ) : (
        <div className="bento-grid">
          
          {/* Main Earnings Card */}
          <div className="bento-card hero-card">
            <div className="earnings-label">Earned This Cycle</div>
            <div className={`earnings-amount ${isWorkingNow ? 'ticking' : ''}`}>
              <span className="earnings-currency">$</span>
              <span>{mainEarned.toLocaleString()}</span>
              <span className="earnings-decimals">.{decimalsEarned}</span>
            </div>
            {isWorkingNow && <div style={{marginTop: '1rem', color: 'var(--accent)', fontSize: '0.85rem'}}>+$ {earningsPerWorkSec.toFixed(4)} / sec</div>}
          </div>

          {/* Countdown Card */}
          <div className="bento-card">
            <div className="card-label">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
              Next Payment
            </div>
            <div className="card-value" style={{ fontSize: '1.4rem' }}>{formatCountdown(secondsToPayment)}</div>
            <div className="card-subtext">Payday: {nextPayLabel}</div>
          </div>

          {/* Status Card */}
          <div className="bento-card">
            <div className="card-label">Current Status</div>
            <div style={{ marginTop: '0.5rem', marginBottom: '0.5rem' }}>
              <div className={`status-indicator ${isWorkingNow ? 'status-active' : 'status-idle'}`}>
                <span className="status-dot"></span>
                {isWorkingNow ? 'On the Clock' : 'Off the Clock'}
              </div>
            </div>
            <div className="card-subtext">Work window: {clockIn} - {clockOut}</div>
          </div>

          {/* Rate Breakdown Card */}
          <div className="bento-card">
             <div className="card-label">Earnings Rate</div>
             <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: '0.5rem' }}>
               <div>
                 <div className="card-value">${hourlyRate.toFixed(2)}</div>
                 <div className="card-subtext">per hour</div>
               </div>
               <div>
                 <div className="card-value">${dailyRate.toFixed(2)}</div>
                 <div className="card-subtext">per day ({(effectiveHoursPerDay).toFixed(1)}h)</div>
               </div>
             </div>
          </div>

          {/* Ethiopian Time Card */}
          <div className="bento-card">
             <div className="card-label">Ethiopian Date & Time</div>
             {ethioTime && ethioDate ? (
               <div style={{ marginTop: '0.5rem' }}>
                 <div className="card-value" style={{ fontSize: '1.4rem' }}>
                   {String(ethioTime.hour).padStart(2,'0')}:{String(ethioTime.minute).padStart(2,'0')}:{String(ethioTime.second).padStart(2,'0')} {ethioTime.period_amharic}
                 </div>
                 <div className="card-subtext" style={{ marginTop: '0.5rem' }}>
                   {ethioDate.day_amharic} ({ethioDate.day_english})
                   <br/>
                   {ethioDate.month_amharic} {ethioDate.date}, {ethioDate.year} 
                 </div>
               </div>
             ) : (
               <div className="card-subtext" style={{ marginTop: '0.5rem' }}>Loading...</div>
              )}
          </div>

          {/* Converter Card */}
          <EthiopianConverterCard />

          {/* Progress Card */}
          <div className="bento-card">
             <div className="card-label">Cycle Completion</div>
             <div className="card-value">{progressPct.toFixed(1)}%</div>
             
             <div className="progress-container">
               <div className="progress-track">
                 <div className="progress-fill" style={{ width: `${progressPct}%` }}></div>
               </div>
               <div className="progress-labels">
                  <span>{cycleStartLabel}</span>
                  <span>{nextPayLabel}</span>
               </div>
             </div>
          </div>

        </div>
      )}

      {/* Settings Overlay */}
      {showSettings && (
        <div className="settings-overlay">
          <div className="settings-panel">
            <div className="settings-header">
              <h2>Settings</h2>
              <button className="close-btn" onClick={() => setShowSettings(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label" htmlFor="salaryType">Salary Type</label>
                <select id="salaryType" className="input-field" value={salaryType} onChange={handleTypeChange}>
                  <option value="monthly">Monthly</option>
                  <option value="hourly">Hourly</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="salaryAmount">
                  {salaryType === 'monthly' ? 'Monthly Salary ($)' : 'Hourly Rate ($/hr)'}
                </label>
                <input
                  id="salaryAmount" type="number" min="0" step="0.01"
                  className="input-field"
                  placeholder={salaryType === 'monthly' ? 'e.g., 10995' : 'e.g., 45.81'}
                  value={salary} onChange={handleSalaryChange}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="nextPayDate">Next Payment Date</label>
              <input id="nextPayDate" type="date" className="input-field" value={nextPayDateStr} onChange={handlePayDateChange} />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label" htmlFor="clockIn">Work Start</label>
                <input id="clockIn" type="time" className="input-field" value={clockIn} onChange={handleClockInChange} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="clockOut">Work End</label>
                <input id="clockOut" type="time" className="input-field" value={clockOut} onChange={handleClockOutChange} />
              </div>
            </div>

            <button className="btn-primary btn-block" style={{marginTop: '1.5rem'}} onClick={() => setShowSettings(false)}>
              Save & Close
            </button>

            {salary !== '' && (
              <button className="btn-secondary" onClick={handleReset}>
                Reset All Data
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export default App;
