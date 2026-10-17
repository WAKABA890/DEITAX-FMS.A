/**
 * Shared browser HTTP transport.
 *
 * Feature API modules own endpoints and payloads. This client owns only
 * request transport, JSON parsing, and the existing read-only fallback.
 */
export async function fetchApi<T>(endpoint: string, options?: RequestInit, fallbackData?: T): Promise<T> {
  try {
    const response = await fetch(endpoint, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(errorBody.message || 'API error: ' + response.status);
    }

    return await response.json() as T;
  } catch (error) {
    console.warn('API call to ' + endpoint + ' failed, using local memory state:', error);
    const method = String(options?.method || 'GET').toUpperCase();
    if (method !== 'GET' && error instanceof TypeError) {
      throw new Error('Action unavailable while offline.');
    }

    if (fallbackData !== undefined) return fallbackData;
    throw error;
  }
}
