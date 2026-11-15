// ابزار درخت دسته‌بندی (بدون وابستگی به رابط کاربری، قابل تست)
const byName = (a, b) => String(a.name).localeCompare(String(b.name), 'fa');

export function buildTree(cats) {
  const ids = new Set(cats.map((c) => c.id));
  const kids = new Map();
  for (const c of cats) {
    const parent = c.parentId && ids.has(c.parentId) ? c.parentId : '';
    if (!kids.has(parent)) kids.set(parent, []);
    kids.get(parent).push(c);
  }
  const walk = (parent, depth) =>
    (kids.get(parent) || []).sort(byName).map((c) => ({ ...c, depth, children: walk(c.id, depth + 1) }));
  return walk('', 0);
}

// فهرست تخت به ترتیب درخت: [{cat, depth}]
export function flatten(cats) {
  const out = [];
  const visit = (nodes) =>
    nodes.forEach((n) => {
      const { children, ...cat } = n;
      out.push({ cat, depth: n.depth });
      visit(children);
    });
  visit(buildTree(cats));
  return out;
}

// خود دسته و همه‌ی زیرمجموعه‌هاش
export function descendantIds(cats, id) {
  const result = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of cats) {
      if (c.parentId && result.has(c.parentId) && !result.has(c.id)) {
        result.add(c.id);
        grew = true;
      }
    }
  }
  return result;
}

export function pathNames(cats, id, sep = ' › ') {
  const map = new Map(cats.map((c) => [c.id, c]));
  const names = [];
  const seen = new Set();
  let cur = map.get(id);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    names.unshift(cur.name);
    cur = cur.parentId ? map.get(cur.parentId) : null;
  }
  return names.join(sep);
}

// آیا انتقال دسته به زیر newParentId حلقه میسازه؟
export function wouldCycle(cats, id, newParentId) {
  if (!newParentId) return false;
  return descendantIds(cats, id).has(newParentId);
}
