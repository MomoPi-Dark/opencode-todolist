/**
 * Some providers stringify array arguments before calling the tool. Parse them
 * back so validation (and the harness's standard-schema check) see real arrays.
 */
export function safeParseJson(value: string): unknown {
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}
