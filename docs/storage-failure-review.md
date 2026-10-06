# Storage failure review

Improvements:
1. Desktop keychain write/read errors propagate, with no plaintext browser fallback or raw-error console logging.
2. Desktop restoration never combines browser-local sessions with keychain sessions.
3. Malformed records are validated/skipped independently and retained for recovery, rather than deleting them during enumeration and accidentally skipping later entries.
4. Failed durable deletion rejects logout before the account is removed from the UI or its crypto state destroyed.

Twenty tests pass, including ten new persistence/manager tests; nine of the new cases failed against the original code. TypeScript and Vite build pass. The build retains a static/dynamic Matrix SDK import warning. Tests mock Tauri IPC and localStorage with synthetic data; no real session, keychain, homeserver, secret, provider or user device is used. Dependency pins and the pnpm lockfile are unchanged.

Release blocker: src-tauri/src/lib.rs does not register the documented secret_* commands. This patch is a fail-closed draft, not a complete native keychain implementation. Native login/restore remains blocked until handlers, key listing, locked-keychain behavior and recovery are implemented/tested on supported platforms. Legacy desktop localStorage credentials/keys remain untouched and are not automatically restored, migrated or erased. Existing encrypted stores must not be reset to work around this. Web localStorage remains plaintext by its existing contract.

No merge, release, native installation or deployment. Do not treat web build/unit success as native readiness.
