import { crc32, deflateRawSync } from 'node:zlib';

// Invented ZIP fixtures only. Production archives are made by WXT.
export function inventedArchive(
  entries: {
    name: string;
    content: Buffer;
    deflate?: boolean;
  }[],
) {
  const locals: Buffer[] = [],
    centrals: Buffer[] = [],
    offsets: number[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name),
      data = entry.deflate ? deflateRawSync(entry.content) : entry.content,
      checksum = crc32(entry.content),
      local = Buffer.alloc(30 + name.length),
      central = Buffer.alloc(46 + name.length);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(entry.deflate ? 8 : 0, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(entry.content.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(entry.deflate ? 8 : 0, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(entry.content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    offsets.push(offset);
    locals.push(local, data);
    centrals.push(central);
    offset += local.length + data.length;
  }
  const central = Buffer.concat(centrals),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return {
    bytes: Buffer.concat([...locals, central, end]),
    central: offset,
    offsets,
  };
}
