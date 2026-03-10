export interface StorageService {
  save(path: string, data: Buffer): Promise<string>;
  read(path: string): Promise<Buffer>;
  delete(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}
