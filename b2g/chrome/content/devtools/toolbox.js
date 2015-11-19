/* -*- indent-tabs-mode: nil; js-indent-level: 2 -*- /
/* vim: set shiftwidth=2 tabstop=2 autoindent cindent expandtab: */
/* eslint-env es6 */
/* globals devtools */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const { Task } = devtools.require("resource://gre/modules/Task.jsm");
devtools.lazyRequireGetter(this, "DebuggerClient",
  "devtools/shared/client/main", true);
devtools.lazyRequireGetter(this, "TargetFactory",
  "devtools/client/framework/target", true);
devtools.lazyRequireGetter(this, "Toolbox",
  "devtools/client/framework/toolbox", true);
devtools.lazyRequireGetter(this, "gDevTools",
  "resource://devtools/client/framework/gDevTools.jsm", true);

let DevToolsToolboxManager = {

  init() {
    window.addEventListener("ContentStart", (function(evt) {
      let content = shell.contentBrowser.contentWindow;
      content.addEventListener("mozContentEvent", this, false, true);
    }).bind(this), false);
  },

  handleEvent(event) {
    let detail = event.detail;
    if (detail.type !== "toggle-devtools-toolbox") {
      return;
    }
    this.toggleToolbox();
  },

  makeTarget: Task.async(function*() {
    let client = new DebuggerClient(DebuggerServer.connectPipe());
    yield client.connect();
    let response = yield new Promise(resolve => client.listTabs(resolve));

    let tab = response.tabs[response.selected];

    let options = {
      form: tab,
      client: client,
      chrome: false,
    };
    return TargetFactory.forRemoteTab(options);
  }),

  toggleToolbox() {
    if (this.toolboxPromise) {
      this.destroyToolbox();
    } else {
      this.createToolbox();
    }
  },

  createToolbox: Task.async(function*() {
    // If |this.toolboxPromise| exists, there is already a live toolbox
    if (this.toolboxPromise) {
      return this.toolboxPromise;
    }

    let iframe = document.createElement("iframe");
    iframe.id = "toolbox";

    // Compute a uid on the iframe in order to identify toolbox iframe
    // when receiving toolbox-close event
    iframe.uid = new Date().getTime();

    /*let height = Services.prefs.getIntPref("devtools.toolbox.footer.height");*/
    /*iframe.height = height;*/

    let target = yield this.makeTarget();

    let promise = this.toolboxPromise = this._showToolbox(target, iframe);
    promise.then(toolbox => {
      // Destroy the toolbox on WebIDE side before
      // toolbox.destroy's promise resolves.
      toolbox.once("destroyed", this._onToolboxClosed.bind(this, promise, iframe));
    }, console.error);
  }),

  _showToolbox: function(target, iframe) {
    document.body.appendChild(iframe);
    let host = Toolbox.HostType.CUSTOM;
    let options = { customIframe: iframe, zoom: false, uid: iframe.uid };
    return gDevTools.showToolbox(target, null, host, options);
  },

  destroyToolbox: function() {
    // Only have a live toolbox if |this.toolboxPromise| exists
    if (this.toolboxPromise) {
      let toolboxPromise = this.toolboxPromise;
      this.toolboxPromise = null;
      return toolboxPromise.then(toolbox => toolbox.destroy());
    }
  },

  /**
   * There are many ways to close a toolbox:
   *   * Close button inside the toolbox
   *   * Toggle toolbox wrench in WebIDE
   *   * Disconnect the current runtime gracefully
   *   * Yank cord out of device
   *   * Close or crash the app/tab
   * We can't know for sure which one was used here, so reset the
   * |toolboxPromise| since someone must be destroying it to reach here,
   * and call our own close method.
   */
  _onToolboxClosed: function(promise, iframe) {
    // Only save toolbox size, disable wrench button, workaround focus issue...
    // if we are closing the last toolbox:
    //  - toolboxPromise is nullified by destroyToolbox and is still null here
    //    if no other toolbox has been opened in between,
    //  - having two distinct promise means we are receiving closed event
    //    for a previous, non-current, toolbox.
    if (!this.toolboxPromise || this.toolboxPromise === promise) {
      this.toolboxPromise = null;
      /*Services.prefs.setIntPref("devtools.toolbox.footer.height", iframe.height);*/
    }
    // We have to destroy the iframe, otherwise, the keybindings of webide don't work
    // properly anymore.
    iframe.remove();
  },

};

DevToolsToolboxManager.init();
