/**
 * "USPORIADANIE KLUCOV" (Martina, 2026-11-08): where each flat's keys hang, as
 * the office keeps them - name and hook code, in this exact order. Names follow
 * Guesty where the flat is clear (Martina, 2026-11-08); a "?" marks the ones she
 * was not sure about and stays. The letter
 * of the code is the row of hooks; the board colours it (A green, B blue,
 * C yellow, D pink). Static data on purpose: no database, no sync.
 */
export interface KeySpot {
  name: string;
  code: string;
  /** Street and number from Guesty, where the flat is matched (2026-11-08). */
  address?: string;
  /** Floor, flat number or tower, where the office knows it. */
  detail?: string;
}

export const KEYS: readonly KeySpot[] = [
  { name: '29. Augusta, Grand', code: 'A10', address: '29. augusta 28' },
  { name: 'Antolská, Studio', code: 'A140', address: 'Antolská 2' },
  { name: 'Bajkalská, Luxe', code: 'A135', address: 'Bajkalská 2F' },
  { name: 'Baštová, Mi Apt.', code: 'B27', address: 'Baštová' },
  { name: 'Bernolákova, Sunny', code: 'A15', address: 'Bernolákova 3' },
  { name: 'Dobrovského, Spacious', code: 'B87', address: 'Dobrovského 4' },
  { name: 'Dohnanyho, Unique', code: 'A11', address: 'Dohnányho 12' },
  { name: 'Dunajská A, Danube', code: 'C102', address: 'Dunajská 66' },
  { name: 'Dunajská B, White', code: 'C103', address: 'Dunajská 64' },
  { name: 'Dunajská C, Sophisticated', code: 'C104', address: 'Dunajská 58' },
  { name: 'Feriencikova', code: 'C42' },
  { name: 'Ferienčikova B', code: 'C41', address: 'Ferienčíkova 16' },
  { name: 'Gorkého A, Family', code: 'A146', address: 'Gorkého 3' },
  { name: 'Gorkého B, Luxe', code: 'A147', address: 'Gorkého 3' },
  { name: 'Gorkeho C, Lime', code: 'A148', address: 'Gorkého 15' },
  { name: 'Gunduličova B, Boutique', code: 'C34', address: 'Gunduličova 8' },
  { name: 'Heuhaus B, Scandi', code: 'B84', address: 'Námestie 1. mája' },
  { name: 'Heuhaus Paradise 2', code: 'A82', address: 'Námestie 1. mája' },
  { name: 'Hrubá Borša, Nature', code: 'A145', address: 'Rezidenčná, Hrubá Borša' },
  { name: 'Chalupkova, Modern', code: 'A5', address: 'Chalupkova 4' },
  { name: 'Ivanská, Airport', code: 'B93', address: 'Ivanská cesta 36' },
  { name: 'Jarabinková A, Pan.?', code: 'C113', address: 'Jarabinková 10' },
  { name: 'Jarabinková B,Bright?', code: 'C114', address: 'Jarabinková 2c' },
  { name: 'Jégého A, Premium', code: 'A69', address: 'Jégého 14' },
  { name: 'Jégého B, Modern', code: 'A70', address: 'Jégého 8' },
  { name: 'Jelšová, Horizon', code: 'A144', address: 'Jelšová' },
  { name: 'Jungmannova, City', code: 'A16', address: 'Jungmannova 8' },
  { name: 'Klariská, Historical', code: 'A3', address: 'Klariská 8' },
  { name: 'Koceľova, Homely', code: 'A12', address: 'Koceľova 27' },
  { name: 'Konventna, Double', code: 'B96', address: 'Konventná 8' },
  { name: 'Krížna, Suites', code: 'B86', address: 'Krížna 14' },
  { name: 'Mestská, Modern', code: 'A141', address: 'Mestská 5' },
  { name: 'Mickiewiczova 4.poschodie', code: 'A14' },
  { name: 'Mickie. A, Modern', code: 'C111', address: 'Mickiewiczova 10' },
  { name: 'Mickie. B , Stylish', code: 'C112', address: 'Mickiewiczova 10' },
  { name: 'Mierova', code: 'C100' },
  { name: 'Miletičova 1: Green (1. poschodie)', code: 'A134', address: 'Miletičova 38', detail: '1. poschodie' },
  { name: 'Miletičova 2: Jungle (2. poschodie)', code: 'A68', address: 'Miletičova 38', detail: '2. poschodie' },
  { name: 'Modrá Guľa 2 (2nd Floor)', code: 'D124', address: 'Suché mýto 4' },
  { name: 'Modrá Guľa 3 (3rd Floor)', code: 'D126', address: 'Suché mýto 4' },
  { name: 'Modrá Guľa 4 (4th floor)', code: 'D128', address: 'Suché mýto 4' },
  { name: 'Modrá Guľa 5 (5th Floor)', code: 'D130', address: 'Suché mýto 4' },
  { name: 'Modrá Guľa 6 (6th Floor)', code: 'D132', address: 'Suché mýto 4' },
  { name: 'Moyzesova, Spacious', code: 'A4', address: 'Moyzesova 3' },
  { name: 'Na Revíne, Cloud', code: 'A133', address: 'Na Revíne 21' },
  { name: 'Nam. 1. mája, Flagship', code: 'B18', address: 'Námestie 1. mája 6' },
  { name: 'Obchodná B, Romantic', code: 'B19', address: 'Obchodná 4' },
  { name: 'Odborárska, Stylish', code: 'C110', address: 'Odborárska 3A' },
  { name: 'Odborárske, Loft', code: 'B25', address: 'Odborárske námestie' },
  { name: 'Panorama veza 2 - 2/26/11', code: 'D67' },
  { name: 'Parkovanie miesto 25 Modra gula', code: 'D123' },
  { name: 'Pionierska 1.2', code: 'C46' },
  { name: 'Pionierska Juliusov byt', code: 'C48' },
  { name: 'Pionierska?', code: 'C47' },
  { name: 'Pluhova peter kanuch', code: 'B23' },
  { name: 'Postova 1', code: 'B89' },
  { name: 'Poštová, Heart', code: 'B90', address: 'Poštová 1', detail: 'č. bytu 606' },
  { name: 'Pražská, Panorama', code: 'A139', address: 'Pražská 5' },
  { name: 'Šancová, Design', code: 'A142', address: 'Šancová 11' },
  { name: 'Sancova 55', code: 'A143' },
  { name: 'Sienkiewiczova, Nordic', code: 'B94', address: 'Sienkiewiczova 2' },
  { name: 'Skalická 3A, Bright', code: 'B98', address: 'Skalická cesta 3A' },
  { name: 'Skalická 3B, Shiny', code: 'B99', address: 'Skalická cesta 3B' },
  { name: 'Skypark, Elegant', code: 'D61', address: 'Čulenova 5', detail: 'Tower 1 · 10. poschodie · apartmán 089' },
  { name: 'Skypark, Golden', code: 'D62', address: 'Bottova 5', detail: 'Tower 4 · 17. poschodie · apartmán 159' },
  { name: 'Skypark, Haven', code: 'D64', address: 'Bottova 5', detail: 'Tower 4 · 14. poschodie · apartmán 128' },
  { name: 'Skypark Luxe I', code: 'D50', address: 'Bottova 5', detail: 'Tower 4 · 5. poschodie · apartmán 039' },
  { name: 'Skypark Luxe II', code: 'D51', address: 'Bottova 5', detail: 'Tower 4 · 12. poschodie · apartmán 102' },
  { name: 'Skypark, Luxury I', code: 'D55', address: 'Továrenská 12a', detail: 'Tower 2 · 20. poschodie · apartmán 190' },
  { name: 'Skypark, Luxury II', code: 'D56', address: 'Čulenova 5', detail: 'Tower 1 · 18. poschodie · apartmán 167' },
  { name: 'Skypark, Modern', code: 'D60', address: 'Továrenská 12a', detail: 'Tower 2 · 20. poschodie · apartmán 187' },
  { name: 'Skypark, Royal', code: 'D63', address: 'Továrenská 12a', detail: 'Tower 2 · 14. poschodie · apartmán 125' },
  { name: 'Šoltésovej, Bus', code: 'C35', address: 'Šoltésovej 30' },
  { name: 'Štef., City Heart', code: 'B22', address: 'Štefánikova 21' },
  { name: 'Strakova, Exclusive', code: 'B21', address: 'Strakova 5' },
  { name: 'Tomášikova, Family', code: 'A2', address: 'Tomášikova 50B' },
  { name: 'Tri Veže, Sky', code: 'B28', address: 'Bajkalská 9' },
  { name: 'Trnavská A, Fabulous', code: 'B20', address: 'Trnavská cesta 8C' },
  { name: 'Trnavská B, Sunny', code: 'A7', address: 'Trnavská cesta 14' },
  { name: 'Vajnorská, Terrazzo', code: 'A9', address: 'Vajnorská 32A' },
  { name: 'Ventúrs. A, Charming', code: 'A136', address: 'Ventúrska 16' },
  { name: 'Ventúrska B, Urban', code: 'A137', address: 'Ventúrska 16' },
  { name: 'Vienna Gate, Bright', code: 'A1', address: 'Kopčianska 10' },
  { name: 'Vydrica', code: 'C40' },
  { name: 'Vyšehradská, Spacious', code: 'B29', address: 'Vyšehradská 12' },
  { name: 'Vysoká, President', code: 'B17', address: 'Vysoká 7' },
  { name: 'Zahradnícka A, Paradise', code: 'A6', address: 'Záhradnícka 3' },
  { name: 'Záhradnícka B, Amber', code: 'B26', address: 'Záhradnícka 52' },
  { name: 'Zámocká, Family', code: 'B92', address: 'Zámocká 32' },
  { name: 'Zilinska', code: 'C107' },
  { name: 'Zilinska 2', code: 'C108' },
  { name: 'Zilinska 306', code: 'B33' },
  { name: 'Zilinska 608', code: 'B32' },
  { name: 'Žilinska B, Urban', code: 'C109', address: 'Žilinská 2' },
  { name: 'Žižkova, Riverside', code: 'A8', address: 'Žižkova 13' },
  { name: 'Zochova, Vintage', code: 'A138', address: 'Zochova 22' },
];

/** The hook row of a code ("A140" -> 'A'); the board colours rows A/B/C/D. */
export function keyRow(code: string): 'A' | 'B' | 'C' | 'D' | null {
  const r = code.trim().charAt(0).toUpperCase();
  return r === 'A' || r === 'B' || r === 'C' || r === 'D' ? r : null;
}
