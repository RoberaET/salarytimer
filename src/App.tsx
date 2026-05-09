import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import './index.css';
import { EthDateTime } from 'ethiopian-calendar-date-converter';
import { generateOTPdf } from './generateOTPdf';

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
 * Sum only seconds inside the daily work window, walking day by day.
 * Rules:
 *   Every day is considered a regular work day (no weekend exclusions).
 *   Daily window → [clockInMin, effectiveOutMin] (lunch already deducted)
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
    const dateStr = localDateStr(dDate);

    if (!missedDates.includes(dateStr)) { // skip missed holidays entirely
      const inMin  = clockInMin;
      const outMin = effectiveOutMin;

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

// ── Overtime history record ────────────────────────────────────────────────
interface OvertimeRecord {
  id: string;
  date: string;        // YYYY-MM-DD
  startMs: number;
  endMs: number;
  earned: number;
  multiplierMode: 'auto' | number;
  formFilled: boolean;
}

function fmt(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  const m = d.getMinutes();
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2,'0')} ${period}`;
}

/**
 * Convert a "HH:MM" 24-hr Gregorian string to Ethiopian clock display.
 * Ethiopian time = (Gregorian hour - 6 + 24) % 12 (12 when result is 0)
 * Periods: 6–11 AM → ጥዋት | 12 PM–5 PM → ቀን | 6–11 PM → ምሽት | 12–5 AM → ሌሊት
 */
function toEthiopianTime(timeStr: string): string {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':').map(Number);
  const ethH = (h - 6 + 24) % 12 || 12;
  const period =
    h >= 6  && h < 12 ? 'ጥዋት'   :
    h >= 12 && h < 18 ? 'ቀን'    :
    h >= 18           ? 'ምሽት'   : 'ሌሊት';
  return `${ethH}:${String(m).padStart(2,'0')} ${period}`;
}

// ── Manual past-OT entry modal ────────────────────────────────────────────
function ManualOTModal({ onClose, defaultHourlyRate, otHistory, setOtHistory, overtimeAccumulated, setOvertimeAccumulated }: {
  onClose: () => void;
  defaultHourlyRate: number;
  otHistory: OvertimeRecord[];
  setOtHistory: (h: OvertimeRecord[]) => void;
  overtimeAccumulated: number;
  setOvertimeAccumulated: (n: number) => void;
}) {
  const todayStr = localDateStr(new Date());
  const nowHHMM = `${String(new Date().getHours()).padStart(2,'0')}:${String(new Date().getMinutes()).padStart(2,'0')}`;

  const [date,       setDate]       = useState(todayStr);
  const [startTime,  setStartTime]  = useState('17:30');
  const [endTime,    setEndTime]    = useState(nowHHMM);
  const [hourlyRate, setHourlyRate] = useState(defaultHourlyRate.toFixed(2));
  const [multiplier, setMultiplier] = useState('1.0');
  const [error,      setError]      = useState('');

  // Detect if the session crosses midnight (end time < start time on the same clock)
  const crossesMidnight = useMemo(() => {
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    return (eh * 60 + em) < (sh * 60 + sm);
  }, [startTime, endTime]);

  // Total worked duration in minutes
  const workedMinutes = useMemo(() => {
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    let endTotalMin = eh * 60 + em;
    if (crossesMidnight) endTotalMin += 24 * 60;
    const diff = endTotalMin - (sh * 60 + sm);
    return diff > 0 ? diff : 0;
  }, [startTime, endTime, crossesMidnight]);

  const earned = useMemo(() => {
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    let endTotalMin = eh * 60 + em;
    if (crossesMidnight) endTotalMin += 24 * 60; // next day
    const hrs = (endTotalMin - (sh * 60 + sm)) / 60;
    const rate = parseFloat(hourlyRate) || 0;
    const mult = parseFloat(multiplier) || 1;
    if (hrs <= 0) return 0;
    return hrs * rate * mult;
  }, [startTime, endTime, hourlyRate, multiplier, crossesMidnight]);

  const handleSave = () => {
    if (!date) { setError('Please select a date.'); return; }
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    if (earned <= 0) { setError('Earned amount must be greater than 0. Check your times.'); return; }

    const [yr, mo, dy] = date.split('-').map(Number);
    const startMs = new Date(yr, mo - 1, dy, sh, sm, 0, 0).getTime();
    // If crossing midnight, end is on the next calendar day
    const endDate = crossesMidnight
      ? new Date(yr, mo - 1, dy + 1, eh, em, 0, 0)
      : new Date(yr, mo - 1, dy,     eh, em, 0, 0);
    const endMs = endDate.getTime();
    const mult = parseFloat(multiplier) || 1;

    const record: OvertimeRecord = {
      id: Date.now().toString(),
      date,
      startMs,
      endMs,
      earned,
      multiplierMode: mult,
      formFilled: false,
    };

    const newHistory = [record, ...otHistory];
    setOtHistory(newHistory);
    localStorage.setItem('calc_ot_history', JSON.stringify(newHistory));

    const newAcc = overtimeAccumulated + earned;
    setOvertimeAccumulated(newAcc);
    localStorage.setItem('calc_ot_acc', newAcc.toString());

    onClose();
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '0.6rem 0.75rem', borderRadius: '10px',
    border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)',
    color: '#fff', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box',
  };
  const labelStyle: React.CSSProperties = {
    fontSize: '0.78rem', opacity: 0.75, display: 'block', marginBottom: '0.35rem', fontWeight: 500,
  };

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
    }} onClick={onClose}>
      <div style={{
        background: 'linear-gradient(145deg, #0f172a, #1e293b)',
        border: '1px solid rgba(139,92,246,0.35)',
        borderRadius: '18px', padding: '1.8rem',
        width: '100%', maxWidth: '420px',
        maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 25px 60px rgba(0,0,0,0.6)',
      }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.4rem' }}>
          <div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>Log Past Overtime</div>
            <div style={{ fontSize: '0.78rem', opacity: 0.55, marginTop: '0.2rem' }}>Manually add an overtime session to your history</div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: '1.2rem', lineHeight: 1 }}>✕</button>
        </div>

        {/* Date */}
        <div style={{ marginBottom: '1rem' }}>
          <label style={labelStyle}>Date</label>
          <input type="date" style={inputStyle} value={date} max={todayStr} onChange={e => setDate(e.target.value)} />
        </div>

        {/* Start / End */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
          <div>
            <label style={labelStyle}>OT Start Time</label>
            <input type="time" style={inputStyle} value={startTime} onChange={e => setStartTime(e.target.value)} />
            {startTime && <div style={{ fontSize: '0.68rem', marginTop: '0.25rem', color: '#22d3ee', opacity: 0.8 }}>🇪🇹 {toEthiopianTime(startTime)}</div>}
          </div>
          <div>
            <label style={labelStyle}>OT End Time</label>
            <input type="time" style={inputStyle} value={endTime} onChange={e => setEndTime(e.target.value)} />
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.25rem', flexWrap: 'wrap' }}>
              {endTime && <span style={{ fontSize: '0.68rem', color: '#22d3ee', opacity: 0.8 }}>🇪🇹 {toEthiopianTime(endTime)}</span>}
              {crossesMidnight && (
                <span style={{
                  fontSize: '0.65rem', fontWeight: 700,
                  background: 'rgba(251,191,36,0.15)',
                  color: '#fbbf24',
                  border: '1px solid rgba(251,191,36,0.3)',
                  borderRadius: '4px', padding: '1px 5px',
                }}>+1 day</span>
              )}
            </div>
          </div>
        </div>

        {/* Hourly Rate & Multiplier */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1.2rem' }}>
          <div>
            <label style={labelStyle}>Hourly Rate ($)</label>
            <input type="number" min="0" step="0.01" style={inputStyle} value={hourlyRate} onChange={e => setHourlyRate(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Multiplier (x)</label>
            <input type="number" min="1" step="0.1" style={inputStyle} value={multiplier} onChange={e => setMultiplier(e.target.value)} />
          </div>
        </div>

        {/* Preview */}
        <div style={{
          background: earned > 0 ? 'rgba(52,211,153,0.08)' : 'rgba(255,255,255,0.04)',
          border: `1px solid ${earned > 0 ? 'rgba(52,211,153,0.25)' : 'rgba(255,255,255,0.08)'}`,
          borderRadius: '12px', padding: '0.9rem 1rem',
          marginBottom: '1.2rem', transition: 'all 0.25s',
        }}>
          {/* Hours worked row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.55rem', paddingBottom: '0.55rem', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            <span style={{ fontSize: '0.82rem', opacity: 0.7 }}>Time Worked</span>
            <span style={{ fontSize: '1rem', fontWeight: 700, color: workedMinutes > 0 ? '#e2e8f0' : 'rgba(255,255,255,0.3)' }}>
              {workedMinutes > 0
                ? `${Math.floor(workedMinutes / 60)}h ${workedMinutes % 60}m`
                : '—'}
            </span>
          </div>
          {/* Earned row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.82rem', opacity: 0.7 }}>Estimated Earned</span>
            <span style={{ fontSize: '1.3rem', fontWeight: 800, color: earned > 0 ? '#34d399' : 'rgba(255,255,255,0.3)' }}>
              $ {earned.toFixed(2)}
            </span>
          </div>
        </div>

        {/* Error */}
        {error && <div style={{ fontSize: '0.78rem', color: '#f87171', marginBottom: '0.8rem', textAlign: 'center' }}>{error}</div>}

        {/* Actions */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <button onClick={onClose} style={{
            padding: '0.65rem', borderRadius: '10px',
            border: '1px solid rgba(255,255,255,0.15)', background: 'transparent',
            color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 600,
          }}>Cancel</button>
          <button onClick={handleSave} style={{
            padding: '0.65rem', borderRadius: '10px',
            border: 'none', background: 'linear-gradient(135deg, #8b5cf6, #6366f1)',
            color: '#fff', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 700,
            boxShadow: '0 4px 15px rgba(139,92,246,0.35)',
          }}>Save OT Entry</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Export OT PDF Modal ───────────────────────────────────────────────
function ExportPdfModal({ onClose, otHistory, setOtHistory }: {
  onClose: () => void;
  otHistory: OvertimeRecord[];
  setOtHistory: (h: OvertimeRecord[]) => void;
}) {
  const [employeeName, setEmployeeName] = useState(() => localStorage.getItem('calc_employee_name') || '');
  const [workPerformed, setWorkPerformed] = useState('');
  const [error, setError] = useState('');
  const [markFiled, setMarkFiled] = useState(true);
  const [exportType, setExportType] = useState<'unfiled' | 'all'>('unfiled');

  const recordsToExport = useMemo(() => {
    return exportType === 'unfiled' ? otHistory.filter(r => !r.formFilled) : otHistory;
  }, [exportType, otHistory]);
  
  // Calculate estimated total hours from these records to put in the template header
  const estimatedHours = useMemo(() => {
    let totalHrs = 0;
    recordsToExport.forEach(r => {
      totalHrs += (r.endMs - r.startMs) / 3600000;
    });
    return totalHrs.toFixed(2);
  }, [recordsToExport]);

  const handleExport = () => {
    if (recordsToExport.length === 0) {
      setError('No overtime records available to export.');
      return;
    }
    if (!employeeName.trim()) {
      setError('Please enter the employee name.');
      return;
    }
    if (!workPerformed.trim()) {
      setError('Please enter the work performed.');
      return;
    }

    localStorage.setItem('calc_employee_name', employeeName);

    // Call PDF generator
    generateOTPdf(employeeName, workPerformed, estimatedHours, recordsToExport);

    // Optionally mark all as filed
    if (markFiled) {
      const updatedHistory = otHistory.map(r => {
        // If it's in recordsToExport and not yet filed, mark it
        if (recordsToExport.some(e => e.id === r.id) && !r.formFilled) {
          return { ...r, formFilled: true };
        }
        return r;
      });
      setOtHistory(updatedHistory);
      localStorage.setItem('calc_ot_history', JSON.stringify(updatedHistory));
    }

    onClose();
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '0.6rem 0.75rem', borderRadius: '10px',
    border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)',
    color: '#fff', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box',
    marginBottom: '1rem'
  };
  const labelStyle: React.CSSProperties = {
    fontSize: '0.78rem', opacity: 0.75, display: 'block', marginBottom: '0.35rem', fontWeight: 500,
  };

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
    }} onClick={onClose}>
      <div style={{
        background: 'linear-gradient(145deg, #0f172a, #1e293b)',
        border: '1px solid rgba(139,92,246,0.35)',
        borderRadius: '18px', padding: '1.8rem',
        width: '100%', maxWidth: '420px',
        boxShadow: '0 25px 60px rgba(0,0,0,0.6)',
      }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.4rem' }}>
          <div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>Export OT Form</div>
            <div style={{ fontSize: '0.78rem', opacity: 0.55, marginTop: '0.2rem' }}>Generates PDF for {recordsToExport.length} record(s)</div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: '1.2rem', lineHeight: 1 }}>✕</button>
        </div>

        <div>
          <label style={labelStyle}>Records to Export</label>
          <select style={{...inputStyle, appearance: 'none'}} value={exportType} onChange={e => setExportType(e.target.value as 'unfiled' | 'all')}>
            <option value="unfiled">Unfiled Only ({otHistory.filter(r => !r.formFilled).length} records)</option>
            <option value="all">All Records ({otHistory.length} records)</option>
          </select>
        </div>

        <div>
          <label style={labelStyle}>Name of Employee</label>
          <input type="text" style={inputStyle} placeholder="John Doe" value={employeeName} onChange={e => setEmployeeName(e.target.value)} />
        </div>

        <div>
          <label style={labelStyle}>Work Performed</label>
          <input type="text" style={inputStyle} placeholder="Server maintenance and testing" value={workPerformed} onChange={e => setWorkPerformed(e.target.value)} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.2rem' }}>
          <input type="checkbox" id="markFiled" checked={markFiled} onChange={e => setMarkFiled(e.target.checked)} style={{ cursor: 'pointer', width: '16px', height: '16px', accentColor: '#8b5cf6' }} />
          <label htmlFor="markFiled" style={{ fontSize: '0.85rem', cursor: 'pointer', opacity: 0.85 }}>
            Mark exported records as "✓ Form Filed"
          </label>
        </div>

        {error && <div style={{ fontSize: '0.78rem', color: '#f87171', marginBottom: '0.8rem', textAlign: 'center' }}>{error}</div>}

        {/* Actions */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <button onClick={onClose} style={{
            padding: '0.65rem', borderRadius: '10px',
            border: '1px solid rgba(255,255,255,0.15)', background: 'transparent',
            color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 600,
          }}>Cancel</button>
          <button onClick={handleExport} style={{
            padding: '0.65rem', borderRadius: '10px',
            border: 'none', background: 'linear-gradient(135deg, #10b981, #059669)',
            color: '#fff', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 700,
            boxShadow: '0 4px 15px rgba(16,185,129,0.35)',
            opacity: recordsToExport.length === 0 ? 0.5 : 1,
            pointerEvents: recordsToExport.length === 0 ? 'none' : 'auto',
          }}>Download Filled Form</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function OvertimeCard({ isTodayMissed, overtimeAccumulated, activeOvertimeSession, overtimeLive, setOvertimeAccumulated, setActiveOvertimeSession, otHistory, setOtHistory, hourlyRate }: any) {
  const [otStartTime, setOtStartTime] = useState<string>(
    `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`
  );
  
  const currentDefaultMultiplier = useMemo(() => getDefaultOvertimeMultiplier(new Date(), isTodayMissed), [isTodayMissed]);
  const [otInputMultiplier, setOtInputMultiplier] = useState<string>('');
  
  const multiplierToUse = otInputMultiplier !== '' ? Number(otInputMultiplier) : 'auto';

  const [showManualModal, setShowManualModal] = useState(false);
  const [showPdfModal, setShowPdfModal] = useState(false);

  const handleStart = () => {
    const [h, m] = otStartTime.split(':').map(Number);
    const now = new Date();
    const startD = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
    const session = { startMs: startD.getTime(), multiplierMode: multiplierToUse };
    setActiveOvertimeSession(session);
    localStorage.setItem('calc_ot_session', JSON.stringify(session));
  };

  const handleStop = () => {
    const endMs = Date.now();
    const newAcc = overtimeAccumulated + overtimeLive;
    setOvertimeAccumulated(newAcc);
    localStorage.setItem('calc_ot_acc', newAcc.toString());

    // Save to history
    const record: OvertimeRecord = {
      id: endMs.toString(),
      date: localDateStr(new Date(endMs)),
      startMs: activeOvertimeSession.startMs,
      endMs,
      earned: overtimeLive,
      multiplierMode: activeOvertimeSession.multiplierMode,
      formFilled: false,
    };
    const newHistory = [record, ...otHistory];
    setOtHistory(newHistory);
    localStorage.setItem('calc_ot_history', JSON.stringify(newHistory));

    setActiveOvertimeSession(null);
    localStorage.removeItem('calc_ot_session');
  };

  const handleResetOT = () => {
    setOvertimeAccumulated(0);
    setActiveOvertimeSession(null);
    setOtHistory([]);
    localStorage.removeItem('calc_ot_acc');
    localStorage.removeItem('calc_ot_session');
    localStorage.removeItem('calc_ot_history');
  };

  const toggleFormFilled = (id: string) => {
    const updated = otHistory.map((r: OvertimeRecord) =>
      r.id === id ? { ...r, formFilled: !r.formFilled } : r
    );
    setOtHistory(updated);
    localStorage.setItem('calc_ot_history', JSON.stringify(updated));
  };

  const deleteRecord = (id: string) => {
    const updated = otHistory.filter((r: OvertimeRecord) => r.id !== id);
    setOtHistory(updated);
    localStorage.setItem('calc_ot_history', JSON.stringify(updated));
  };

  return (
    <div className="bento-card hero-card" style={{ background: activeOvertimeSession ? 'linear-gradient(135deg, rgba(8, 145, 178, 0.1), rgba(139, 92, 246, 0.1))' : undefined, border: activeOvertimeSession ? '1px solid rgba(139, 92, 246, 0.3)' : undefined }}>
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="card-label" style={{margin:0}}>Overtime Tracker</div>
        <button
          className="icon-btn"
          style={{ padding: '0.4rem', color: 'var(--accent, #22d3ee)', background: 'rgba(34,211,238,0.1)', border: '1px solid rgba(34,211,238,0.2)' }}
          onClick={() => setShowPdfModal(true)}
          title="Export OT Form as PDF"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="12" y1="18" x2="12" y2="12"></line>
            <line x1="9" y1="15" x2="12" y2="18"></line>
            <line x1="15" y1="15" x2="12" y2="18"></line>
          </svg>
        </button>
      </div>
      
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <button className="btn-primary" style={{ width: '100%', padding: '0.6rem' }} onClick={handleStart}>Start Overtime Session</button>
            <button
              onClick={() => setShowManualModal(true)}
              style={{
                width: '100%', padding: '0.55rem',
                borderRadius: '10px',
                border: '1px solid rgba(139,92,246,0.4)',
                background: 'rgba(139,92,246,0.1)',
                color: '#c084fc', cursor: 'pointer',
                fontSize: '0.85rem', fontWeight: 600,
                transition: 'background 0.2s',
              }}
            >
              + Log Past Overtime
            </button>
          </div>
        )}
      </div>

      {showManualModal && (
        <ManualOTModal
          onClose={() => setShowManualModal(false)}
          defaultHourlyRate={hourlyRate}
          otHistory={otHistory}
          setOtHistory={setOtHistory}
          overtimeAccumulated={overtimeAccumulated}
          setOvertimeAccumulated={setOvertimeAccumulated}
        />
      )}

      {showPdfModal && (
        <ExportPdfModal
          onClose={() => setShowPdfModal(false)}
          otHistory={otHistory}
          setOtHistory={setOtHistory}
        />
      )}

      {/* ── Summary row ── */}
      <div style={{ marginTop: '1.2rem', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '0.8rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div className="card-subtext">Total OT Earned this Cycle</div>
          <div className="card-value" style={{fontSize: '1.2rem', color: 'var(--success)'}}>$ {overtimeAccumulated.toFixed(2)}</div>
        </div>
        <button className="icon-btn" style={{ padding: '0.4rem', color: 'rgba(255,255,255,0.5)' }} onClick={handleResetOT} aria-label="Reset Overtime" title="Clear All Overtime Data">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      </div>

      {/* ── History list ── */}
      {otHistory.length > 0 && (
        <div style={{ marginTop: '1rem' }}>
          <div className="card-subtext" style={{ marginBottom: '0.6rem', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', fontSize: '0.72rem' }}>OT Session History</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem', maxHeight: '260px', overflowY: 'auto', paddingRight: '2px' }}>
            {otHistory.map((r: OvertimeRecord) => (
              <div
                key={r.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  alignItems: 'center',
                  gap: '0.5rem',
                  background: r.formFilled ? 'rgba(52,211,153,0.07)' : 'rgba(255,255,255,0.04)',
                  border: r.formFilled ? '1px solid rgba(52,211,153,0.25)' : '1px solid rgba(255,255,255,0.08)',
                  borderRadius: '10px',
                  padding: '0.6rem 0.75rem',
                  transition: 'background 0.25s, border 0.25s',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--accent, #22d3ee)' }}>{r.date}</span>
                    <span style={{ fontSize: '0.75rem', opacity: 0.7 }}>{fmt(r.startMs)} – {fmt(r.endMs)}</span>
                    <span style={{ fontSize: '0.68rem', background: 'rgba(139,92,246,0.18)', color: '#c084fc', borderRadius: '4px', padding: '1px 5px' }}>
                      {r.multiplierMode === 'auto' ? 'Auto' : `${r.multiplierMode}x`}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.7rem', marginTop: '0.15rem', opacity: 0.6 }}>
                    🇪🇹 {toEthiopianTime(`${String(new Date(r.startMs).getHours()).padStart(2,'0')}:${String(new Date(r.startMs).getMinutes()).padStart(2,'0')}`)}
                    {' – '}
                    {toEthiopianTime(`${String(new Date(r.endMs).getHours()).padStart(2,'0')}:${String(new Date(r.endMs).getMinutes()).padStart(2,'0')}`)}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.25rem' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--success, #34d399)' }}>+$ {r.earned.toFixed(2)}</span>
                    {r.formFilled && <span style={{ fontSize: '0.68rem', color: 'var(--success, #34d399)', opacity: 0.85 }}>✓ Form Filed</span>}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexShrink: 0 }}>
                  <button
                    onClick={() => toggleFormFilled(r.id)}
                    title={r.formFilled ? 'OT form filed ✓' : 'Mark OT form as filed'}
                    style={{
                      width: '28px', height: '28px', borderRadius: '7px',
                      border: r.formFilled ? '2px solid rgba(52,211,153,0.7)' : '2px solid rgba(255,255,255,0.2)',
                      background: r.formFilled ? 'rgba(52,211,153,0.18)' : 'transparent',
                      color: r.formFilled ? '#34d399' : 'rgba(255,255,255,0.35)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer', transition: 'all 0.2s', flexShrink: 0,
                    }}
                    aria-label="Toggle OT form filed"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                  </button>

                  <button
                    onClick={() => deleteRecord(r.id)}
                    title="Remove record"
                    style={{
                      width: '24px', height: '24px', borderRadius: '6px',
                      border: 'none', background: 'transparent',
                      color: 'rgba(255,255,255,0.2)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer', transition: 'color 0.2s', flexShrink: 0,
                    }}
                    onMouseEnter={e => (e.currentTarget.style.color = '#f87171')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.2)')}
                    aria-label="Delete OT record"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
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
  const [todayGross,       setTodayGross]       = useState<number>(0);
  const [secondsToPayment, setSecondsToPayment] = useState<number>(0);
  const [progressPct,      setProgressPct]      = useState<number>(0);
  const [isWorkingNow,     setIsWorkingNow]      = useState<boolean>(false);
  
  // Overtime State
  const [overtimeAccumulated, setOvertimeAccumulated] = useState<number>(0);
  const [activeOvertimeSession, setActiveOvertimeSession] = useState<{startMs: number, multiplierMode: 'auto' | number} | null>(null);
  const [overtimeLive, setOvertimeLive] = useState<number>(0);
  const [otHistory, setOtHistory] = useState<OvertimeRecord[]>([]);

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
    const oHist = localStorage.getItem('calc_ot_history');

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
    if (oHist) {
      try { setOtHistory(JSON.parse(oHist)); } catch {}
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
   * Average work-hours per calendar day.
   * Used for monthly-salary prorating.
   */
  const avgHoursPerCalendarDay = useMemo(() => {
    return effectiveHoursPerDay;
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

      // Only count seconds inside effective work window, capped at payDate
      // so earnings never exceed the full salary even if we're past midnight on pay day.
      const countUpTo  = Math.min(nowMs, payDate);
      const workedSecs = calcWorkedSeconds(cycleStart, countUpTo, inMin, effectiveOutMin, missedDates);
      // Hard-cap to the total salary so floating-point drift never overshoots
      const totalSalaryForCycle = salaryType === 'monthly' ? (salary as number) : (salary as number) * effectiveHoursPerDay * 30;
      const earned     = Math.min(workedSecs * earningsPerWorkSec, totalSalaryForCycle);

      const remaining = Math.max(0, (payDate - nowMs) / 1000);
      // True progress = how much of the 30-day calendar window has elapsed
      const cycleTotalMs = payDate - cycleStart;
      const pct = cycleTotalMs > 0
        ? Math.min(100, Math.max(0, (nowMs - cycleStart) / cycleTotalMs * 100))
        : 0;

      // Status: are we inside the effective work window right now?
      const d      = new Date(nowMs);
      const nowMin = d.getHours() * 60 + d.getMinutes();
      const isTodayMissed = missedDates.includes(localDateStr(d));
      const working =
        !isTodayMissed && // not absent/holiday
        (nowMin >= inMin && nowMin < effectiveOutMin);          // weekday window

      // Live overtime calculation
      let currentOt = 0;
      if (activeOvertimeSession) {
        if (activeOvertimeSession.multiplierMode === 'auto') {
          currentOt = calcAutoOvertimeForRange(activeOvertimeSession.startMs, nowMs, hourlyRate, missedDates);
        } else {
          currentOt = Math.max(0, (nowMs - activeOvertimeSession.startMs) / 1000) * (hourlyRate / 3600) * activeOvertimeSession.multiplierMode;
        }
      }

      // Today's Gross
      const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime();
      const countUpToToday = Math.min(nowMs, payDate); // Don't count beyond paydate
      let tGross = 0;
      if (countUpToToday > startOfDay) {
         const todayWorkedSecs = calcWorkedSeconds(startOfDay, countUpToToday, inMin, effectiveOutMin, missedDates);
         tGross = Math.min(todayWorkedSecs * earningsPerWorkSec, totalSalaryForCycle);
      }

      setEarnedAmount(earned);
      setTodayGross(tGross);
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
    setOtHistory([]);
    ['calc_salary','calc_nextPayDate','calc_clockIn','calc_clockOut','calc_missedDates','calc_ot_acc','calc_ot_session','calc_ot_history'].forEach(k => localStorage.removeItem(k));
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

  const totalSalaryForCycle = salaryType === 'monthly' ? parseFloat(salary as string || '0') : parseFloat(salary as string || '0') * effectiveHoursPerDay * 30;
  const taxInfo = calculateEthiopianTaxAndPension(totalSalaryForCycle);

  const mainTotalEarned = earnedAmount + overtimeAccumulated + overtimeLive;
  const mainNet = mainTotalEarned * taxInfo.netRatio;
  
  const mainEarned     = Math.floor(mainNet);
  const decimalsEarned = (mainNet % 1).toFixed(4).substring(2);

  const todayGrossTotal = todayGross + overtimeLive;
  const todayNet = todayGrossTotal * taxInfo.netRatio;
  const todayGov = todayGrossTotal * taxInfo.deductionRatio;
  
  // Rate calculations
  const grossSecRate = (isWorkingNow ? earningsPerWorkSec : 0) + 
    (activeOvertimeSession ? (hourlyRate / 3600) * (activeOvertimeSession.multiplierMode === 'auto' ? getDefaultOvertimeMultiplier(new Date(), isTodayMissed) : activeOvertimeSession.multiplierMode) : 0);
  const netSecRate = grossSecRate * taxInfo.netRatio;

  return (
    <>
      <div className="aurora-bg"></div>

      <header className="app-header">
        <h1 className="brand-title">Pay Dashboard V2.0</h1>
        <div style={{ display: 'flex', gap: '0.8rem' }}>
          <button 
            className="icon-btn" 
            style={isTodayMissed ? { color: 'var(--danger, #f87171)', borderColor: 'var(--danger, #f87171)', background: 'rgba(248, 113, 113, 0.1)' } : {}}
            onClick={toggleHolidayToday} 
            aria-label="Toggle Leave" 
            title={isTodayMissed ? "Resume Work (Undo Leave)" : "Mark as Unpaid Leave"}
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
            <div className="earnings-label">Net Earned This Cycle</div>
            <div className={`earnings-amount ${isWorkingNow || activeOvertimeSession ? 'ticking' : ''}`}>
              <span className="earnings-currency">ETB</span>
              <span>{mainEarned.toLocaleString()}</span>
              <span className="earnings-decimals">.{decimalsEarned}</span>
            </div>
            {(isWorkingNow || activeOvertimeSession) && (
              <div style={{marginTop: '0.5rem', color: 'var(--accent)', fontSize: '0.9rem'}}>
                + ETB {netSecRate.toFixed(4)} / sec (Net)
              </div>
            )}
            
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              marginTop: '2rem', 
              borderTop: '1px solid rgba(255,255,255,0.1)', 
              paddingTop: '1rem',
              gap: '1rem'
            }}>
               <div style={{ textAlign: 'left', flex: 1, padding: '0.5rem', background: 'rgba(16, 185, 129, 0.05)', borderRadius: '12px' }}>
                 <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>I Made Today</div>
                 <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: 'var(--success)' }}>ETB {todayNet.toFixed(2)}</div>
               </div>
               <div style={{ textAlign: 'right', flex: 1, padding: '0.5rem', background: 'rgba(239, 68, 68, 0.05)', borderRadius: '12px' }}>
                 <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>Gov't Took Today</div>
                 <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: 'var(--danger)' }}>ETB {todayGov.toFixed(2)}</div>
               </div>
            </div>
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
             <div className="card-label">Earnings Rate (Gross vs Net)</div>
             <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: '0.5rem' }}>
               <div>
                 <div className="card-value">ETB {hourlyRate.toFixed(2)}</div>
                 <div className="card-subtext">Gross / hour</div>
               </div>
               <div>
                 <div className="card-value">ETB {(hourlyRate * taxInfo.netRatio).toFixed(2)}</div>
                 <div className="card-subtext">Net / hour</div>
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
            otHistory={otHistory}
            setOtHistory={setOtHistory}
          />

        </div>
      )}

      {salary !== '' && (
        <footer style={{
          marginTop: '3rem',
          padding: '2rem 1rem',
          textAlign: 'center',
          color: '#9ca3af',
          borderTop: '1px solid rgba(255, 255, 255, 0.1)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '1rem'
        }}>
          <p style={{ margin: 0, fontSize: '0.95rem', maxWidth: '500px', lineHeight: '1.5' }}>
            Support the developer with money or give suggestions for features you have in mind!
          </p>
          <a 
            href="https://t.me/Robera_Mekonnen" 
            target="_blank" 
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              color: '#38bdf8',
              textDecoration: 'none',
              fontWeight: 500,
              padding: '0.5rem 1rem',
              background: 'rgba(56, 189, 248, 0.1)',
              borderRadius: '20px',
              transition: 'background 0.2s'
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/>
            </svg>
            @Robera_Mekonnen
          </a>
        </footer>
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
                {clockIn && (
                  <div style={{ fontSize: '0.75rem', marginTop: '0.3rem', color: 'var(--accent, #22d3ee)', opacity: 0.85 }}>
                    🇪🇹 {toEthiopianTime(clockIn)}
                  </div>
                )}
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="clockOut">Work End</label>
                <input id="clockOut" type="time" className="input-field" value={clockOut} onChange={handleClockOutChange} />
                {clockOut && (
                  <div style={{ fontSize: '0.75rem', marginTop: '0.3rem', color: 'var(--accent, #22d3ee)', opacity: 0.85 }}>
                    🇪🇹 {toEthiopianTime(clockOut)}
                  </div>
                )}
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
