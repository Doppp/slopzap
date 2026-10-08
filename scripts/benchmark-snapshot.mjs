// Serialized only into this disposable profile's trusted extension page.
export async function fixtureSnapshot(tabId) {
  if (!Number.isInteger(tabId) || tabId <= 0) return null;
  try {
    return await chrome.tabs.sendMessage(tabId, { type: 'SNAPSHOT' });
  } catch {
    return null;
  }
}
