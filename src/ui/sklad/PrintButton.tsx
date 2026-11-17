'use client';

export function PrintButton({ label = 'Tlačiť / uložiť ako PDF (A4)' }: { label?: string }) {
  return (
    <button className="btn primary no-print" type="button" onClick={() => window.print()} style={{ minHeight: 44 }}>
      {label}
    </button>
  );
}
