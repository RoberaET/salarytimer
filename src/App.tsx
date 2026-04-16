import { useState, useEffect, useMemo } from 'react';
import './index.css';

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

function App() {
  const [salary,     setSalary]     = useState<number | ''>('');
  const [salaryType, setSalaryType] = useState<SalaryType>('monthly');
  const [clockIn,    setClockIn]    = useState<string>('08:30');
  const [clockOut,   setClockOut]   = useState<string>('17:30');

  const [now, setNow] = useState<Date>(() => new Date());

  const [nextPayDateStr, setNextPayDateStr] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return localDateStr(d);
  });

  const [earnedAmount,     setEarnedAmount]     = useState<number>(0);
  const [secondsToPayment, setSecondsToPayment] = useState<number>(0);
  const [progressPct,      setProgressPct]      = useState<number>(0);
  const [isWorkingNow,     setIsWorkingNow]      = useState<boolean>(false);

  // Live clock — updates every second
  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 1000);
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
   * e.g. 08:30–17:30 = 9h window − 1h = 8h effective
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

  // Per-work-second rate  (based on effective hours only)
  const earningsPerWorkSec = useMemo(() => {
    if (!workSecsPerDay || !dailyRate) return 0;
    return dailyRate / workSecsPerDay; // = hourlyRate / 3600
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

      // Only count seconds inside effective work window (lunch already excluded)
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
    <div className="glass-panel">

      {/* Live clock */}
      <div className="live-clock">
        <div className="live-clock-time">
          {now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </div>
        <div className="live-clock-date">
          {now.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </div>
      </div>

      <h1 className="title">Time is Money</h1>
      <p className="subtitle">Real-time earnings — work hours only.</p>

      {/* Salary type */}
      <div className="form-group">
        <label className="form-label" htmlFor="salaryType">Salary Type</label>
        <select id="salaryType" className="input-field" value={salaryType} onChange={handleTypeChange}>
          <option value="monthly">Monthly</option>
          <option value="hourly">Hourly</option>
        </select>
      </div>

      {/* Salary amount */}
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

      {/* Work window */}
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

      {/* Next payment date */}
      <div className="form-group">
        <label className="form-label" htmlFor="nextPayDate">Next Payment Date</label>
        <input id="nextPayDate" type="date" className="input-field" value={nextPayDateStr} onChange={handlePayDateChange} />
      </div>

      {/* Rate breakdown */}
      {salary !== '' && effectiveHoursPerDay > 0 && (
        <div className="rate-breakdown">
          <div className="rate-item">
            <span className="rate-label">Per Hour</span>
            <span className="rate-value">${hourlyRate.toFixed(2)}</span>
          </div>
          <div className="rate-divider" />
          <div className="rate-item">
            <span className="rate-label">Per Day ({effectiveHoursPerDay}h)</span>
            <span className="rate-value">${dailyRate.toFixed(2)}</span>
          </div>
          <div className="rate-divider" />
          <div className="rate-item">
            <span className="rate-label">Per Second</span>
            <span className="rate-value">${earningsPerWorkSec.toFixed(5)}</span>
          </div>
        </div>
      )}

      {/* On/Off clock status */}
      {salary !== '' && (
        <div className={`status-badge ${isWorkingNow ? 'status-active' : 'status-idle'}`}>
          <span className="status-dot" />
          {isWorkingNow
            ? `On the clock — $${earningsPerWorkSec.toFixed(4)}/sec`
            : `Off the clock · Paused (${clockIn}–${clockOut}, −1h lunch = ${effectiveHoursPerDay}h/day)`}
        </div>
      )}

      {/* Cycle progress bar */}
      {salary !== '' && (
        <div className="cycle-bar-wrapper">
          <div className="cycle-dates">
            <span>{cycleStartLabel}</span>
            <span>{nextPayLabel}</span>
          </div>
          <div className="cycle-bar">
            <div className="cycle-bar-fill" style={{ width: `${progressPct}%` }} />
            <div className="cycle-bar-marker" style={{ left: `${Math.min(progressPct, 98)}%` }} />
          </div>
          <div className="cycle-pct">{progressPct.toFixed(1)}% of work hours complete</div>
        </div>
      )}

      {/* Earnings */}
      <div className={`earnings-container ${isWorkingNow && salary !== '' ? 'earnings-ticking' : ''}`}>
        <div className="earnings-label">Earned This Cycle</div>
        <div className="earnings-amount">
          <span className="earnings-currency">$</span>
          <span>{mainEarned.toLocaleString()}</span>
          <span className="earnings-decimals">.{decimalsEarned}</span>
        </div>
        {salary !== '' && (
          <div className="countdown-badge">
            ⏳ Next payment in: <strong>{formatCountdown(secondsToPayment)}</strong>
          </div>
        )}
      </div>

      {salary !== '' && (
        <button className="reset-button" onClick={handleReset}>Reset Session</button>
      )}
    </div>
  );
}

export default App;
