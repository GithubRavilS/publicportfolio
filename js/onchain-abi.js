/** Минимальный ABI decode для ончейн-сканеров (без ethers). */

export function decodeAddressArray(hex) {
  if (!hex || hex === "0x" || hex.length < 130) return [];
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const offset = Number(BigInt("0x" + h.slice(0, 64)));
  const base = offset * 2;
  const len = Number(BigInt("0x" + h.slice(base, base + 64)));
  const out = [];
  for (let i = 0; i < len; i++) {
    const w = h.slice(base + 64 + i * 64, base + 128 + i * 64);
    out.push("0x" + w.slice(24));
  }
  return out;
}

export function decodeUint256Array(hex) {
  if (!hex || hex === "0x" || hex.length < 130) return [];
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const offset = Number(BigInt("0x" + h.slice(0, 64)));
  const base = offset * 2;
  const len = Number(BigInt("0x" + h.slice(base, base + 64)));
  const out = [];
  for (let i = 0; i < len; i++) {
    const w = h.slice(base + 64 + i * 64, base + 128 + i * 64);
    out.push(BigInt("0x" + w));
  }
  return out;
}

export function wordAt(hex, i) {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  return "0x" + h.slice(i * 64, (i + 1) * 64);
}

export function addrFromWord(word) {
  return "0x" + String(word).replace(/^0x/, "").slice(-40);
}

export function uintFromWord(word) {
  return BigInt(word);
}

/** Ищем в ответе Fluid positionByNftId поля collateral/debt (эвристика по структуре). */
export function scanFluidPositionWords(hex) {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const words = [];
  for (let i = 0; i < h.length / 64; i++) {
    words.push(h.slice(i * 64, (i + 1) * 64));
  }
  return words;
}
