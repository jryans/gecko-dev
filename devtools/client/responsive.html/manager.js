/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const promise = require("promise");
const { Task } = require("resource://gre/modules/Task.jsm");
const EventEmitter = require("devtools/shared/event-emitter");
const { getOwnerWindow } = require("sdk/tabs/utils");
const { on, off } = require("sdk/event/core");
const { startup } = require("sdk/window/helpers");
const events = require("./events");
const { makeNestedBrowser } = require("./browser");

const TOOL_URL = "chrome://devtools/content/responsive.html/index.xhtml";

/**
 * ResponsiveUIManager is the external API for the browser UI, etc. to use when
 * opening and closing the responsive UI.
 *
 * While the HTML UI is in an experimental stage, the older ResponsiveUIManager
 * from devtools/client/responsivedesign/responsivedesign.jsm delegates to this
 * object when the pref "devtools.responsive.html.enabled" is true.
 */
const ResponsiveUIManager = exports.ResponsiveUIManager = {
  activeTabs: new Map(),

  /**
   * Toggle the responsive UI for a tab.
   *
   * @param window
   *        The main browser chrome window.
   * @param tab
   *        The browser tab.
   * @return Promise
   *         Resolved when the toggling has completed.  If the UI has opened,
   *         it is resolved to the ResponsiveUI instance for this tab.  If the
   *         the UI has closed, there is no resolution value.
   */
  toggle(window, tab) {
    let action = this.isActiveForTab(tab) ? "close" : "open";
    let completed = this[action + "IfNeeded"](window, tab);
    completed.catch(console.error);
    return completed;
  },

  /**
   * Opens the responsive UI, if not already open.
   *
   * @param window
   *        The main browser chrome window.
   * @param tab
   *        The browser tab.
   * @return Promise
   *         Resolved to the ResponsiveUI instance for this tab when opening is
   *         complete.
   */
  openIfNeeded: Task.async(function* (window, tab) {
    if (!this.isActiveForTab(tab)) {
      if (!this.activeTabs.size) {
        on(events.activate, "data", onActivate);
        on(events.close, "data", onClose);
      }
      let ui = new ResponsiveUI(window, tab);
      this.activeTabs.set(tab, ui);
      yield setMenuCheckFor(tab, window);
      yield ui.inited;
      this.emit("on", { tab });
    }
    return this.getResponsiveUIForTab(tab);
  }),

  /**
   * Closes the responsive UI, if not already closed.
   *
   * @param window
   *        The main browser chrome window.
   * @param tab
   *        The browser tab.
   * @return Promise
   *         Resolved (with no value) when closing is complete.
   */
  closeIfNeeded: Task.async(function* (window, tab) {
    if (this.isActiveForTab(tab)) {
      let ui = this.activeTabs.get(tab);
      this.activeTabs.delete(tab);

      if (!this.activeTabs.size) {
        off(events.activate, "data", onActivate);
        off(events.close, "data", onClose);
      }

      yield ui.destroy();
      this.emit("off", { tab });

      yield setMenuCheckFor(tab, window);
    }
  }),

  /**
   * Returns true if responsive UI is active for a given tab.
   *
   * @param tab
   *        The browser tab.
   * @return boolean
   */
  isActiveForTab(tab) {
    return this.activeTabs.has(tab);
  },

  /**
   * Return the responsive UI controller for a tab.
   *
   * @param tab
   *        The browser tab.
   * @return ResponsiveUI
   *         The UI instance for this tab.
   */
  getResponsiveUIForTab(tab) {
    return this.activeTabs.get(tab);
  },

  /**
   * Handle GCLI commands.
   *
   * @param window
   *        The main browser chrome window.
   * @param tab
   *        The browser tab.
   * @param command
   *        The GCLI command name.
   * @param args
   *        The GCLI command arguments.
   */
  handleGcliCommand: function (window, tab, command, args) {
    let completed;
    switch (command) {
      case "resize to":
        completed = this.openIfNeeded(window, tab);
        this.activeTabs.get(tab).setViewportSize(args.width, args.height);
        break;
      case "resize on":
        completed = this.openIfNeeded(window, tab);
        break;
      case "resize off":
        completed = this.closeIfNeeded(window, tab);
        break;
      case "resize toggle":
        completed = this.toggle(window, tab);
        break;
      default:
    }
    completed.catch(e => console.error(e));
  }
};

// GCLI commands in ../responsivedesign/resize-commands.js listen for events
// from this object to know when the UI for a tab has opened or closed.
EventEmitter.decorate(ResponsiveUIManager);

/**
 * ResponsiveUI manages the responsive design tool for a specific tab.  The
 * actual tool itself lives in a separate chrome:// document that is loaded into
 * the tab upon opening responsive design.  This object acts a helper to
 * integrate the tool into the surrounding browser UI as needed.
 */
function ResponsiveUI(window, tab) {
  this.browserWindow = window;
  this.tab = tab;
  this.inited = this.init();
}

ResponsiveUI.prototype = {

  /**
   * The main browser chrome window (that holds many tabs).
   */
  browserWindow: null,

  /**
   * The specific browser tab this responsive instance is for.
   */
  tab: null,

  /**
   * Promise resovled when the UI init has completed.
   */
  inited: null,

  /**
   * A window reference for the chrome:// document that displays the responsive
   * design tool.  It is safe to reference this window directly even with e10s,
   * as the tool UI is always loaded in the parent process.  The web content
   * contained *within* the tool UI on the other hand is loaded in the child
   * process.
   */
  toolWindow: null,

  /**
   * For the moment, we open the tool by:
   * 1. Recording the tab's URL
   * 2. Navigating the tab to the tool
   * 3. Passing along the URL to the tool to open in the viewport
   *
   * This approach is simple, but it also discards the user's state on the page.
   * It's just like opening a fresh tab and pasting the URL.
   *
   * In the future, we can do better by using swapFrameLoaders to preserve the
   * state.  Platform discussions are in progress to make this happen.  See
   * bug 1238160 about <iframe mozbrowser> for more details.
   */
  init: Task.async(function* () {
    // TODO: Assert e10s somewhere.  Flow only tested for remote content pages.
    let gBrowser = this.browserWindow.gBrowser;

    // 1. Create a temporary, hidden tab to load the tool UI.
    let toolTab = gBrowser.addTab(TOOL_URL, {
      skipAnimation: true,
    });
    gBrowser.hideTab(toolTab);
    let toolBrowser = toolTab.linkedBrowser;

    // 2. Mark the tool tab browser's docshell as active so the viewport frame
    //    is created eagerly and will be ready to swap.
    // This line is crucial when the tool UI is loaded into a background tab.
    // Without it, the viewport browser's frame is created lazily, leading to
    // a multi-second delay before it would be possible to `swapFrameLoaders`.
    // Even worse than the delay, there appears to be no obvious event fired
    // after the frame is set lazily, so it's unclear how to know that work has
    // finished.
    toolBrowser.docShellIsActive = true;

    let toolWindow = this.toolWindow = toolBrowser.contentWindow;
    console.log("WAIT FOR TOOL TAB LOAD");
    yield tabLoaded(toolTab);
    console.log("TOOL TAB LOADED");
    console.log("WAIT FOR TOOL INIT");
    toolWindow.addEventListener("message", this);
    yield waitForMessage(toolWindow, "init");
    console.log("TOOL INITED");

    // 3. Create the initial viewport inside the tool UI.
    toolWindow.addInitialViewport("about:blank");
    console.log("WAIT FOR BROWSER MOUNTED");
    yield waitForMessage(toolWindow, "browser-mounted");
    console.log("BROWSER MOUNTED");

    console.log("BACKUP BROWSER PROPERTIES");
    // XXX: Backup browser properties that store state of the content.
    // TODO: Just backup everything?
    this.browserBackup = {};
    let propertiesToBackup = [
      "permanentKey",
      "_remoteWebNavigation",
      "_remoteWebNavigationImpl",
      "_remoteWebProgressManager",
      "_remoteWebProgress",
      "_contentTitle",
    ];
    for (let property of propertiesToBackup) {
      this.browserBackup[property] = this.tab.linkedBrowser[property];
    }

    // 4. Swap tab content from the regular browser tab to the browser within
    //    the viewport in the tool UI, preserving all state via
    //    `swapFrameLoaders`.
    // XXX: This does succeed, but the browser is now very confused, since we've
    // swapped in something that is not a XUL <browser>.  Also in this case,
    // we're calling the low level platform API directly, so all of the state
    // the browser window maintains for a tab is now invalid.  It puts the
    // original tab in a kind of zombie state where it can't even be closed.
    console.log("SWAP CONTENT");
    let toolViewportContentBrowser =
      toolWindow.document.querySelector("iframe.browser");
    toolViewportContentBrowser.swapFrameLoaders(this.tab.linkedBrowser);
    console.log("CONTENT SWAPPED");

    // This tab's permanentKey property (used to access session history for the
    // browser) is no longer correct.  Assign a fresh value here so that we'll
    // be able to properly restore session history on close later.  Any fresh
    // object can be used here (the object is used as the key in a WeakMap).
    console.log("SET ZOMBIE KEY");
    this.tab.linkedBrowser.permanentKey = { id: "zombie" };

    // 5. Mark the viewport browser's docshell as active so the content is
    //    rendered.
    toolViewportContentBrowser.frameLoader.tabParent.docShellIsActive = true;

    // 6. Force the original browser tab to be non-remote since the tool UI must
    //    loaded in the parent process, and we're about to swap the tool UI into
    //    this tab.
    gBrowser.updateBrowserRemoteness(this.tab.linkedBrowser, false);

    // 7. Swap the tool UI (with viewport showing the content) into the original
    //    browser tab and close the temporary tab used to load the tool via
    //    `swapBrowsersAndCloseOther`.
    console.log("SWAP BROWSER TABS");
    gBrowser.swapBrowsersAndCloseOther(this.tab, toolTab);
    console.log("BROWSER TABS SWAPPED");

    // XXX: Wrap the tool tab's browser so that some browser UI functions,
    // like navigation, are connected to the content in the viewport, instead
    // of the tool page itself.
    console.log("CONNECT TO NESTED BROWSER");
    this.nestedBrowser =
      makeNestedBrowser(this.tab.linkedBrowser, toolViewportContentBrowser);
    this.nestedBrowser.connect();
    // XXX: Fix up earlier get of this browser
    /*toolTab.linkedBrowser = makeNestedBrowser(toolTab.linkedBrowser);*/

    gBrowser.setTabTitle(this.tab);

    /*
    XXX: Browser UI actions after removing other tab:
    if (isBusy)
      this.setTabTitleLoading(aOurTab);
    else
      this.setTabTitle(aOurTab);

    // If the tab was already selected (this happpens in the scenario
    // of replaceTabWithWindow), notify onLocationChange, etc.
    if (aOurTab.selected)
      this.updateCurrentBrowser(true);
    */
  }),

  destroy: Task.async(function* () {
    // TODO: Assert e10s somewhere.  Flow only tested for remote content pages.
    // Capture what we need to restore the original tab content
    let tab = this.tab;
    let gBrowser = this.browserWindow.gBrowser;
    let toolWindow = this.toolWindow;

    // Destroy local state
    this.browserWindow = null;
    this.tab = null;
    this.inited = null;
    this.toolWindow = null;

    // 1. Create a temporary, hidden tab to hold the content.
    let contentTab = gBrowser.addTab("about:blank", {
      skipAnimation: true,
    });
    gBrowser.hideTab(contentTab);
    let contentBrowser = contentTab.linkedBrowser;

    // 2. Mark the content tab browser's docshell as active so the frame
    //    is created eagerly and will be ready to swap.
    contentBrowser.docShellIsActive = true;

    // 3. Swap tab content from the browser within the viewport in the tool UI
    //    to the regular browser tab, preserving all state via
    //    `swapFrameLoaders`.
    console.log("SWAP CONTENT");
    let toolViewportContentBrowser =
      toolWindow.document.querySelector("iframe.browser");
    toolViewportContentBrowser.swapFrameLoaders(contentTab.linkedBrowser);
    console.log("CONTENT SWAPPED");

    // 4. Force the original browser tab to be remote since web content is
    //    loaded in the child process, and we're about to swap the content into
    //    this tab.
    gBrowser.updateBrowserRemoteness(tab.linkedBrowser, true);

    console.log("RESTORE BROWSER PROPERTIES");
    // XXX: Restore browser properties that store state of the content.
    for (let property in this.browserBackup) {
      contentTab.linkedBrowser[property] = this.browserBackup[property];
    }
    this.browserBackup = null;

    // 5. Swap the content into the original browser tab and close the temporary
    //    tab used to hold the content via `swapBrowsersAndCloseOther`.
    console.log("SWAP BROWSER TABS");
    gBrowser.swapBrowsersAndCloseOther(tab, contentTab);
    console.log("BROWSER TABS SWAPPED");

    // TODO: Session restore continues to store the tool UI as the page's URL.
    // Most likely related to browser UI's inability to show correct location.
  }),

  handleEvent(event) {
    let { tab, window } = this;
    let toolWindow = tab.linkedBrowser.contentWindow;

    if (event.origin !== "chrome://devtools") {
      return;
    }

    switch (event.data.type) {
      case "content-resize":
        let { width, height } = event.data;
        this.emit("content-resize", {
          width,
          height,
        });
        break;
      case "exit":
        toolWindow.removeEventListener(event.type, this);
        ResponsiveUIManager.closeIfNeeded(window, tab);
        break;
    }
  },

  getViewportSize() {
    return this.toolWindow.getViewportSize();
  },

  setViewportSize: Task.async(function* (width, height) {
    yield this.inited;
    this.toolWindow.setViewportSize(width, height);
  }),

  getViewportMessageManager() {
    return this.toolWindow.getViewportMessageManager();
  },

};

EventEmitter.decorate(ResponsiveUI.prototype);

function waitForMessage(win, type) {
  let deferred = promise.defer();

  let onMessage = event => {
    if (event.data.type !== type) {
      return;
    }
    win.removeEventListener("message", onMessage);
    deferred.resolve();
  };
  win.addEventListener("message", onMessage);

  return deferred.promise;
}

function tabLoaded(tab) {
  let deferred = promise.defer();

  function handle(event) {
    if (event.originalTarget != tab.linkedBrowser.contentDocument ||
        event.target.location.href == "about:blank") {
      return;
    }
    tab.linkedBrowser.removeEventListener("load", handle, true);
    deferred.resolve(event);
  }

  tab.linkedBrowser.addEventListener("load", handle, true);
  return deferred.promise;
}

function once(target, eventName, useCapture = false, cb) {
  dump("Waiting for event: '" + eventName + "' on " + target + ".\n");

  let deferred = promise.defer();

  for (let [add, remove] of [
    ["addEventListener", "removeEventListener"],
    ["addListener", "removeListener"],
    ["on", "off"]
  ]) {
    if ((add in target) && (remove in target)) {
      target[add](eventName, function onEvent(...aArgs) {
        dump("Got event: '" + eventName + "' on " + target + ".\n");
        target[remove](eventName, onEvent, useCapture);
        if (cb) {
          cb(...aArgs);
        }
        deferred.resolve.apply(deferred, aArgs);
      }, useCapture);
      break;
    }
  }

  return deferred.promise;
}

const onActivate = (tab) => setMenuCheckFor(tab);

const onClose = ({ window, tabs }) => {
  for (let tab of tabs) {
    ResponsiveUIManager.closeIfNeeded(window, tab);
  }
};

const setMenuCheckFor = Task.async(
  function* (tab, window = getOwnerWindow(tab)) {
    yield startup(window);

    let menu = window.document.getElementById("menu_responsiveUI");
    menu.setAttribute("checked", ResponsiveUIManager.isActiveForTab(tab));
  }
);
