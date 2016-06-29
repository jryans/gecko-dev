/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

// Verify that toolbox remains open when opening and closing RDM.

const TEST_URL = "http://example.com/";

function getServerConnectionCount(browser) {
  ok(browser.isRemoteBrowser, "Content browser is remote");
  return ContentTask.spawn(browser, {}, function* () {
    const Cu = Components.utils;
    const { require } = Cu.import("resource://devtools/shared/Loader.jsm", {});
    const { DebuggerServer } = require("devtools/server/main");
    return Object.getOwnPropertyNames(DebuggerServer._connections);
  });
}

let checkToolbox = Task.async(function* (tab, browser, location) {
  let conns = yield getServerConnectionCount(browser);
  is(conns.length, 2, "Server connection for each tab exists");
  let target = TargetFactory.forTab(tab);
  ok(!!gDevTools.getToolbox(target), `Toolbox exists ${location}`);
});

add_task(function* () {
  let tab = yield addTab(TEST_URL);

  // Open toolbox outside RDM
  {
    let { toolbox } = yield openInspector();
    yield checkToolbox(tab, tab.linkedBrowser, "outside RDM");
    let { ui } = yield openRDM(tab);
    yield checkToolbox(tab, ui.getViewportBrowser(), "after opening RDM");
    yield closeRDM(tab);
    yield checkToolbox(tab, tab.linkedBrowser, "after closing RDM");
    yield toolbox.destroy();
  }

  // Open toolbox inside RDM
  {
    let { ui } = yield openRDM(tab);
    let { toolbox } = yield openInspector();
    yield checkToolbox(tab, ui.getViewportBrowser(), "inside RDM");
    yield closeRDM(tab);
    yield checkToolbox(tab, tab.linkedBrowser, "after closing RDM");
    yield toolbox.destroy();
  }

  yield removeTab(tab);
});
