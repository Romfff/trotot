function normalizeLocation(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
    .replace(/\bdh\b/g, "dai hoc").replace(/\bbv\b/g, "benh vien")
    .replace(/\b(tp ho chi minh|thanh pho ho chi minh|tp hcm|tphcm|hcm|sai gon)\b/g, "ho chi minh");
}

export function matchesLocation(query: string, ...fields: string[]) {
  const phrase = normalizeLocation(query);
  return !phrase || fields.some((field) => (` ${normalizeLocation(field)} `).includes(` ${phrase} `));
}
