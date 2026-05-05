import {
  makeSentinelService,
  SentinelServiceError,
  type SentinelHealthResponse,
  type SentinelScoreResponse,
  type SentinelBanksStatus,
} from './sentinelService.js';

function makeOkResponse<T>(body: T): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

function makeErrorResponse(status: number, text: string): Response {
  return {
    ok: false,
    status,
    text: () => Promise.resolve(text),
    json: () => Promise.reject(new Error('Not JSON')),
  } as unknown as Response;
}

describe('makeSentinelService', () => {
  const BASE_URL = 'http://localhost:8000';

  beforeEach(() => {
    jest.resetAllMocks();
    global.fetch = jest.fn();
  });

  describe('healthCheck', () => {
    it('calls /health endpoint and returns response', async () => {
      const mockResponse: SentinelHealthResponse = { status: 'ok', banks_loaded: true };
      (global.fetch as jest.Mock).mockResolvedValueOnce(makeOkResponse(mockResponse));

      const service = makeSentinelService(BASE_URL);
      const result = await service.healthCheck();

      expect(global.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/health`,
        expect.objectContaining({ method: 'GET' }),
      );
      expect(result).toEqual(mockResponse);
    });

    it('throws SentinelServiceError on non-ok response', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        makeErrorResponse(503, 'Service Unavailable'),
      );

      const service = makeSentinelService(BASE_URL);
      await expect(service.healthCheck()).rejects.toBeInstanceOf(SentinelServiceError);
    });

    it('wraps fetch errors in SentinelServiceError', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(
        new Error('ECONNREFUSED'),
      );

      const service = makeSentinelService(BASE_URL);
      const error = await service.healthCheck().catch((e) => e);
      expect(error).toBeInstanceOf(SentinelServiceError);
      expect(error.message).toContain('ECONNREFUSED');
    });
  });

  describe('getBanksStatus', () => {
    it('calls /banks/status and returns loaded status', async () => {
      const mockStatus: SentinelBanksStatus = {
        loaded: true,
        model_name: 'all-MiniLM-L6-v2',
        positive_count: 100,
        negative_count: 200,
      };
      (global.fetch as jest.Mock).mockResolvedValueOnce(makeOkResponse(mockStatus));

      const service = makeSentinelService(BASE_URL);
      const result = await service.getBanksStatus();

      expect(global.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/banks/status`,
        expect.objectContaining({ method: 'GET' }),
      );
      expect(result).toEqual(mockStatus);
    });
  });

  describe('scoreTexts', () => {
    it('calls /score with the provided texts and returns scores', async () => {
      const mockScore: SentinelScoreResponse = {
        rare_class_affinity_score: 0.82,
        observation_scores: { 'hello world': 0.82 },
        num_observations: 1,
      };
      (global.fetch as jest.Mock).mockResolvedValueOnce(makeOkResponse(mockScore));

      const service = makeSentinelService(BASE_URL);
      const result = await service.scoreTexts({ texts: ['hello world'] });

      expect(global.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/score`,
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('hello world'),
        }),
      );
      expect(result.rare_class_affinity_score).toBe(0.82);
    });

    it('includes default top_k and min_score_to_consider when not specified', async () => {
      const mockScore: SentinelScoreResponse = {
        rare_class_affinity_score: 0.5,
        observation_scores: { text: 0.5 },
        num_observations: 1,
      };
      (global.fetch as jest.Mock).mockResolvedValueOnce(makeOkResponse(mockScore));

      const service = makeSentinelService(BASE_URL);
      await service.scoreTexts({ texts: ['text'] });

      const body = JSON.parse(
        (global.fetch as jest.Mock).mock.calls[0][1].body,
      );
      expect(body.top_k).toBe(5);
      expect(body.min_score_to_consider).toBe(0.0);
    });
  });

  describe('scoreSingleText', () => {
    it('returns the score for the single text from observation_scores', async () => {
      const mockScore: SentinelScoreResponse = {
        rare_class_affinity_score: 0.75,
        observation_scores: { 'test text': 0.75 },
        num_observations: 1,
      };
      (global.fetch as jest.Mock).mockResolvedValueOnce(makeOkResponse(mockScore));

      const service = makeSentinelService(BASE_URL);
      const score = await service.scoreSingleText('test text');
      expect(score).toBe(0.75);
    });

    it('returns 0 when observation_scores is empty', async () => {
      const mockScore: SentinelScoreResponse = {
        rare_class_affinity_score: 0,
        observation_scores: {},
        num_observations: 0,
      };
      (global.fetch as jest.Mock).mockResolvedValueOnce(makeOkResponse(mockScore));

      const service = makeSentinelService(BASE_URL);
      const score = await service.scoreSingleText('test text');
      expect(score).toBe(0);
    });
  });

  describe('default URL', () => {
    it('uses localhost:8000 when no URL is provided', async () => {
      const mockResponse: SentinelHealthResponse = { status: 'ok', banks_loaded: true };
      (global.fetch as jest.Mock).mockResolvedValueOnce(makeOkResponse(mockResponse));

      const service = makeSentinelService();
      await service.healthCheck();

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:8000/health',
        expect.anything(),
      );
    });

    it('strips trailing slash from base URL', async () => {
      const mockResponse: SentinelHealthResponse = { status: 'ok', banks_loaded: true };
      (global.fetch as jest.Mock).mockResolvedValueOnce(makeOkResponse(mockResponse));

      const service = makeSentinelService('http://sentinel.example.com/');
      await service.healthCheck();

      expect(global.fetch).toHaveBeenCalledWith(
        'http://sentinel.example.com/health',
        expect.anything(),
      );
    });
  });
});
