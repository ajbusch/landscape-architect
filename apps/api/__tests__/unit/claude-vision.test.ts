import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the secrets service
vi.mock('../../src/services/secrets.js', () => ({
  getAnthropicApiKey: vi.fn().mockResolvedValue('test-api-key'),
}));

// Mock the Anthropic SDK
const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {
    status: number;
    constructor(status: number, _body: unknown, message: string, _headers: unknown) {
      super(message);
      this.status = status;
      this.name = 'APIError';
    }
  }

  return {
    default: class MockAnthropic {
      messages = { create: mockCreate };
      static APIError = APIError;
    },
  };
});

import { analyzeYardPhoto, _resetClient } from '../../src/services/claude-vision.js';

const validAiResponse = {
  summary: 'A medium backyard with shade.',
  yardSize: 'medium',
  overallSunExposure: 'partial_shade',
  estimatedSoilType: 'loamy',
  isValidYardPhoto: true,
  features: [{ type: 'tree', label: 'Oak', confidence: 'high' }],
  recommendedPlantTypes: [
    {
      category: 'quick_win',
      plantType: 'perennial',
      lightRequirement: 'partial_shade',
      reason: 'Shade plants.',
      searchCriteria: { type: 'perennial', light: 'partial_shade' },
    },
  ],
};

describe('analyzeYardPhoto', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetClient();
  });

  it('returns parsed AI output on success', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify(validAiResponse) }],
    });

    const result = await analyzeYardPhoto('base64data', 'image/jpeg', '7b', 'USDA Zone 7b');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.summary).toBe('A medium backyard with shade.');
      expect(result.data.isValidYardPhoto).toBe(true);
    }
  });

  it('passes correct parameters to Claude API', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify(validAiResponse) }],
    });

    await analyzeYardPhoto('base64photo', 'image/png', '5a', 'USDA Zone 5a');

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: 'base64photo',
                },
              },
              {
                type: 'text',
                text: expect.stringContaining('Zone 5a'),
              },
            ],
          },
        ],
      }),
      expect.objectContaining({ timeout: 30000 }),
    );
  });

  it('retries once on invalid JSON and succeeds on retry', async () => {
    // First call returns invalid JSON
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'not valid json' }],
    });
    // Retry returns valid JSON
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify(validAiResponse) }],
    });

    const result = await analyzeYardPhoto('base64data', 'image/jpeg', '7b', 'USDA Zone 7b');

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(true);
  });

  it('retries once on schema validation failure and succeeds on retry', async () => {
    // First call returns JSON with invalid schema
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify({ foo: 'bar' }) }],
    });
    // Retry returns valid JSON
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify(validAiResponse) }],
    });

    const result = await analyzeYardPhoto('base64data', 'image/jpeg', '7b', 'USDA Zone 7b');

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(true);
  });

  it('returns error after retry exhausted on invalid JSON', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'still not json' }],
    });

    const result = await analyzeYardPhoto('base64data', 'image/jpeg', '7b', 'USDA Zone 7b');

    expect(mockCreate).toHaveBeenCalledTimes(2); // original + 1 retry
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('invalid_response');
    }
  });

  it('returns timeout error without retrying', async () => {
    const timeoutError = new Error('Request timed out');
    timeoutError.name = 'AbortError';
    mockCreate.mockRejectedValueOnce(timeoutError);

    const result = await analyzeYardPhoto('base64data', 'image/jpeg', '7b', 'USDA Zone 7b');

    expect(mockCreate).toHaveBeenCalledTimes(1); // No retry on timeout
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('timeout');
    }
  });

  it('returns rate_limit error without retrying', async () => {
    // Import the mocked APIError class
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const rateError = new Anthropic.APIError(429, {}, 'Rate limited', {} as unknown as Headers);
    mockCreate.mockRejectedValueOnce(rateError);

    const result = await analyzeYardPhoto('base64data', 'image/jpeg', '7b', 'USDA Zone 7b');

    expect(mockCreate).toHaveBeenCalledTimes(1); // No retry on rate limit
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('rate_limit');
    }
  });

  it('handles invalid yard photo response', async () => {
    const invalidPhotoResponse = {
      ...validAiResponse,
      isValidYardPhoto: false,
      invalidPhotoReason: 'This is a photo of a cat.',
      features: [],
      recommendedPlantTypes: [],
    };
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify(invalidPhotoResponse) }],
    });

    const result = await analyzeYardPhoto('base64data', 'image/jpeg', '7b', 'USDA Zone 7b');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.isValidYardPhoto).toBe(false);
      expect(result.data.invalidPhotoReason).toBe('This is a photo of a cat.');
    }
  });

  it('handles response with no text content', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'tool_use', id: 'x', name: 'y', input: {} }],
    });

    // This should trigger a retry (invalid_response)
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify(validAiResponse) }],
    });

    const result = await analyzeYardPhoto('base64data', 'image/jpeg', '7b', 'USDA Zone 7b');

    expect(result.ok).toBe(true);
  });
});
