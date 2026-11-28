// Session-scoped draft persistence for unfinished inline sentence edits.
import { clone } from './controller.js';

export const DRAFT_STORAGE_KEY = 'henge-review-drafts-v1';

export function loadReviewDrafts(storageKey = DRAFT_STORAGE_KEY) {
  const drafts = new Map();
  try {
    for (const item of JSON.parse(sessionStorage.getItem(storageKey) || '[]')) {
      if (item?.key && typeof item.text === 'string') drafts.set(item.key, item);
    }
  } catch { /* Private browsing may disable session storage. */ }
  return drafts;
}

export function saveReviewDrafts(drafts, storageKey = DRAFT_STORAGE_KEY, onError = () => {}) {
  try {
    const items = [...drafts.values()].map(({ key, roundId, groupId, text, expanded, chatKey, messageUid, swipeId, expected, rulesKey, values }) => ({
      key, roundId, groupId, text, expanded, chatKey, messageUid, swipeId, expected, rulesKey, values,
    }));
    sessionStorage.setItem(storageKey, JSON.stringify(items));
  } catch {
    onError('浏览器无法保存草稿；关闭或刷新前请复制输入内容。');
  }
}

export function matchDraftForRound(drafts, round, groupId) {
  const key = `${round.id}:${groupId}`, saved = drafts.get(key);
  if (!saved || !round.groups?.[groupId]) return null;
  if (saved.chatKey !== round.chatKey || saved.messageUid !== round.messageUid || saved.swipeId !== round.swipeId || saved.expected !== round.expected || saved.rulesKey !== round.rulesKey) return null;
  const matches = clone(round.groups[groupId].matches);
  for (const match of matches) if (Object.hasOwn(saved.values ?? {}, match.id)) match.value = saved.values[match.id];
  return { ...saved, matches };
}

export function storeEditDraft(drafts, round, edit, storageKey = DRAFT_STORAGE_KEY, onError = () => {}) {
  if (!edit || !round) return;
  Object.assign(edit, {
    chatKey: round.chatKey,
    messageUid: round.messageUid,
    swipeId: round.swipeId,
    expected: round.expected,
    rulesKey: round.rulesKey,
    values: Object.fromEntries(edit.matches.map(match => [match.id, match.value])),
  });
  drafts.set(edit.key, edit);
  saveReviewDrafts(drafts, storageKey, onError);
}
