import { DomainError } from './workflow.js';

export function invalidRequest(message: string): never {
  throw new DomainError('INVALID_REQUEST', message);
}

export function requireObject(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)
    || Object.keys(input).some((key) => !keys.includes(key))) {
    return invalidRequest('La solicitud no es válida.');
  }
  return input as Record<string, unknown>;
}

export function requireText(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim()) return invalidRequest(`${name} es obligatorio.`);
  const trimmed = value.trim();
  if (trimmed.length > maxLength) return invalidRequest(`${name} supera ${maxLength} caracteres.`);
  return trimmed;
}

export function optionalText(value: unknown, name: string, maxLength: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && !value.trim()) return null;
  return requireText(value, name, maxLength);
}

export function requireTextList(value: unknown, name: string, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return invalidRequest(`${name} debe ser una lista.`);
  if (value.length > maxItems) return invalidRequest(`${name} admite como máximo ${maxItems} elementos.`);
  return value.map((item) => requireText(item, name, maxLength));
}

export function requirePositiveInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    return invalidRequest(`${name} debe ser un entero positivo.`);
  }
  return value;
}
