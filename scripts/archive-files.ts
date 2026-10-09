import { createHash } from 'node:crypto';
import { crc32, inflateRawSync } from 'node:zlib';

export const MAX_ARCHIVE_BYTES = 1_048_576;
export const MAX_ARCHIVE_CONTENT_BYTES = 500_000;

// Strict subset emitted by the pinned WXT packager, not a general ZIP reader.
// No extraction, descriptors, extras, comments, encryption, ZIP64 or split ZIPs.
export function archiveFiles(bytes: Buffer): Record<string, string> {
  try {
    if (bytes.length < 22 || bytes.length > MAX_ARCHIVE_BYTES)
      throw new Error();
    const end = bytes.length - 22,
      count = bytes.readUInt16LE(end + 10),
      centralSize = bytes.readUInt32LE(end + 12),
      centralStart = bytes.readUInt32LE(end + 16);
    if (
      bytes.readUInt32LE(end) !== 0x06054b50 ||
      bytes.readUInt16LE(end + 4) !== 0 ||
      bytes.readUInt16LE(end + 6) !== 0 ||
      bytes.readUInt16LE(end + 8) !== count ||
      !count ||
      count > 1000 ||
      bytes.readUInt16LE(end + 20) !== 0 ||
      centralStart + centralSize !== end
    )
      throw new Error();
    const files: Record<string, string> = Object.create(null),
      names = new Set<string>();
    let central = centralStart,
      localEnd = 0,
      total = 0;
    for (let index = 0; index < count; index++) {
      if (central + 46 > end || bytes.readUInt32LE(central) !== 0x02014b50)
        throw new Error();
      const version = bytes.readUInt16LE(central + 6),
        flags = bytes.readUInt16LE(central + 8),
        method = bytes.readUInt16LE(central + 10),
        checksum = bytes.readUInt32LE(central + 16),
        compressed = bytes.readUInt32LE(central + 20),
        size = bytes.readUInt32LE(central + 24),
        nameSize = bytes.readUInt16LE(central + 28),
        attrs = bytes.readUInt32LE(central + 38),
        mode = (attrs >>> 16) & 0xf000,
        local = bytes.readUInt32LE(central + 42);
      if (
        version !== 20 ||
        (flags !== 0 && flags !== 0x800) ||
        (method !== 0 && method !== 8) ||
        !nameSize ||
        nameSize > 256 ||
        central + 46 + nameSize > end ||
        bytes.readUInt16LE(central + 30) !== 0 ||
        bytes.readUInt16LE(central + 32) !== 0 ||
        bytes.readUInt16LE(central + 34) !== 0 ||
        (attrs & 0x10) !== 0 ||
        (mode !== 0 && mode !== 0x8000) ||
        total + size > MAX_ARCHIVE_CONTENT_BYTES ||
        local !== localEnd ||
        local + 30 + nameSize + compressed > centralStart
      )
        throw new Error();
      const nameBytes = bytes.subarray(central + 46, central + 46 + nameSize),
        name = nameBytes.toString('utf8');
      if (
        !/^[a-zA-Z0-9_./-]+$/.test(name) ||
        name
          .split('/')
          .some(
            (part) =>
              !part ||
              part === '.' ||
              part === '..' ||
              part.endsWith('.') ||
              /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
          ) ||
        names.has(name.toLowerCase())
      )
        throw new Error();
      names.add(name.toLowerCase());
      if (
        bytes.readUInt32LE(local) !== 0x04034b50 ||
        bytes.readUInt16LE(local + 4) !== version ||
        bytes.readUInt16LE(local + 6) !== flags ||
        bytes.readUInt16LE(local + 8) !== method ||
        bytes.readUInt32LE(local + 10) !== bytes.readUInt32LE(central + 12) ||
        bytes.readUInt32LE(local + 14) !== checksum ||
        bytes.readUInt32LE(local + 18) !== compressed ||
        bytes.readUInt32LE(local + 22) !== size ||
        bytes.readUInt16LE(local + 26) !== nameSize ||
        bytes.readUInt16LE(local + 28) !== 0 ||
        !bytes.subarray(local + 30, local + 30 + nameSize).equals(nameBytes)
      )
        throw new Error();
      const content = bytes.subarray(
        local + 30 + nameSize,
        local + 30 + nameSize + compressed,
      );
      let expanded: Buffer;
      if (method === 0) expanded = content;
      else {
        const result = inflateRawSync(content, {
          maxOutputLength: Math.max(1, size),
          info: true,
        }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
        // Node's info mode exposes consumed compressed bytes. Reject tails.
        if (
          !Buffer.isBuffer(result.buffer) ||
          result.engine?.bytesWritten !== compressed
        )
          throw new Error();
        expanded = result.buffer;
      }
      if (expanded.length !== size || crc32(expanded) !== checksum)
        throw new Error();
      files[name] = createHash('sha256').update(expanded).digest('hex');
      total += size;
      localEnd = local + 30 + nameSize + compressed;
      central += 46 + nameSize;
    }
    if (central !== end || localEnd !== centralStart) throw new Error();
    for (const name of names) {
      const parts = name.split('/');
      for (let index = 1; index < parts.length; index++)
        if (names.has(parts.slice(0, index).join('/'))) throw new Error();
    }
    return files;
  } catch {
    throw new Error('Archive verification failed');
  }
}
