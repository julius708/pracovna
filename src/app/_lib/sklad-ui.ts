import type { StockItem } from '@/core/stock';

/** Name of a stock card as people read it: product, variant, coffee system. */
export function itemLabel(i: Pick<StockItem, 'product' | 'variant' | 'system'>): string {
  return [i.product, i.system, i.variant].filter(Boolean).join(' · ');
}

export const KIND_LABEL: Record<string, string> = {
  opening_balance: 'Začiatočný stav',
  receipt: 'Príjem',
  issue_package: 'Výdaj – zabalené',
  issue_flat: 'Výdaj do bytu',
  issue_manual: 'Ručný výdaj',
  return: 'Vrátenie',
  transfer_out: 'Presun – von',
  transfer_in: 'Presun – dnu',
  damage: 'Poškodenie',
  inventory_difference: 'Rozdiel inventúry',
  linen_issue: 'Bielizeň – do bytu',
  linen_return: 'Bielizeň – vrátená',
};

export const ORDER_STATUS: Record<string, string> = {
  draft: 'Návrh', review: 'Kontrola', approved: 'Schválená', sent: 'Odoslaná', confirmed: 'Potvrdená dodávateľom', partially_received: 'Čiastočne prijatá', received: 'Prijatá', cancelled: 'Zrušená',
};
export const SEND_STATE: Record<string, string> = { not_sent: 'NEODOSLANÉ', sent: 'odoslané', ambiguous: 'výsledok odoslania nejasný' };

export const DISCREPANCY_LABEL: Record<string, string> = {
  unpack_without_return: 'Späť bez vrátenia tovaru',
  surplus_after_repack: 'Prebytok po zmene požiadavky',
  partial_return: 'Čiastočné vrátenie',
};

/** Message codes of the redirect after a form: ?m=ok:... or ?m=err:... */
export const MESSAGES: Record<string, string> = {
  ok: 'Uložené.',
  'err:unverified': 'Balenie nie je overené (Neoverené): doplň kusy v balení, zdroj a dátum overenia.',
  'err:unverified_lines': 'Inventúru nemožno uzavrieť: niektoré riadky majú celé balenia bez overeného prepočtu.',
  'err:reason_required': 'Doplň dôvod.',
  'err:bad_qty': 'Neplatné množstvo.',
  'err:future': 'Čas nemôže byť v budúcnosti.',
  'err:future_cut': 'Čas uzávierky nemôže byť v budúcnosti.',
  'err:cut_before_previous': 'Čas uzávierky je skôr ako predošlá uzávierka tohto skladu.',
  'err:no_baseline': 'Odpočty sa dajú zapnúť až po schválenej začiatočnej inventúre.',
  'err:not_closed': 'Inventúra nie je uzavretá.',
  'err:closed': 'Inventúra je už uzavretá, riadky sa nedajú meniť.',
  'err:bad_zero': 'Overená nula nesmie mať množstvo.',
  'err:bad_transition': 'Tento krok teraz nie je možný.',
  'err:unauthorized': 'Na túto akciu nemáš oprávnenie.',
  'err:failed': 'Nepodarilo sa uložiť. Skús znova.',
  'err:not_found': 'Záznam sa nenašiel.',
  'err:bad_input': 'Chýbajú povinné údaje.',
  'err:demo': 'Ukážka bez databázy: nič sa neukladá.',
};
export const messageOf = (m: string | undefined) => (m ? (MESSAGES[m] ?? (m.startsWith('err:') ? MESSAGES['err:failed'] : MESSAGES.ok)) : null);
