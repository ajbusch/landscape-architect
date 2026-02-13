import { describe, it, expect } from 'vitest';
import { ZipCodeSchema, USDAZoneSchema, AddressInputSchema, ZoneResponseSchema } from './zone.js';

describe('ZipCodeSchema', () => {
  it('accepts 5-digit ZIP', () => {
    expect(ZipCodeSchema.safeParse('28202').success).toBe(true);
  });

  it('accepts ZIP+4', () => {
    expect(ZipCodeSchema.safeParse('28202-1234').success).toBe(true);
  });

  it('rejects too few digits', () => {
    expect(ZipCodeSchema.safeParse('2820').success).toBe(false);
  });

  it('rejects letters', () => {
    expect(ZipCodeSchema.safeParse('2820A').success).toBe(false);
  });

  it('rejects non-US postal codes', () => {
    expect(ZipCodeSchema.safeParse('SW1A 1AA').success).toBe(false);
  });
});

describe('USDAZoneSchema', () => {
  it.each(['1a', '1b', '5a', '7b', '10a', '13b'])('accepts valid zone %s', (zone) => {
    expect(USDAZoneSchema.safeParse(zone).success).toBe(true);
  });

  it.each(['0a', '14a', '7c', '7', 'ab', ''])('rejects invalid zone %s', (zone) => {
    expect(USDAZoneSchema.safeParse(zone).success).toBe(false);
  });
});

describe('AddressInputSchema', () => {
  it('accepts ZIP code only', () => {
    const result = AddressInputSchema.safeParse({ zipCode: '28202' });
    expect(result.success).toBe(true);
  });

  it('accepts full address', () => {
    const result = AddressInputSchema.safeParse({
      zipCode: '28202',
      streetAddress: '123 Main St',
      city: 'Charlotte',
      state: 'NC',
    });
    expect(result.success).toBe(true);
  });

  it('uppercases state abbreviation', () => {
    const result = AddressInputSchema.safeParse({
      zipCode: '28202',
      state: 'nc',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.state).toBe('NC');
    }
  });

  it('rejects 3-letter state code', () => {
    const result = AddressInputSchema.safeParse({
      zipCode: '28202',
      state: 'NCA',
    });
    expect(result.success).toBe(false);
  });
});

describe('ZoneResponseSchema', () => {
  it('accepts a valid zone response', () => {
    const result = ZoneResponseSchema.safeParse({
      zipCode: '28202',
      zone: '7b',
      zoneNumber: 7,
      zoneLetter: 'b',
      minTempF: 5,
      maxTempF: 10,
      description: 'Zone 7b — Average minimum temperature: 5°F to 10°F',
    });
    expect(result.success).toBe(true);
  });
});
