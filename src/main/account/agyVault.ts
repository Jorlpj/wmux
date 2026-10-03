// ─── agy credential vault — Windows Credential Manager via koffi FFI ─────────
//
// agy stores its Google sign-in as a Generic credential, target
// `gemini:antigravity`, user `antigravity`, Local-machine persistence. The blob
// is JSON: `{ token: { access_token, token_type, refresh_token, expiry },
// auth_method, id_token }`. wmux keeps one copy per account under
// `wmux:agy:<email>` in the same vault, so secrets never leave the OS store:
// nothing here writes a blob to disk, a log or IPC. The only thing read out of
// a blob is the id_token's `email` claim.
//
// Runtime-required koffi, like winSnapshotNative: a load failure (non-Windows,
// koffi missing) disables the vault for the process and the feature reports
// itself unsupported instead of throwing.

export const AGY_ACTIVE_TARGET = 'gemini:antigravity';
const AGY_ACTIVE_USER = 'antigravity';
const COPY_PREFIX = 'wmux:agy:';

const CRED_TYPE_GENERIC = 1;
const CRED_PERSIST_LOCAL_MACHINE = 2;
/** CredWriteW refuses blobs above CRED_MAX_CREDENTIAL_BLOB_SIZE (5 * 512). */
const MAX_BLOB_BYTES = 2560;

export interface AgyVaultBackend {
  read(target: string): Buffer | null;
  write(target: string, user: string, blob: Buffer): boolean;
  remove(target: string): boolean;
}

export function copyTarget(email: string): string {
  return COPY_PREFIX + email;
}

/** `email` claim of the blob's id_token, lower-cased; null when absent/malformed. */
export function agyBlobEmail(blob: Buffer | null): string | null {
  if (!blob) return null;
  try {
    const parsed = JSON.parse(blob.toString('utf8')) as { id_token?: unknown };
    if (typeof parsed.id_token !== 'string') return null;
    const payload = parsed.id_token.split('.')[1];
    if (!payload) return null;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { email?: unknown };
    return typeof claims.email === 'string' && claims.email.includes('@') ? claims.email.trim().toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Outcome of a swap: `no-copy` = the target has no saved sign-in;
 *  `live-not-saved` = the current sign-in could not be copied, so it was not
 *  replaced; `failed` = the vault write itself failed. */
export type AgySwapResult = 'ok' | 'no-copy' | 'live-not-saved' | 'failed';

export class AgyVault {
  constructor(private readonly backend: AgyVaultBackend) {}

  /** Email of the account agy is signed in with right now. */
  activeEmail(): string | null {
    return agyBlobEmail(this.backend.read(AGY_ACTIVE_TARGET));
  }

  /** Copy the live sign-in into its account slot. Returns the email saved, or
   *  null when nobody is signed in. Called before every swap and after a
   *  login, so agy's own token refreshes are folded back into the copy. */
  captureActive(): string | null {
    const blob = this.backend.read(AGY_ACTIVE_TARGET);
    const email = agyBlobEmail(blob);
    if (!blob || !email || blob.length > MAX_BLOB_BYTES) return null;
    return this.backend.write(copyTarget(email), AGY_ACTIVE_USER, blob) ? email : null;
  }

  hasCopy(email: string): boolean {
    return agyBlobEmail(this.backend.read(copyTarget(email))) === email;
  }

  /** True when the live sign-in is safe to replace: nobody is signed in, or
   *  its copy was just written and reads back byte for byte. A sign-in that
   *  cannot be copied (no email in the blob, a blob over the vault limit, a
   *  failed write) must not be overwritten or deleted. */
  private secureActive(): boolean {
    const live = this.backend.read(AGY_ACTIVE_TARGET);
    if (!live) return true;
    const email = this.captureActive();
    if (!email || !this.hasCopy(email)) return false;
    const copy = this.backend.read(copyTarget(email));
    return copy !== null && copy.equals(live);
  }

  /** Make `email` the active agy account. The live sign-in is copied first,
   *  so the account being replaced keeps its newest refresh token; when that
   *  copy cannot be made, the swap is refused. */
  activate(email: string): AgySwapResult {
    const blob = this.backend.read(copyTarget(email));
    if (agyBlobEmail(blob) !== email || !blob) return 'no-copy';
    if (!this.secureActive()) return 'live-not-saved';
    if (!this.backend.write(AGY_ACTIVE_TARGET, AGY_ACTIVE_USER, blob)) return 'failed';
    return this.activeEmail() === email ? 'ok' : 'failed';
  }

  /** Sign agy out (for adding another account). Refused when the live sign-in
   *  cannot be copied first, so it is never lost. */
  signOutActive(): boolean {
    if (!this.secureActive()) return false;
    return this.backend.remove(AGY_ACTIVE_TARGET) || this.backend.read(AGY_ACTIVE_TARGET) === null;
  }

  removeCopy(email: string): void {
    this.backend.remove(copyTarget(email));
  }
}

// ── koffi backend ────────────────────────────────────────────────────────────

let cached: AgyVaultBackend | null | undefined;

function loadKoffiBackend(): AgyVaultBackend | null {
  if (process.platform !== 'win32') return null;
  try {
    // Runtime require: koffi stays external to every bundle (see winSnapshotNative).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const koffi = require('koffi') as {
      load: (lib: string) => { func: (sig: string) => (...args: unknown[]) => unknown };
      struct: (name: string, def: Record<string, string>) => unknown;
      decode: (ptr: unknown, type: unknown, len?: number) => unknown;
    };
    const advapi32 = koffi.load('advapi32.dll');
    const CREDENTIALW = koffi.struct('WMUX_CREDENTIALW', {
      Flags: 'uint32',
      Type: 'uint32',
      TargetName: 'str16',
      Comment: 'str16',
      LastWritten: 'uint64',
      CredentialBlobSize: 'uint32',
      CredentialBlob: 'void*',
      Persist: 'uint32',
      AttributeCount: 'uint32',
      Attributes: 'void*',
      TargetAlias: 'str16',
      UserName: 'str16',
    });
    const CredReadW = advapi32.func('bool __stdcall CredReadW(str16, uint32, uint32, _Out_ WMUX_CREDENTIALW **out)');
    const CredWriteW = advapi32.func('bool __stdcall CredWriteW(WMUX_CREDENTIALW *cred, uint32)');
    const CredDeleteW = advapi32.func('bool __stdcall CredDeleteW(str16, uint32, uint32)');
    const CredFree = advapi32.func('void __stdcall CredFree(void *)');
    return {
      read(target) {
        const out: unknown[] = [null];
        if (!CredReadW(target, CRED_TYPE_GENERIC, 0, out)) return null;
        try {
          const cred = koffi.decode(out[0], CREDENTIALW) as { CredentialBlob: unknown; CredentialBlobSize: number };
          if (!cred.CredentialBlobSize) return Buffer.alloc(0);
          return Buffer.from(koffi.decode(cred.CredentialBlob, 'uint8', cred.CredentialBlobSize) as number[]);
        } finally {
          CredFree(out[0]);
        }
      },
      write(target, user, blob) {
        return Boolean(CredWriteW({
          Flags: 0,
          Type: CRED_TYPE_GENERIC,
          TargetName: target,
          Comment: null,
          LastWritten: 0,
          CredentialBlobSize: blob.length,
          CredentialBlob: blob,
          Persist: CRED_PERSIST_LOCAL_MACHINE,
          AttributeCount: 0,
          Attributes: null,
          TargetAlias: null,
          UserName: user,
        }, 0));
      },
      remove(target) {
        return Boolean(CredDeleteW(target, CRED_TYPE_GENERIC, 0));
      },
    };
  } catch (err) {
    console.warn(`[agy-accounts] credential vault unavailable: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** Process-wide koffi backend; null when the platform cannot host it. */
export function getAgyVaultBackend(): AgyVaultBackend | null {
  if (cached === undefined) cached = loadKoffiBackend();
  return cached;
}
