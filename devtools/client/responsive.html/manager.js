/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const promise = require("promise");
const { Task } = require("resource://gre/modules/Task.jsm");
const EventEmitter = require("devtools/shared/event-emitter");

const TOOL_URL = "chrome://devtools/content/responsive.html/index.xhtml";

/**
 * ResponsiveUIManager is the external API for the browser UI, etc. to use when
 * open and closing the responsive UI.
 *
 * While the HTML UI is in an experimental stage, the older ResponsiveUIManager
 * from devtools/client/responsivedesign/responsivedesign.jsm delegates to this
 * object when the pref "devtools.responsive.html.enabled" is true.
 */
exports.ResponsiveUIManager = {
  _activeTabs: new Map(),

  /**
   * Toggle the responsive UI for a tab.
   *
   * @param window
   *        The main browser chrome window.
   * @param tab
   *        The browser tab.
   */
  toggle(window, tab) {
    if (this.isActiveForTab(tab)) {
      this._activeTabs.get(tab).destroy();
      this._activeTabs.delete(tab);
    } else {
      this.runIfNeeded(window, tab);
    }
  },

  /**
   * Launches the responsive UI.
   *
   * @param window
   *        The main browser chrome window.
   * @param tab
   *        The browser tab.
   */
  runIfNeeded(window, tab) {
    if (!this.isActiveForTab(tab)) {
      this._activeTabs.set(tab, new ResponsiveUI(window, tab));
    }
  },

  /**
   * Returns true if responsive UI is active for a given tab.
   *
   * @param tab
   *        The browser tab.
   * @return boolean
   */
  isActiveForTab(tab) {
    return this._activeTabs.has(tab);
  },

  /**
   * Return the responsive UI controller for a tab.
   *
   * @param tab
   *        The browser tab.
   * @return TODO: Some object!
   */
  getResponsiveUIForTab(tab) {
    return this._activeTabs.get(tab);
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
  handleGcliCommand: function(window, tab, command, args) {
    switch (command) {
      case "resize to":
        this.runIfNeeded(window, tab);
        // TODO: Probably the wrong API
        this._activeTabs.get(tab).setSize(args.width, args.height);
        break;
      case "resize on":
        this.runIfNeeded(window, tab);
        break;
      case "resize off":
        if (this.isActiveForTab(tab)) {
          this._activeTabs.get(tab).destroy();
          this._activeTabs.delete(tab);
        }
        break;
      case "resize toggle":
        this.toggle(window, tab);
        break;
      default:
    }
  }
};

// GCLI commands in ../responsivedesign/resize-commands.js listen for events
// from this object to know when the UI for a tab has opened or closed.
EventEmitter.decorate(exports.ResponsiveUIManager);

function ResponsiveUI(window, tab) {
  this._window = window;
  this._tab = tab;
  this.init();
}

ResponsiveUI.prototype = {

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
   * state.  Platform discussions are in progress to make this happen.
   */
  init: Task.async(function*() {
    let tabBrowser = this._tab.linkedBrowser;
    let contentURI = tabBrowser.documentURI.spec;
    // TODO: Should we use a fresh tab?
    tabBrowser.loadURI(TOOL_URL);
    yield tabLoaded(this._tab);
    let toolWindow = tabBrowser.contentWindow;
    toolWindow.addInitialViewport(contentURI);
  }),

  destroy() {
    let tabBrowser = this._tab.linkedBrowser;
    tabBrowser.goBack();
  },

};

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

  tab.linkedBrowser.addEventListener("load", handle, true, true);
  return deferred.promise;
}
