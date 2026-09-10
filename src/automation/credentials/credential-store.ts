export interface ControllerCredentialStore {
  readonly available: boolean;
  store(controllerId: string, secret: string): Promise<string>;
  remove(reference: string): Promise<void>;
}

/**
 * Phase 2 refuses to persist secrets until an OS-protected Electron credential
 * bridge is separately implemented and reviewed. No plaintext fallback exists.
 */
export class UnavailableControllerCredentialStore implements ControllerCredentialStore {
  readonly available = false;

  async store(): Promise<string> {
    throw new Error('Secure controller credential storage is not available in Phase 2.');
  }

  async remove(): Promise<void> {
    throw new Error('Secure controller credential storage is not available in Phase 2.');
  }
}

