// Minimal stored-entry ZIP writer (no compression) for building a .docx fixture.
export function crc32(strOrBuf) {
  const buf = typeof strOrBuf === "string" ? Buffer.from(strOrBuf) : Buffer.from(strOrBuf);
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

export function zipStore(entries) {
  const fileChunks = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const data = Buffer.from(content, "utf8");
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);
    // Local file header: sig(4) ver(2) flags(2) method(2) time(2) date(2)
    // crc(4) comp(4) uncomp(4) fnameLen(2) extraLen(2) + fname
    const local = Buffer.alloc(30 + nameBuf.length);
    let o = 0;
    local.writeUInt32LE(0x04034b50, o); o += 4;
    local.writeUInt16LE(20, o); o += 2;
    local.writeUInt16LE(0x0800, o); o += 2; // UTF-8
    local.writeUInt16LE(0, o); o += 2; // stored
    local.writeUInt16LE(0, o); o += 2; // time
    local.writeUInt16LE(0, o); o += 2; // date
    local.writeUInt32LE(crc, o); o += 4;
    local.writeUInt32LE(data.length, o); o += 4;
    local.writeUInt32LE(data.length, o); o += 4;
    local.writeUInt16LE(nameBuf.length, o); o += 2;
    local.writeUInt16LE(0, o); o += 2;
    nameBuf.copy(local, o);
    fileChunks.push(local, data);
    // Central header: sig(4) madeBy(2) need(2) flags(2) method(2) time(2)
    // date(2) crc(4) comp(4) uncomp(4) fname(2) extra(2) comment(2)
    // disk(2) intAttr(2) extAttr(4) offset(4) + fname
    const c = Buffer.alloc(46 + nameBuf.length);
    o = 0;
    c.writeUInt32LE(0x02014b50, o); o += 4;
    c.writeUInt16LE(20, o); o += 2;
    c.writeUInt16LE(20, o); o += 2;
    c.writeUInt16LE(0x0800, o); o += 2;
    c.writeUInt16LE(0, o); o += 2;
    c.writeUInt16LE(0, o); o += 2;
    c.writeUInt16LE(0, o); o += 2;
    c.writeUInt32LE(crc, o); o += 4;
    c.writeUInt32LE(data.length, o); o += 4;
    c.writeUInt32LE(data.length, o); o += 4;
    c.writeUInt16LE(nameBuf.length, o); o += 2;
    c.writeUInt16LE(0, o); o += 2;
    c.writeUInt16LE(0, o); o += 2;
    c.writeUInt16LE(0, o); o += 2;
    c.writeUInt16LE(0, o); o += 2;
    c.writeUInt32LE(0, o); o += 4;
    c.writeUInt32LE(offset, o); o += 4;
    nameBuf.copy(c, o);
    central.push(c);
    offset += local.length + data.length;
  }
  const centralStart = offset;
  const centralSize = central.reduce((a, b) => a + b.length, 0);
  const end = Buffer.alloc(22);
  let o = 0;
  end.writeUInt32LE(0x06054b50, o); o += 4;
  end.writeUInt16LE(0, o); o += 2;
  end.writeUInt16LE(0, o); o += 2;
  end.writeUInt16LE(entries.length, o); o += 2;
  end.writeUInt16LE(entries.length, o); o += 2;
  end.writeUInt32LE(centralSize, o); o += 4;
  end.writeUInt32LE(centralStart, o); o += 4;
  end.writeUInt16LE(0, o);
  return Buffer.concat([...fileChunks, ...central, end]);
}
