import type { ItemDef, PackingSettings } from './types';

/** Items in display order. Labels are the defaults; admins may rename them. */
export const DEFAULT_ITEMS: ItemDef[] = [
  { key: 'paplonV', label: 'Paplón veľký', size: '' },
  { key: 'paplonM', label: 'Paplón malý', size: '' },
  { key: 'vankus', label: 'Vankúš', size: '' },
  { key: 'plachta', label: 'Plachta', size: '' },
  { key: 'plachtaM', label: 'Plachta malá', size: '' },
  { key: 'osuskaV', label: 'Osuška veľká', size: '' },
  { key: 'uterakM', label: 'Uterák malý', size: '' },
  { key: 'predlozka', label: 'Uterák na nohy do kúpeľne', size: '' },
  { key: 'toaletak', label: 'Toaletný papier', size: '' },
  { key: 'utierky', label: 'Kuchynské utierky', size: 'rolka' },
  { key: 'spongia', label: 'Špongia na riad', size: '' },
  { key: 'myckaKaps', label: 'Kapsule do umývačky', size: '' },
  { key: 'vreckoV', label: 'Vrecko do koša veľké', size: '' },
  { key: 'vreckoM', label: 'Vrecko do koša malé', size: '' },
];

/** The default linen table from the spec (identical to the prototype). */
export const DEFAULT_SETTINGS: PackingSettings = {
  items: DEFAULT_ITEMS,
  beds: {
    dvoj: { paplonV: 1, vankus: 2, plachta: 1 },
    jedno: { paplonM: 1, vankus: 1, plachtaM: 1 },
    gauc: { paplonV: 1, vankus: 2, plachta: 1 },
  },
  perGuest: { osuskaV: 1, uterakM: 1 },
  perBathroom: { predlozka: 1 },
  perApartment: { utierky: 1, spongia: 1, myckaKaps: 2, vreckoV: 1, vreckoM: 1 },
  checklist: [],
};

/**
 * Merges saved settings with the defaults: saved values win, items that were
 * added to the defaults later are appended, missing sections fall back.
 */
export function mergeSettings(saved: Partial<PackingSettings> | null | undefined): PackingSettings {
  const s = saved ?? {};
  const savedItems = Array.isArray(s.items) && s.items.length ? s.items : [];
  const items = savedItems.length
    ? [...savedItems, ...DEFAULT_ITEMS.filter((d) => !savedItems.some((x) => x.key === d.key))]
    : DEFAULT_ITEMS;
  return {
    items,
    beds: {
      dvoj: { ...DEFAULT_SETTINGS.beds.dvoj, ...(s.beds?.dvoj ?? {}) },
      jedno: { ...DEFAULT_SETTINGS.beds.jedno, ...(s.beds?.jedno ?? {}) },
      gauc: { ...DEFAULT_SETTINGS.beds.gauc, ...(s.beds?.gauc ?? {}) },
    },
    perGuest: s.perGuest ?? DEFAULT_SETTINGS.perGuest,
    perBathroom: s.perBathroom ?? DEFAULT_SETTINGS.perBathroom,
    perApartment: { ...DEFAULT_SETTINGS.perApartment, ...(s.perApartment ?? {}) },
    checklist: Array.isArray(s.checklist) ? s.checklist : [],
  };
}
