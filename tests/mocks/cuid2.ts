let counter = 0;

export function createId(): string {
  counter++;
  return `test_id_${counter}`;
}

export function init() {
  return createId;
}

export function isCuid(_id: string): boolean {
  return true;
}
