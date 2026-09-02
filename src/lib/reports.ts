// =============================================================================
// Reports — daily/weekly/monthly aggregation + CSV/PDF/JSON export (brief §66, §96).
// -----------------------------------------------------------------------------
// CSV is always supported. PDF is generated client-side via print-to-pdf (window.print).
// JSON is always supported.
// =============================================================================

import type { DailyEnergyRecord, ReportRequest, ReportFormat } from "./types";

// CSV export — escape commas/quotes/newlines per RFC 4180.
export function recordsToCsv(records: DailyEnergyRecord[]): string {
  const headers = [
    "date",
    "chargeWh",
    "dischargeWh",
    "netWh",
    "chargeAh",
    "dischargeAh",
    "peakChargeA",
    "peakDischargeA",
    "socMin",
    "socMax",
    "alarmCount",
    "telemetryCompleteness",
    "deviceAvailability",
  ];
  const rows = records.map((r) =>
    [
      r.date,
      r.chargeWh,
      r.dischargeWh,
      r.netWh,
      r.chargeAh,
      r.dischargeAh,
      r.peakChargeA ?? "",
      r.peakDischargeA ?? "",
      r.socMin ?? "",
      r.socMax ?? "",
      r.alarmCount,
      r.telemetryCompleteness,
      r.deviceAvailability,
    ]
      .map(csvEscape)
      .join(","),
  );
  return [headers.join(","), ...rows].join("\n");
}

function csvEscape(v: string | number): string {
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function recordsToJson(records: DailyEnergyRecord[]): string {
  return JSON.stringify({ generatedAt: Date.now(), records }, null, 2);
}

// Triggers client-side PDF export by opening a print-friendly window.
// (Browser print → "Save as PDF" — most reliable cross-platform approach
// without bundling a heavy PDF library.)
export function exportPdf(records: DailyEnergyRecord[], title: string): void {
  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) {
    alert("Pop-up blocked — please allow pop-ups to export PDF.");
    return;
  }
  const html = renderReportHtml(records, title);
  win.document.write(html);
  win.document.close();
  // Give the browser a tick to render before printing.
  setTimeout(() => {
    win.focus();
    win.print();
  }, 400);
}

function renderReportHtml(records: DailyEnergyRecord[], title: string): string {
  const rows = records
    .map(
      (r) => `<tr>
      <td>${r.date}</td>
      <td class="num">${r.chargeWh.toFixed(0)}</td>
      <td class="num">${r.dischargeWh.toFixed(0)}</td>
      <td class="num">${r.netWh.toFixed(0)}</td>
      <td class="num">${r.chargeAh.toFixed(2)}</td>
      <td class="num">${r.dischargeAh.toFixed(2)}</td>
      <td class="num">${r.peakChargeA ?? "—"}</td>
      <td class="num">${r.peakDischargeA ?? "—"}</td>
      <td class="num">${r.socMin ?? "—"}%</td>
      <td class="num">${r.socMax ?? "—"}%</td>
      <td class="num">${r.alarmCount}</td>
      <td class="num">${(r.telemetryCompleteness * 100).toFixed(1)}%</td>
      <td class="num">${(r.deviceAvailability * 100).toFixed(1)}%</td>
    </tr>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${title}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #0a0f1a; padding: 24px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p.subtitle { color: #64748b; font-size: 12px; margin: 0 0 20px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th, td { padding: 6px 8px; border: 1px solid #e2e8f0; text-align: left; }
  th { background: #f8fafc; font-weight: 600; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .footer { margin-top: 16px; font-size: 10px; color: #94a3b8; }
  @media print { @page { margin: 1cm; } body { padding: 0; } }
</style>
</head>
<body>
  <h1>${title}</h1>
  <p class="subtitle">Generated: ${new Date().toLocaleString()} · Records: ${records.length}</p>
  <table>
    <thead><tr>
      <th>Date</th>
      <th>Charge (Wh)</th>
      <th>Discharge (Wh)</th>
      <th>Net (Wh)</th>
      <th>Charge (Ah)</th>
      <th>Discharge (Ah)</th>
      <th>Peak Charge (A)</th>
      <th>Peak Discharge (A)</th>
      <th>SOC Min</th>
      <th>SOC Max</th>
      <th>Alarms</th>
      <th>Telemetry %</th>
      <th>Availability %</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="footer">PLTS Monitor PWA · Production-grade · CSV/PDF/JSON export</p>
</body>
</html>`;
}

export function downloadBlob(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportRecords(records: DailyEnergyRecord[], req: ReportRequest): void {
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const baseName = `plts-report-${req.range}-${ts}`;
  switch (req.format as ReportFormat) {
    case "csv":
      downloadBlob(recordsToCsv(records), `${baseName}.csv`, "text/csv;charset=utf-8");
      break;
    case "json":
      downloadBlob(recordsToJson(records), `${baseName}.json`, "application/json");
      break;
    case "pdf":
      exportPdf(
        records,
        `PLTS Report — ${req.range} (${new Date(req.from).toLocaleDateString()} → ${new Date(req.to).toLocaleDateString()})`,
      );
      break;
  }
}

// Aggregate hourly samples → daily records (for demo when GAS not available).
export function aggregateDaily(records: DailyEnergyRecord[]): DailyEnergyRecord[] {
  // Group by date and sum. Already-daily records pass through.
  const map = new Map<string, DailyEnergyRecord>();
  for (const r of records) {
    const existing = map.get(r.date);
    if (!existing) {
      map.set(r.date, { ...r });
    } else {
      existing.chargeWh += r.chargeWh;
      existing.dischargeWh += r.dischargeWh;
      existing.netWh += r.netWh;
      existing.chargeAh += r.chargeAh;
      existing.dischargeAh += r.dischargeAh;
      existing.peakChargeA = maxNullable(existing.peakChargeA, r.peakChargeA);
      existing.peakDischargeA = maxNullable(existing.peakDischargeA, r.peakDischargeA);
      existing.socMin = minNullable(existing.socMin, r.socMin);
      existing.socMax = maxNullable(existing.socMax, r.socMax);
      existing.alarmCount += r.alarmCount;
      existing.telemetryCompleteness = Math.min(existing.telemetryCompleteness, r.telemetryCompleteness);
      existing.deviceAvailability = Math.min(existing.deviceAvailability, r.deviceAvailability);
    }
  }
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function maxNullable<T extends number | null>(a: T, b: T): T {
  if (a == null) return b;
  if (b == null) return a;
  return (a > b ? a : b) as T;
}
function minNullable<T extends number | null>(a: T, b: T): T {
  if (a == null) return b;
  if (b == null) return a;
  return (a < b ? a : b) as T;
}
