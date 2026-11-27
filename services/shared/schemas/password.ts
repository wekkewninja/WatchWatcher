export const MAX_PASSWORD_CHARACTERS = 1024;
export const MAX_PASSWORD_BYTES = 4096;
export const PASSWORD_LIMIT_MESSAGE = 'Password must be at most 1,024 Unicode characters and 4,096 UTF-8 bytes, with no invalid characters.';

export function hasMinimumPasswordCharacters(password: string, minimum: number): boolean {
  return Array.from(password).length >= minimum;
}

export function isPasswordWithinLimits(password: string): boolean {
  return password.length <= MAX_PASSWORD_CHARACTERS * 2
    && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(password)
    && Array.from(password).length <= MAX_PASSWORD_CHARACTERS
    && new TextEncoder().encode(password).length <= MAX_PASSWORD_BYTES;
}