export type AddressOption = { code: string; name: string };

export function normalizeAddressName(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").replace(/[đĐ]/g, "d").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim()
    .replace(/^(thanh pho|tinh|phuong|xa|tp)\s+/, "");
}

export function filterAddressOptions<T extends AddressOption>(items: T[], query: string): T[] {
  const needle = normalizeAddressName(query);
  return items.map(item => {
    const name = normalizeAddressName(item.name); const words = name.split(/\s+/);
    const prefix = needle && needle.split(/\s+/).every(part => words.some(word => word.startsWith(part)));
    const initials = words.map(word => word[0]).join("");
    const rank = !needle ? 1 : name === needle ? 4 : prefix ? 3 : name.includes(needle) || initials.startsWith(needle.replace(/\s/g, "")) ? 2 : 0;
    return { item, rank };
  }).filter(result => result.rank > 0).sort((a, b) => b.rank - a.rank).map(result => result.item);
}
