/**
 * Notes written ahead for a later day (Martina, 2026-11-20): how far ahead the
 * database lets each box be written (add_board_note: today + 30, migration 0008;
 * add_cleaning_request: today + 60, migration 0018). The board loads its notes
 * up to these days, so the ones beyond the shown week appear in "Naplánované".
 */
export const NOTE_AHEAD_DAYS = 30;
export const CLEANING_AHEAD_DAYS = 60;
