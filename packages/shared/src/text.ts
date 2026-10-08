/** Turkish-aware case and diacritic folding for matching in code ("İSTANBUL", "istanbul", "Türkçe" ≈ "turkce"). */
export function fold(s: string): string {
  return s.toLocaleLowerCase('tr').normalize('NFD').replace(/\p{M}/gu, '').replace(/ı/g, 'i');
}

/** A management cycle's reasoning says it changed nothing (“değişiklik yok, çünkü …”, in any spelling: “Degisiklik yok”). */
export const saysNoChange = (reasoning: string): boolean => fold(reasoning).includes('degisiklik yok');
