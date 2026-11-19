// پیش‌نویس صوتی: بین صفحه‌ی صدا و فرم‌ها فقط در حافظه رد و بدل میشود و یک بار مصرف است.
let drafts = {};
export const setDraft = (kind, value) => { drafts[kind] = value; };
export function takeDraft(kind) {
  const v = drafts[kind];
  delete drafts[kind];
  return v || null;
}
export const clearDrafts = () => { drafts = {}; };
