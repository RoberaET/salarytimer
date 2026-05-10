import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export interface OvertimeRecord {
  id: string;
  date: string;
  startMs: number;
  endMs: number;
  earned: number;
  multiplierMode: number | 'auto';
  formFilled: boolean;
}

function fmt(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  const m = d.getMinutes();
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

export async function generateOTPdf(
  employeeName: string,
  workPerformed: string,
  estimatedHours: string,
  records: OvertimeRecord[]
) {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  // Fonts & Colors
  doc.setTextColor(0, 0, 0);

  // 1. Header
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('BESYS TECHNOLOGIES PLC', 105, 20, { align: 'center' });
  doc.text('OVER TIME WORK ORDER', 105, 27, { align: 'center' });

  // 2. Form Fields
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  
  // Name of Employee
  doc.text('Name of Employee:', 14, 42);
  doc.text(employeeName, 50, 41.5);
  doc.line(48, 42.5, 196, 42.5);

  // Work Performed
  doc.text('Work Performed:', 14, 52);
  doc.text(workPerformed, 45, 51.5);
  doc.line(44, 52.5, 196, 52.5);

  // Estimated hours
  doc.text('Estimated hours for completion:', 14, 62);
  doc.text(estimatedHours, 71, 61.5);
  doc.line(70, 62.5, 196, 62.5);

  // Authorized by
  doc.text("Authorized by ______Division/Dep't Manager: ______Division/Dep't Manager:______________", 14, 72);

  // 3. Table Processing
  let sum15Ms = 0, sum175Ms = 0, sum20Ms = 0, sum25Ms = 0;

  function formatDuration(ms: number): string {
    if (ms <= 0) return '';
    const totalMinutes = Math.round(ms / 60000);
    const hrs = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    return `${hrs}:${String(mins).padStart(2, '0')}`;
  }

  const tableRows = records.map(r => {
    const durationMs = r.endMs - r.startMs;
    let val15 = '', val175 = '', val20 = '', val25 = '';
    
    const mult = typeof r.multiplierMode === 'number' ? r.multiplierMode : 1.5;
    if (mult <= 1.5) {
      val15 = formatDuration(durationMs);
      sum15Ms += durationMs;
    } else if (mult <= 1.75) {
      val175 = formatDuration(durationMs);
      sum175Ms += durationMs;
    } else if (mult <= 2.0) {
      val20 = formatDuration(durationMs);
      sum20Ms += durationMs;
    } else {
      val25 = formatDuration(durationMs);
      sum25Ms += durationMs;
    }

    return [
      r.date,
      fmt(r.startMs),
      fmt(r.endMs),
      val15,
      val175,
      val20,
      val25,
      '', // Remark
      ''  // Signature
    ];
  });

  // Ensure minimum 15 rows to perfectly replicate the blank printed template feel
  const minRows = 15;
  while (tableRows.length < minRows) {
    tableRows.push(['', '', '', '', '', '', '', '', '']);
  }

  // 4. Draw Table
  autoTable(doc, {
    startY: 82,
    head: [
      [
        { content: 'Date', rowSpan: 2, styles: { halign: 'center', valign: 'middle' } },
        { content: 'TIME', colSpan: 2, styles: { halign: 'center' } },
        { content: 'Actual Time Taken', colSpan: 4, styles: { halign: 'center' } },
        { content: 'Remark', rowSpan: 2, styles: { halign: 'center', valign: 'middle' } },
        { content: 'Signature', rowSpan: 2, styles: { halign: 'center', valign: 'middle' } }
      ],
      [
        { content: 'IN', styles: { halign: 'center' } }, 
        { content: 'OUT', styles: { halign: 'center' } },
        { content: '1.5\nNormal Hrs:\n5:30 PM-10 PM', styles: { halign: 'center' } },
        { content: '1.75\nNormal Hrs:\n10PM-6 AM', styles: { halign: 'center' } },
        { content: '2\nWeekends', styles: { halign: 'center' } },
        { content: '2.5\nHolidays', styles: { halign: 'center' } }
      ]
    ],
    body: [
      ...tableRows,
      // Total Row appended at the end
      [
        { content: 'TOTAL', styles: { fontStyle: 'bold', halign: 'center' } },
        '',
        '',
        { content: sum15Ms > 0 ? formatDuration(sum15Ms) : '', styles: { fontStyle: 'bold', halign: 'center' } },
        { content: sum175Ms > 0 ? formatDuration(sum175Ms) : '', styles: { fontStyle: 'bold', halign: 'center' } },
        { content: sum20Ms > 0 ? formatDuration(sum20Ms) : '', styles: { fontStyle: 'bold', halign: 'center' } },
        { content: sum25Ms > 0 ? formatDuration(sum25Ms) : '', styles: { fontStyle: 'bold', halign: 'center' } },
        '',
        ''
      ]
    ],
    theme: 'grid',
    styles: { 
      font: 'helvetica', 
      fontSize: 9, 
      cellPadding: 2, 
      textColor: [0, 0, 0], 
      lineColor: [0, 0, 0],
      lineWidth: 0.2, // standard border
      fillColor: [255, 255, 255] // transparent/white cells
    },
    headStyles: { 
      fillColor: [255, 255, 255], 
      textColor: [0, 0, 0], 
      fontStyle: 'bold',
      lineColor: [0, 0, 0],
      lineWidth: 0.2
    },
    columnStyles: {
      0: { cellWidth: 22 },
      1: { cellWidth: 16 },
      2: { cellWidth: 16 },
      3: { cellWidth: 24 },
      4: { cellWidth: 24 },
      5: { cellWidth: 18 },
      6: { cellWidth: 18 },
      7: { cellWidth: 20 },
      8: { cellWidth: 'auto' }
    }
  });

  // 5. Footer and Signatures
  const finalY = (doc as any).lastAutoTable.finalY + 15;

  doc.setFontSize(10);
  doc.text('I confirm that the above named employee has worked overtime as indicated in the time table and completed that assigned job.', 14, finalY);

  const sigY = finalY + 25;
  doc.text('________________', 14, sigY);
  doc.text('Employee Signature', 14, sigY + 5);

  doc.text('________________', 80, sigY);
  doc.text('Checked By:', 80, sigY + 5);
  doc.text("Division/Dep't Manager", 80, sigY + 10);
  doc.text('Name & Signature', 80, sigY + 15);

  doc.text('________________', 140, sigY);
  doc.text('Approved By:', 140, sigY + 5);
  doc.text('D/CEO Operation/Resource', 140, sigY + 10);
  doc.text('Name & Signature', 140, sigY + 15);

  // 6. Download
  const filename = `OT_Work_Order_${new Date().toISOString().split('T')[0]}.pdf`;
  
  try {
    if ('showSaveFilePicker' in window) {
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: filename,
        types: [{
          description: 'PDF Document',
          accept: { 'application/pdf': ['.pdf'] }
        }]
      });
      const writable = await handle.createWritable();
      // jspdf's .output('arraybuffer') is standard
      await writable.write(doc.output('arraybuffer'));
      await writable.close();
    } else {
      doc.save(filename);
    }
  } catch (err: any) {
    if (err.name !== 'AbortError') {
      console.error('Save failed:', err);
      doc.save(filename);
    }
  }
}
