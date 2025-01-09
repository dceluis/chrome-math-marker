export default defineBackground(() => {
  browser.action.onClicked.addListener((tab) => {
    // Send a message to the content script when the icon is clicked
    browser.tabs.sendMessage(tab.id, {action: 'iconClicked'});
  });

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.tab && sender.tab.id != undefined) {
      if (message.action === 'screenshot') {
        return browser.tabs.captureVisibleTab({format: "png"});
      }
    }
  });
});
