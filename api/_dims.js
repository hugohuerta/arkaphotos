// Lee ancho/alto de un PNG o JPEG a partir de su cabecera (sin dependencias).
export function dimensiones(buf) {
  if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)
    return { ancho: buf.readUInt32BE(16), alto: buf.readUInt32BE(20) };
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      const len = buf.readUInt16BE(i + 2);
      if ((m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) || (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf))
        return { alto: buf.readUInt16BE(i + 5), ancho: buf.readUInt16BE(i + 7) };
      i += 2 + len;
    }
  }
  return { ancho: null, alto: null };
}
