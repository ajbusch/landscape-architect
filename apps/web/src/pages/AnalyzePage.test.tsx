import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { AnalyzePage } from './AnalyzePage.js';

const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('@/services/api', () => ({
  submitAnalysis: vi.fn(),
  pollAnalysis: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
    }
  },
}));

import { submitAnalysis, pollAnalysis, ApiError } from '@/services/api';

function createTestFile(name = 'yard.jpg', type = 'image/jpeg', sizeKB = 100): File {
  const bytes = new Uint8Array(sizeKB * 1024);
  return new File([bytes], name, { type });
}

function uploadFile(file: File): void {
  const input = screen.getByTestId('photo-input');
  fireEvent.change(input, { target: { files: [file] } });
}

function renderAnalyzePage(): ReturnType<typeof render> {
  const router = createMemoryRouter([{ path: '/', element: <AnalyzePage /> }], {
    initialEntries: ['/'],
  });
  return render(<RouterProvider router={router} />);
}

/** Type a location and blur to trigger fallback selection. */
async function enterLocation(
  user: ReturnType<typeof userEvent.setup>,
  value = 'Charlotte, North Carolina',
): Promise<void> {
  const input = screen.getByLabelText('Location');
  await user.type(input, value);
  fireEvent.blur(input);
}

describe('AnalyzePage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockNavigate.mockReset();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    URL.createObjectURL = vi.fn(() => 'blob:preview');
    (submitAnalysis as Mock).mockResolvedValue({ id: 'analysis-123', status: 'pending' });
    (pollAnalysis as Mock).mockResolvedValue({
      id: 'analysis-123',
      status: 'complete',
      createdAt: '2026-01-15T10:00:00Z',
      result: { id: 'analysis-123' },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the page heading and form elements', () => {
    renderAnalyzePage();
    expect(screen.getByText('Analyze Your Yard')).toBeInTheDocument();
    expect(screen.getByText('Yard Photo')).toBeInTheDocument();
    expect(screen.getByLabelText('Location')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Analyze My Yard' })).toBeDisabled();
  });

  describe('Photo upload', () => {
    it('shows preview after selecting a valid photo', () => {
      renderAnalyzePage();
      uploadFile(createTestFile());

      expect(screen.getByAltText('Yard photo preview')).toBeInTheDocument();
      expect(screen.getByText('yard.jpg')).toBeInTheDocument();
    });

    it('shows error for invalid file type', () => {
      renderAnalyzePage();
      uploadFile(createTestFile('doc.pdf', 'application/pdf'));

      expect(screen.getByText('File must be JPEG, PNG, or HEIC format.')).toBeInTheDocument();
      expect(screen.queryByAltText('Yard photo preview')).not.toBeInTheDocument();
    });

    it('shows error for oversized file', () => {
      renderAnalyzePage();
      uploadFile(createTestFile('big.jpg', 'image/jpeg', 21 * 1024));

      expect(screen.getByText('File must be under 20MB.')).toBeInTheDocument();
    });

    it('allows removing a selected photo', async () => {
      vi.useRealTimers();
      const user = userEvent.setup();
      renderAnalyzePage();

      uploadFile(createTestFile());
      expect(screen.getByAltText('Yard photo preview')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Remove photo' }));
      expect(screen.queryByAltText('Yard photo preview')).not.toBeInTheDocument();
    });

    it('accepts PNG files', () => {
      renderAnalyzePage();
      uploadFile(createTestFile('yard.png', 'image/png'));

      expect(screen.getByAltText('Yard photo preview')).toBeInTheDocument();
    });

    it('accepts HEIC files', () => {
      renderAnalyzePage();
      uploadFile(createTestFile('yard.heic', 'image/heic'));

      expect(screen.getByAltText('Yard photo preview')).toBeInTheDocument();
    });

    it('accepts photo via drag and drop', () => {
      renderAnalyzePage();
      const dropzone = screen.getByRole('button', { name: 'Upload photo' });
      const file = createTestFile();

      fireEvent.dragOver(dropzone);
      fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });

      expect(screen.getByAltText('Yard photo preview')).toBeInTheDocument();
    });

    it('shows drag over visual state', () => {
      renderAnalyzePage();
      const dropzone = screen.getByRole('button', { name: 'Upload photo' });

      fireEvent.dragOver(dropzone);
      expect(screen.getByText('Drop your photo here')).toBeInTheDocument();

      fireEvent.dragLeave(dropzone);
      expect(screen.getByText('Drag & drop your yard photo')).toBeInTheDocument();
    });
  });

  describe('Location input', () => {
    it('shows confirmed location after typing and blurring', async () => {
      vi.useRealTimers();
      const user = userEvent.setup();
      renderAnalyzePage();

      await enterLocation(user);

      await waitFor(() => {
        expect(screen.getByText('Charlotte, North Carolina')).toBeInTheDocument();
      });
    });
  });

  describe('Analyze button', () => {
    it('is disabled until photo and location are provided', async () => {
      vi.useRealTimers();
      const user = userEvent.setup();
      renderAnalyzePage();

      const button = screen.getByRole('button', { name: 'Analyze My Yard' });
      expect(button).toBeDisabled();

      // Add photo only — still disabled
      uploadFile(createTestFile());
      expect(button).toBeDisabled();

      // Add location — enabled after blur triggers selection
      await enterLocation(user);
      await waitFor(() => {
        expect(button).toBeEnabled();
      });
    });

    it('submits analysis and navigates on complete', async () => {
      vi.useRealTimers();
      const user = userEvent.setup();
      renderAnalyzePage();

      uploadFile(createTestFile());
      await enterLocation(user);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Analyze My Yard' })).toBeEnabled();
      });

      await user.click(screen.getByRole('button', { name: 'Analyze My Yard' }));

      await waitFor(() => {
        expect(submitAnalysis).toHaveBeenCalledWith(
          expect.any(File),
          null,
          null,
          'Charlotte, North Carolina',
        );
      });

      // After submit, polling kicks in and finds 'complete', navigates
      await waitFor(
        () => {
          expect(mockNavigate).toHaveBeenCalledWith('/analyze/analysis-123');
        },
        { timeout: 5000 },
      );
    });

    it('submits analysis when Enter is pressed in location field', async () => {
      vi.useRealTimers();
      const user = userEvent.setup();
      renderAnalyzePage();

      uploadFile(createTestFile());
      await enterLocation(user);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Analyze My Yard' })).toBeEnabled();
      });

      await user.type(screen.getByLabelText('Location'), '{Enter}');

      await waitFor(() => {
        expect(submitAnalysis).toHaveBeenCalledWith(
          expect.any(File),
          null,
          null,
          'Charlotte, North Carolina',
        );
      });

      await waitFor(
        () => {
          expect(mockNavigate).toHaveBeenCalledWith('/analyze/analysis-123');
        },
        { timeout: 5000 },
      );
    });

    it('does not submit on Enter when form is incomplete', async () => {
      vi.useRealTimers();
      const user = userEvent.setup();
      renderAnalyzePage();

      // Only location, no photo
      await enterLocation(user);
      await waitFor(() => {
        expect(screen.getByText('Charlotte, North Carolina')).toBeInTheDocument();
      });

      // Clear any calls that may have leaked from prior async tests
      (submitAnalysis as Mock).mockClear();

      await user.type(screen.getByLabelText('Location'), '{Enter}');

      // handleSubmit guards on !photo, so submitAnalysis should not be called
      expect(submitAnalysis).not.toHaveBeenCalled();
    });

    it('shows status messages during polling', async () => {
      (pollAnalysis as Mock).mockResolvedValue({
        id: 'analysis-123',
        status: 'analyzing',
        createdAt: '2026-01-15T10:00:00Z',
      });
      vi.useRealTimers();
      const user = userEvent.setup();
      renderAnalyzePage();

      uploadFile(createTestFile());
      await enterLocation(user);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Analyze My Yard' })).toBeEnabled();
      });

      await user.click(screen.getByRole('button', { name: 'Analyze My Yard' }));

      await waitFor(() => {
        expect(screen.getByText('Starting analysis...')).toBeInTheDocument();
      });
    });
  });

  describe('Error handling', () => {
    async function setupAndSubmitWithError(error: Error): Promise<void> {
      (submitAnalysis as Mock).mockRejectedValue(error);
      vi.useRealTimers();
      const user = userEvent.setup();
      renderAnalyzePage();

      uploadFile(createTestFile());
      await enterLocation(user);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Analyze My Yard' })).toBeEnabled();
      });

      await user.click(screen.getByRole('button', { name: 'Analyze My Yard' }));
    }

    it('shows error for rate limiting (429)', async () => {
      await setupAndSubmitWithError(new ApiError(429, 'Rate limited'));

      await waitFor(() => {
        expect(screen.getByText(/Too many requests/)).toBeInTheDocument();
      });
    });

    it('shows generic error for unknown failures', async () => {
      await setupAndSubmitWithError(new Error('boom'));

      await waitFor(() => {
        expect(screen.getByText(/Something went wrong/)).toBeInTheDocument();
      });
    });

    it('re-enables button after error so user can retry', async () => {
      await setupAndSubmitWithError(new ApiError(500, 'Server error'));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Analyze My Yard' })).toBeEnabled();
      });
    });
  });
});
