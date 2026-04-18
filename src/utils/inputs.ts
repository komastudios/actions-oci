import * as core from "@actions/core";

/** Read an input and coerce to boolean with case-insensitive "true"/"false" matching. */
export function getBoolean(name: string, def: boolean): boolean {
  const v = core.getInput(name, { required: false });
  if (v === "") return def;
  const lower = v.toLowerCase();
  if (lower === "true") return true;
  if (lower === "false") return false;
  throw new Error(`${name}: expected boolean (true|false), got "${v}"`);
}

/** Read an input and coerce to an integer in [min,max]. Empty string returns `def`. */
export function getInt(name: string, def: number | undefined, min: number, max: number): number | undefined {
  const v = core.getInput(name, { required: false });
  if (v === "") return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name}: expected integer in [${min},${max}], got "${v}"`);
  }
  return n;
}

/** Read one of the `enum` values. */
export function getEnum<T extends string>(name: string, allowed: readonly T[], def: T): T {
  const v = (core.getInput(name, { required: false }) || def) as T;
  if (!allowed.includes(v)) {
    throw new Error(`${name}: expected one of ${allowed.join("|")}, got "${v}"`);
  }
  return v;
}

/** Multi-line input reader: split on \n or \r\n, drop empty lines. */
export function getMultiline(name: string): string[] {
  const raw = core.getInput(name, { required: false });
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}
