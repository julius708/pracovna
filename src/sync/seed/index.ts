import type { Ymd } from '@/core/packing';
import { createFakeGuestyClient, type FakeGuestyData } from '@/guesty/fake-client';
import type { GuestyClient } from '@/guesty/client';
import { listingSchema, parseMany, type ParsedListing } from '@/guesty/schemas';
import seedListings from '@/guesty/fixtures/seed/listings.json';
import { generateSeedData, type SeedScenarioCounts } from './generate';

export function seedListingShapes(): ParsedListing[] {
  return parseMany(listingSchema, seedListings as unknown[]);
}

/** Fake Guesty for SEED_MODE: the real listing shapes and generated reservations around `today`. */
export function createSeedClient(today: Ymd, perDay = 20): { client: GuestyClient & { data: FakeGuestyData }; counts: SeedScenarioCounts } {
  const { data, counts } = generateSeedData(seedListingShapes(), { today, perDay });
  return { client: createFakeGuestyClient(data), counts };
}
