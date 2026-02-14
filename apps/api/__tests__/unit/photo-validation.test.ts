import { describe, it, expect } from 'vitest';
import { validatePhoto } from '../../src/services/photo.js';

describe('validatePhoto', () => {
  it('accepts a JPEG file (magic bytes FF D8 FF)', () => {
    const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(100).fill(0)]);
    const result = validatePhoto(buffer);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.type).toBe('jpeg');
      expect(result.mediaType).toBe('image/jpeg');
      expect(result.ext).toBe('jpg');
    }
  });

  it('accepts a PNG file (magic bytes 89 50 4E 47)', () => {
    const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, ...Array(100).fill(0)]);
    const result = validatePhoto(buffer);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.type).toBe('png');
      expect(result.mediaType).toBe('image/png');
      expect(result.ext).toBe('png');
    }
  });

  it('accepts a HEIC file (ftyp box with heic brand)', () => {
    // HEIC files have a ftyp box at offset 4 with brand at offset 8
    const buffer = Buffer.alloc(100);
    buffer.writeUInt32BE(24, 0); // box size
    buffer.write('ftyp', 4, 'ascii');
    buffer.write('heic', 8, 'ascii');
    const result = validatePhoto(buffer);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.type).toBe('heic');
      expect(result.mediaType).toBe('image/heic');
      expect(result.ext).toBe('heic');
    }
  });

  it('accepts HEIC with mif1 brand', () => {
    const buffer = Buffer.alloc(100);
    buffer.writeUInt32BE(24, 0);
    buffer.write('ftyp', 4, 'ascii');
    buffer.write('mif1', 8, 'ascii');
    const result = validatePhoto(buffer);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.type).toBe('heic');
    }
  });

  it('rejects a file that is too small', () => {
    const buffer = Buffer.from([0xff, 0xd8]);
    const result = validatePhoto(buffer);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('too small');
    }
  });

  it('rejects a PDF file', () => {
    const buffer = Buffer.alloc(100);
    buffer.write('%PDF-1.4', 0, 'ascii');
    const result = validatePhoto(buffer);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('JPEG, PNG, or HEIC');
    }
  });

  it('rejects a GIF file', () => {
    const buffer = Buffer.alloc(100);
    buffer.write('GIF89a', 0, 'ascii');
    const result = validatePhoto(buffer);
    expect(result.valid).toBe(false);
  });

  it('rejects a file exceeding 20MB', () => {
    const buffer = Buffer.alloc(21 * 1024 * 1024);
    buffer[0] = 0xff;
    buffer[1] = 0xd8;
    buffer[2] = 0xff;
    const result = validatePhoto(buffer);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('under 20MB');
    }
  });

  it('rejects random bytes', () => {
    const buffer = Buffer.from(Array(100).fill(0x00));
    const result = validatePhoto(buffer);
    expect(result.valid).toBe(false);
  });
});
