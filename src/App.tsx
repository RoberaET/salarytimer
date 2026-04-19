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

// Saturday fixed window: 08:30 – 12:30 (no lunch deduction)
const SAT_IN_MIN  = 8 * 60 + 30;  // 510
const SAT_OUT_MIN = 12 * 60 + 30; // 750
const SAT_HOURS   = (SAT_OUT_MIN - SAT_IN_MIN) / 60; // 4

/**
 * Sum only seconds inside the daily work window, walking day by day.
 * Rules:
 *   Sunday  (0) → skip (no work)
 *   Saturday (6) → fixed 08:30–12:30 window (4 h, no lunch)
 *   Mon–Fri      → [clockInMin, effectiveOutMin] (lunch already deducted)
 */
function calcWorkedSeconds(
  cycleStartMs: number,
  nowMs: number,
  clockInMin: number,
  effectiveOutMin: number, // already lunch-adjusted for weekdays
  missedDates: string[]    // list of YYYY-MM-DD to skip
): number {
  if (nowMs <= cycleStartMs) return 0;

  const d0 = new Date(cycleStartMs);
  let dayMidnight = new Date(
    d0.getFullYear(), d0.getMonth(), d0.getDate(), 0, 0, 0, 0
  ).getTime();

  const ONE_DAY = 86_400_000;
  let total = 0;
  const startMidnight = dayMidnight;

  while (dayMidnight <= nowMs) {
    const dDate = new Date(dayMidnight);
    const dow = dDate.getDay(); // 0=Sun … 6=Sat
    const dateStr = localDateStr(dDate);

    if (dow !== 0 && !missedDates.includes(dateStr)) { // skip Sunday and missed holidays entirely
      const inMin  = dow === 6 ? SAT_IN_MIN  : clockInMin;
      const outMin = dow === 6 ? SAT_OUT_MIN : effectiveOutMin;

      if (outMin > inMin) {
        const workStart = dayMidnight + inMin  * 60_000;
        const workEnd   = dayMidnight + outMin * 60_000;
        const from = Math.max(workStart, cycleStartMs);
        const to   = Math.min(workEnd,   nowMs);
        if (to > from) total += (to - from) / 1000;
      }
    }

    dayMidnight += ONE_DAY;
    if (dayMidnight - startMidnight > 32 * ONE_DAY) break;
  }

  return Math.max(0, total);
}

function getDefaultOvertimeMultiplier(d: Date, isHoliday: boolean): number {
  if (isHoliday) return 2.5;
  const dow = d.getDay();
  if (dow === 0 || dow === 6) return 2.0; // Weekend
  
  const minutes = d.getHours() * 60 + d.getMinutes();
  const MIN_17_30 = 17 * 60 + 30;
  const MIN_22_00 = 22 * 60;
  const MIN_06_00 = 6 * 60;

  if (minutes >= MIN_17_30 && minutes < MIN_22_00) return 1.5;
  if (minutes >= MIN_22_00 || minutes < MIN_06_00) return 1.75;
  return 1.0; 
}

function calcAutoOvertimeForRange(startMs: number, endMs: number, hourlyRate: number, missedDates: string[]): number {
  if (endMs <= startMs) return 0;
  
  let totalOt = 0;
  const perMinuteBase = hourlyRate / 60;
  
  let currentMs = startMs;
  while (currentMs < endMs) {
    const nextMinuteMs = Math.min(endMs, currentMs + 60000 - (currentMs % 60000));
    const durationMin = (nextMinuteMs - currentMs) / 60000;
    
    const d = new Date(currentMs);
    const dateStr = localDateStr(d);
    const isHol = missedDates.includes(dateStr);
    const mult = getDefaultOvertimeMultiplier(d, isHol);
    
    totalOt += durationMin * perMinuteBase * mult;
    
    currentMs = nextMinuteMs;
    if (durationMin <= 0) break; // safety
  }
  return totalOt;
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

function OvertimeCard({ hourlyRate, isTodayMissed, overtimeAccumulated, activeOvertimeSession, overtimeLive, setOvertimeAccumulated, setActiveOvertimeSession }: any) {
  const [otStartTime, setOtStartTime] = useState<string>(
    `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`
  );
  
  const currentDefaultMultiplier = useMemo(() => getDefaultOvertimeMultiplier(new Date(), isTodayMissed), [isTodayMissed]);
  const [otInputMultiplier, setOtInputMultiplier] = useState<string>('');
  
  const multiplierToUse = otInputMultiplier !== '' ? Number(otInputMultiplier) : 'auto';

  const handleStart = () => {
    const [h, m] = otStartTime.split(':').map(Number);
    const now = new Date();
    const startD = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
    const session = { startMs: startD.getTime(), multiplierMode: multiplierToUse };
    setActiveOvertimeSession(session);
    localStorage.setItem('calc_ot_session', JSON.stringify(session));
  };

  const handleStop = () => {
    const newAcc = overtimeAccumulated + overtimeLive;
    setOvertimeAccumulated(newAcc);
    localStorage.setItem('calc_ot_acc', newAcc.toString());
    setActiveOvertimeSession(null);
    localStorage.removeItem('calc_ot_session');
  };

  return (
    <div className="bento-card hero-card" style={{ background: activeOvertimeSession ? 'linear-gradient(135deg, rgba(8, 145, 178, 0.1), rgba(139, 92, 246, 0.1))' : undefined, border: activeOvertimeSession ? '1px solid rgba(139, 92, 246, 0.3)' : undefined }}>
      <div className="card-label">Overtime Tracker</div>
      
      <div style={{ display: 'flex', gap: '0.8rem', marginTop: '0.5rem' }}>
        <div style={{flex: 1}}>
          <label style={{fontSize: '0.8rem', opacity: 0.8, display: 'block', marginBottom: '0.3rem'}}>Start Time</label>
          <input type="time" className="input-field" style={{padding: '0.5rem', width: '100%'}} value={otStartTime} onChange={e => setOtStartTime(e.target.value)} disabled={!!activeOvertimeSession} />
        </div>
        <div style={{flex: 1}}>
          <label style={{fontSize: '0.8rem', opacity: 0.8, display: 'block', marginBottom: '0.3rem'}}>Multiplier (x)</label>
          <input type="number" step="0.1" className="input-field" style={{padding: '0.5rem', width: '100%'}} placeholder={activeOvertimeSession ? (activeOvertimeSession.multiplierMode === 'auto' ? 'Auto' : activeOvertimeSession.multiplierMode.toString()) : `Auto (${currentDefaultMultiplier}x)`} value={otInputMultiplier} onChange={e => setOtInputMultiplier(e.target.value)} disabled={!!activeOvertimeSession} />
        </div>
      </div>

      <div style={{ marginTop: '1.2rem' }}>
        {activeOvertimeSession ? (
          <>
            <button className="btn-primary" style={{ background: 'var(--danger, #f87171)', width: '100%', marginBottom: '1rem', padding: '0.6rem'}} onClick={handleStop}>Stop Overtime</button>
            <div className="earnings-amount ticking" style={{ fontSize: '1.8rem' }}>
              <span className="earnings-currency">+$</span>
              <span>{Math.floor(overtimeLive).toLocaleString()}</span>
              <span className="earnings-decimals">.{(overtimeLive % 1).toFixed(4).substring(2)}</span>
            </div>
            <div className="card-subtext" style={{marginTop: '0.5rem'}}>
              Active at {activeOvertimeSession.multiplierMode === 'auto' ? `${currentDefaultMultiplier}x (Auto)` : `${activeOvertimeSession.multiplierMode}x (Fixed)`} rate
            </div>
          </>
        ) : (
          <button className="btn-primary" style={{ width: '100%', padding: '0.6rem' }} onClick={handleStart}>Start Overtime Session</button>
        )}
      </div>

      {(overtimeAccumulated > 0 || !activeOvertimeSession) && (
        <div style={{ marginTop: '1.2rem', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '0.8rem' }}>
          <div className="card-subtext">Total OT Earned this Cycle</div>
          <div className="card-value" style={{fontSize: '1.2rem', color: 'var(--success)'}}>${overtimeAccumulated.toFixed(2)}</div>
        </div>
      )}
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
  
  // Overtime State
  const [overtimeAccumulated, setOvertimeAccumulated] = useState<number>(0);
  const [activeOvertimeSession, setActiveOvertimeSession] = useState<{startMs: number, multiplierMode: 'auto' | number} | null>(null);
  const [overtimeLive, setOvertimeLive] = useState<number>(0);

  // UI State
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [missedDates, setMissedDates] = useState<string[]>([]);

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
    const md = localStorage.getItem('calc_missedDates');
    const oAcc = localStorage.getItem('calc_ot_acc');
    const oSess = localStorage.getItem('calc_ot_session');

    if (s)  setSalary(Number(s));
    if (t)  setSalaryType(t);
    if (pd) setNextPayDateStr(pd);
    if (ci) setClockIn(ci);
    if (co) setClockOut(co);
    if (md) {
      try { setMissedDates(JSON.parse(md)); } catch {}
    }
    if (oAcc) setOvertimeAccumulated(Number(oAcc));
    if (oSess) {
      try { setActiveOvertimeSession(JSON.parse(oSess)); } catch {}
    }
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

  /**
   * Average work-hours per calendar day across a full week:
   *   5 weekdays × effectiveHoursPerDay  +  1 Saturday × 4h  +  0 Sunday
   *   divided by 7 calendar days
   * Used for monthly-salary prorating.
   */
  const avgHoursPerCalendarDay = useMemo(() => {
    return (5 * effectiveHoursPerDay + SAT_HOURS) / 7;
  }, [effectiveHoursPerDay]);

  // Total work-seconds in a 30-day cycle
  const totalCycleWorkSecs = useMemo(() => {
    return avgHoursPerCalendarDay * 30 * 3600;
  }, [avgHoursPerCalendarDay]);

  // Daily rate (nominal display)
  const dailyRate = useMemo(() => {
    if (!salary) return 0;
    if (salaryType === 'hourly') return (salary as number) * effectiveHoursPerDay;
    return (salary as number) / 30;
  }, [salary, salaryType, effectiveHoursPerDay]);

  // Hourly rate (nominal display based on standard weekday hours)
  const hourlyRate = useMemo(() => {
    if (!effectiveHoursPerDay || !dailyRate) return 0;
    return dailyRate / effectiveHoursPerDay;
  }, [dailyRate, effectiveHoursPerDay]);

  // Per-work-second rate
  const earningsPerWorkSec = useMemo(() => {
    if (!totalCycleWorkSecs || !salary) return 0;
    const totalSalary = salaryType === 'monthly' ? (salary as number) : (salary as number) * avgHoursPerCalendarDay * 30;
    return totalSalary / totalCycleWorkSecs;
  }, [salary, salaryType, totalCycleWorkSecs, avgHoursPerCalendarDay]);

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
      const workedSecs = calcWorkedSeconds(cycleStart, nowMs, inMin, effectiveOutMin, missedDates);
      const earned     = workedSecs * earningsPerWorkSec;

      const remaining = Math.max(0, (payDate - nowMs) / 1000);
      // True progress = how much of the 30-day calendar window has elapsed
      const cycleTotalMs = payDate - cycleStart;
      const pct = cycleTotalMs > 0
        ? Math.min(100, Math.max(0, (nowMs - cycleStart) / cycleTotalMs * 100))
        : 0;

      // Status: are we inside the effective work window right now?
      const d      = new Date(nowMs);
      const dow    = d.getDay(); // 0=Sun, 6=Sat
      const nowMin = d.getHours() * 60 + d.getMinutes();
      const isTodayMissed = missedDates.includes(localDateStr(d));
      const working =
        dow !== 0 && // not Sunday
        !isTodayMissed && // not absent/holiday
        (dow === 6
          ? nowMin >= SAT_IN_MIN && nowMin < SAT_OUT_MIN          // Saturday 08:30–12:30
          : nowMin >= inMin && nowMin < effectiveOutMin);          // weekday window

      // Live overtime calculation
      let currentOt = 0;
      if (activeOvertimeSession) {
        if (activeOvertimeSession.multiplierMode === 'auto') {
          currentOt = calcAutoOvertimeForRange(activeOvertimeSession.startMs, nowMs, hourlyRate, missedDates);
        } else {
          currentOt = Math.max(0, (nowMs - activeOvertimeSession.startMs) / 1000) * (hourlyRate / 3600) * activeOvertimeSession.multiplierMode;
        }
      }

      setEarnedAmount(earned);
      setOvertimeLive(currentOt);
      setSecondsToPayment(remaining);
      setProgressPct(pct);
      setIsWorkingNow(working);
    };

    tick();
    const iv = setInterval(tick, 100);
    return () => clearInterval(iv);
  }, [nextPayDateStr, earningsPerWorkSec, salary, clockIn, effectiveOutMin, effectiveHoursPerDay, totalCycleWorkSecs, missedDates, activeOvertimeSession, hourlyRate]);

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
    setMissedDates([]);
    setOvertimeAccumulated(0);
    setActiveOvertimeSession(null);
    ['calc_salary','calc_nextPayDate','calc_clockIn','calc_clockOut','calc_missedDates','calc_ot_acc','calc_ot_session'].forEach(k => localStorage.removeItem(k));
    setShowSettings(false);
  };

  const toggleHolidayToday = () => {
    const todayStr = localDateStr(new Date());
    setMissedDates(prev => {
      const newDates = prev.includes(todayStr) 
        ? prev.filter(d => d !== todayStr) 
        : [...prev, todayStr];
      localStorage.setItem('calc_missedDates', JSON.stringify(newDates));
      return newDates;
    });
  };

  const isTodayMissed = useMemo(() => missedDates.includes(localDateStr(new Date())), [missedDates]);

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

  const mainTotalEarned = earnedAmount + overtimeAccumulated + overtimeLive;
  const mainEarned     = Math.floor(mainTotalEarned);
  const decimalsEarned = (mainTotalEarned % 1).toFixed(4).substring(2);

  return (
    <>
      <div className="aurora-bg"></div>

      <header className="app-header">
        <h1 className="brand-title">Time is Money</h1>
        <div style={{ display: 'flex', gap: '0.8rem' }}>
          <button 
            className="icon-btn" 
            style={isTodayMissed ? { color: 'var(--danger, #f87171)', borderColor: 'var(--danger, #f87171)', background: 'rgba(248, 113, 113, 0.1)' } : {}}
            onClick={toggleHolidayToday} 
            aria-label="Toggle Holiday" 
            title={isTodayMissed ? "Resume Work (Undo Holiday)" : "Mark Today as Holiday"}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {isTodayMissed ? (
                <>
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                  <line x1="9" y1="9" x2="15" y2="15"></line>
                  <line x1="15" y1="9" x2="9" y2="15"></line>
                </>
              ) : (
                <>
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                  <line x1="16" y1="2" x2="16" y2="6"></line>
                  <line x1="8" y1="2" x2="8" y2="6"></line>
                  <line x1="3" y1="10" x2="21" y2="10"></line>
                </>
              )}
            </svg>
          </button>
          <button className="icon-btn" onClick={() => setShowSettings(true)} aria-label="Settings">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3"></circle>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
          </button>
        </div>
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
            <div className="earnings-label">Earned This Cycle (Total)</div>
            <div className={`earnings-amount ${isWorkingNow || activeOvertimeSession ? 'ticking' : ''}`}>
              <span className="earnings-currency">$</span>
              <span>{mainEarned.toLocaleString()}</span>
              <span className="earnings-decimals">.{decimalsEarned}</span>
            </div>
            {(isWorkingNow || activeOvertimeSession) && (
              <div style={{marginTop: '1rem', color: 'var(--accent)', fontSize: '0.85rem'}}>
                +$ {(
                  (isWorkingNow ? earningsPerWorkSec : 0) + 
                  (activeOvertimeSession 
                    ? (hourlyRate / 3600) * (activeOvertimeSession.multiplierMode === 'auto' ? getDefaultOvertimeMultiplier(new Date(), isTodayMissed) : activeOvertimeSession.multiplierMode)
                    : 0)
                ).toFixed(4)} / sec
              </div>
            )}
          </div>
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
             <div className="card-label">Cycle Remaining</div>
             <div className="card-value">{(100 - progressPct).toFixed(1)}%</div>
             
             <div className="progress-container">
               <div className="progress-track">
                 <div className="progress-fill" style={{ width: `${100 - progressPct}%` }}></div>
               </div>
               <div className="progress-labels">
                  <span>{cycleStartLabel}</span>
                  <span>{nextPayLabel}</span>
               </div>
             </div>
          </div>

          {/* Overtime Applet Card */}
          <OvertimeCard 
            hourlyRate={hourlyRate} 
            isTodayMissed={isTodayMissed} 
            overtimeAccumulated={overtimeAccumulated} 
            activeOvertimeSession={activeOvertimeSession} 
            overtimeLive={overtimeLive} 
            setOvertimeAccumulated={setOvertimeAccumulated} 
            setActiveOvertimeSession={setActiveOvertimeSession} 
          />

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
                  placeholder={salaryType === 'monthly' ? 'e.g., 15000' : 'e.g., 45.81'}
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
