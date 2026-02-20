/**
 * Supermemory API Client
 *
 * Low-level HTTP client for interacting with the Supermemory API.
 * Handles authentication, request/response formatting, and error handling.
 *
 * API Reference: https://supermemory.ai/docs/api-reference
 */

import { logger } from '@/lib/logger';
import {
  SupermemoryAddDocumentResponse,
  SupermemoryDocumentStatus,
  SupermemorySearchResponse,
  SupermemoryUserProfile,
  SupermemoryConfig,
} from './types';

const DEFAULT_BASE_URL = 'https://api.supermemory.ai';
/** Fail fast when API is slow; override with SUPERMEMORY_TIMEOUT_MS if needed. */
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Error class for Supermemory API errors
 */
export class SupermemoryApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly response?: unknown,
  ) {
    super(message);
    this.name = 'SupermemoryApiError';
  }
}

/**
 * Creates the Supermemory configuration from environment variables
 */
export function createSupermemoryConfig(): SupermemoryConfig {
  const apiKey = process.env.SUPERMEMORY_API_KEY;

  if (!apiKey) {
    throw new Error('SUPERMEMORY_API_KEY environment variable is required');
  }

  return {
    apiKey,
    baseUrl: process.env.SUPERMEMORY_BASE_URL || DEFAULT_BASE_URL,
    timeoutMs: parseInt(process.env.SUPERMEMORY_TIMEOUT_MS || '', 10) || DEFAULT_TIMEOUT_MS,
  };
}

/**
 * Supermemory API Client
 *
 * Provides methods for all Supermemory API operations:
 * - Adding documents (memories)
 * - Getting document status
 * - Deleting documents
 * - Searching memories
 * - Getting user profiles
 */
export class SupermemoryClient {
  private readonly config: SupermemoryConfig;

  constructor(config?: Partial<SupermemoryConfig>) {
    // Allow partial config override, fill rest from env
    const envConfig = createSupermemoryConfig();
    this.config = {
      ...envConfig,
      ...config,
    };
  }

  // ============================================================================
  // Document Management
  // ============================================================================

  /**
   * Add a document (memory) to Supermemory
   *
   * @param params - Document parameters
   * @returns The created document response with ID and status
   */
  async addDocument(params: {
    content: string;
    customId?: string;
    metadata?: Record<string, unknown>;
    containerTags?: string[];
    userId?: string;
  }): Promise<SupermemoryAddDocumentResponse> {
    logger.debug(`[Supermemory] Adding document: customId=${params.customId || 'none'}`);

    const response = await this.request<SupermemoryAddDocumentResponse>('/v3/documents', {
      method: 'POST',
      body: {
        content: params.content,
        customId: params.customId,
        metadata: params.metadata,
        containerTags: params.containerTags,
        userId: params.userId,
      },
    });

    logger.debug(
      `[Supermemory] Document added: id=${response.id} status=${response.status}`,
    );
    return response;
  }

  /**
   * Get the status of a document by ID or customId
   *
   * @param documentId - The document ID or customId
   * @returns The document status
   */
  async getDocumentStatus(documentId: string): Promise<SupermemoryDocumentStatus> {
    logger.debug(`[Supermemory] Getting document status: ${documentId}`);

    return this.request<SupermemoryDocumentStatus>(`/v3/documents/${encodeURIComponent(documentId)}`, {
      method: 'GET',
    });
  }

  /**
   * Delete a document by ID or customId
   *
   * @param documentId - The document ID or customId
   * @returns Success confirmation
   */
  async deleteDocument(documentId: string): Promise<{ message: string }> {
    logger.debug(`[Supermemory] Deleting document: ${documentId}`);

    return this.request<{ message: string }>(`/v3/documents/${encodeURIComponent(documentId)}`, {
      method: 'DELETE',
    });
  }

  /**
   * Check if a document exists by customId
   *
   * @param customId - The custom ID to check
   * @returns True if document exists, false otherwise
   */
  async documentExists(customId: string): Promise<boolean> {
    try {
      await this.getDocumentStatus(customId);
      return true;
    } catch (error) {
      if (error instanceof SupermemoryApiError && error.statusCode === 404) {
        return false;
      }
      throw error;
    }
  }

  // ============================================================================
  // Search
  // ============================================================================

  /**
   * Search memories using semantic search
   *
   * @param params - Search parameters
   * @returns Search results
   */
  async searchMemories(params: {
    query: string;
    limit?: number;
    containerTag?: string;
    threshold?: number;
    rerank?: boolean;
    searchMode?: 'memories' | 'hybrid';
    /** Override request timeout (ms). Use for time-sensitive paths (e.g. alerts). */
    timeoutMs?: number;
  }): Promise<SupermemorySearchResponse> {
    logger.debug(
      `[Supermemory] Searching memories: query="${params.query.substring(0, 50)}..." containerTag=${params.containerTag || 'none'}`,
    );

    const { timeoutMs, ...searchParams } = params;
    return this.request<SupermemorySearchResponse>('/v4/search', {
      method: 'POST',
      body: {
        q: searchParams.query,
        limit: searchParams.limit ?? 5,
        containerTag: searchParams.containerTag,
        threshold: searchParams.threshold ?? 0.7,
        rerank: searchParams.rerank ?? true,
        searchMode: searchParams.searchMode ?? 'memories',
      },
      timeoutMs,
    });
  }

  // ============================================================================
  // User Profiles
  // ============================================================================

  /**
   * Get or retrieve user profile from Supermemory
   *
   * Supermemory automatically maintains user profiles based on ingested content.
   * This retrieves the current profile state.
   *
   * @param containerTag - The container tag (user ID) to get profile for
   * @returns The user profile data
   */
  async getUserProfile(containerTag: string): Promise<SupermemoryUserProfile> {
    logger.debug(`[Supermemory] Getting user profile: containerTag=${containerTag}`);

    return this.request<SupermemoryUserProfile>('/v4/profile', {
      method: 'POST',
      body: {
        containerTag,
      },
    });
  }

  /**
   * Validate the API key by making a test request
   * 
   * This attempts to search with an empty query to verify authentication.
   * If the API key is invalid, this will throw a 401 error.
   * 
   * @returns True if API key is valid, throws error if invalid
   */
  async validateApiKey(): Promise<boolean> {
    try {
      // Make a lightweight search request to validate the API key
      await this.searchMemories({
        query: 'test',
        limit: 1,
      });
      return true;
    } catch (error) {
      if (error instanceof SupermemoryApiError && error.statusCode === 401) {
        logger.error('[Supermemory] API key validation failed: 401 Unauthorized', {
          errorBody: error.response,
        });
        throw new Error(
          'Supermemory API key is invalid or expired. Please check your SUPERMEMORY_API_KEY environment variable.',
        );
      }
      // Other errors might be OK (e.g., network issues), so we don't fail validation
      logger.warn('[Supermemory] API key validation encountered non-auth error:', error);
      return true;
    }
  }

  // ============================================================================
  // Internal HTTP Layer
  // ============================================================================

  /**
   * Make an authenticated request to the Supermemory API
   */
  private async request<T>(
    endpoint: string,
    options: {
      method: 'GET' | 'POST' | 'DELETE';
      body?: Record<string, unknown>;
      /** Override request timeout (ms). */
      timeoutMs?: number;
    },
  ): Promise<T> {
    const url = `${this.config.baseUrl}${endpoint}`;
    const timeoutMs = options.timeoutMs ?? this.config.timeoutMs;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const fetchOptions: RequestInit = {
        method: options.method,
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      };

      if (options.body) {
        fetchOptions.body = JSON.stringify(options.body);
      }

      const response = await fetch(url, fetchOptions);

      // Log response details for debugging
      logger.debug(
        `[Supermemory] API response: ${response.status} ${response.statusText}`,
        {
          endpoint,
          method: options.method,
          contentType: response.headers.get('content-type'),
          contentLength: response.headers.get('content-length'),
        },
      );

      if (!response.ok) {
        let errorBody: unknown;
        try {
          errorBody = await response.json();
        } catch {
          errorBody = await response.text();
        }

        // Enhanced logging for authentication errors
        if (response.status === 401) {
          const apiKeyPreview = this.config.apiKey
            ? `${this.config.apiKey.substring(0, 8)}...${this.config.apiKey.substring(this.config.apiKey.length - 4)}`
            : 'NOT SET';
          
          logger.error(
            `[Supermemory] 401 Unauthorized - API key validation failed`,
            {
              apiKeyPreview,
              apiKeyLength: this.config.apiKey?.length || 0,
              endpoint,
              method: options.method,
              errorBody,
            },
          );
        }

        // Enhanced logging for validation errors (400 Bad Request)
        if (response.status === 400) {
          logger.error(
            `[Supermemory] 400 Bad Request - Validation errors`,
            {
              endpoint,
              method: options.method,
              errorBody,
              // Log validation errors if they exist in the response
              validationErrors:
                typeof errorBody === 'object' &&
                errorBody !== null &&
                'error' in errorBody &&
                Array.isArray((errorBody as { error: unknown }).error)
                  ? (errorBody as { error: unknown[] }).error
                  : undefined,
            },
          );
        }

        throw new SupermemoryApiError(
          `Supermemory API error: ${response.status} ${response.statusText}`,
          response.status,
          errorBody,
        );
      }

      // Handle empty responses (e.g., 204 No Content)
      const contentType = response.headers.get('content-type');
      const contentLength = response.headers.get('content-length');
      
      // If content-length is 0 or response is 204, return empty object
      if (response.status === 204 || contentLength === '0') {
        logger.debug(`[Supermemory] Empty response (204 or content-length=0) for ${endpoint}`);
        return {} as T;
      }

      // Check if response has content before parsing
      let responseText: string;
      try {
        responseText = await response.text();
      } catch (textError) {
        logger.error(
          `[Supermemory] Failed to read response body`,
          {
            endpoint,
            method: options.method,
            status: response.status,
            error: textError instanceof Error ? textError.message : String(textError),
          },
        );
        throw new SupermemoryApiError(
          `Supermemory API response body could not be read: ${textError instanceof Error ? textError.message : 'Unknown error'}`,
          response.status,
        );
      }
      
      // If response is empty, return empty object
      if (!responseText || responseText.trim() === '') {
        logger.debug(`[Supermemory] Empty response body for ${endpoint}, returning empty object`);
        return {} as T;
      }

      // Try to parse JSON
      try {
        const data = JSON.parse(responseText);
        return data as T;
      } catch (parseError) {
        logger.error(
          `[Supermemory] Failed to parse JSON response`,
          {
            endpoint,
            method: options.method,
            status: response.status,
            contentType,
            responsePreview: responseText.substring(0, 200),
            responseLength: responseText.length,
            parseError: parseError instanceof Error ? parseError.message : String(parseError),
          },
        );
        throw new SupermemoryApiError(
          `Supermemory API response is not valid JSON: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`,
          response.status,
          responseText,
        );
      }
    } catch (error) {
      if (error instanceof SupermemoryApiError) {
        throw error;
      }

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new SupermemoryApiError(
            `Supermemory API request timed out after ${timeoutMs}ms`,
          );
        }
        throw new SupermemoryApiError(`Supermemory API request failed: ${error.message}`);
      }

      throw new SupermemoryApiError('Unknown Supermemory API error');
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Singleton instance of the Supermemory client
 * Lazy-initialized on first access
 */
let _clientInstance: SupermemoryClient | null = null;

/**
 * Get the singleton Supermemory client instance
 * Creates the client on first call using environment configuration
 */
export function getSupermemoryClient(): SupermemoryClient {
  if (!_clientInstance) {
    _clientInstance = new SupermemoryClient();
  }
  return _clientInstance;
}

/**
 * Check if Supermemory is configured (API key available)
 */
export function isSupermemoryConfigured(): boolean {
  return !!process.env.SUPERMEMORY_API_KEY;
}

